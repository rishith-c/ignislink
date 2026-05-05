"""Postgres/Timescale sinks.

Each topic gets a dedicated consumer task running in a worker thread. We use
the synchronous ``kafka-python`` consumer (cleaner consumer-group semantics for
batch + commit-after-write than aiokafka's async surface in our use case) and
``psycopg`` connection pooling. Bulk inserts are idempotent via primary keys
(`ON CONFLICT DO NOTHING` / `DO UPDATE` depending on the table).
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from typing import Any

import psycopg
from kafka import KafkaConsumer

from common.config import PipelineSettings, get_settings
from common.logging import get_logger

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Row builders — pure (event dict -> tuple of column values)
# ---------------------------------------------------------------------------


def detection_row(event: Mapping[str, Any]) -> tuple:
    return (
        event["detection_id"],
        event.get("source", "firms"),
        event.get("satellite"),
        event.get("instrument"),
        event["latitude"],
        event["longitude"],
        event.get("brightness"),
        event.get("frp"),
        event.get("confidence"),
        event.get("daynight"),
        event.get("scan"),
        event.get("track"),
        event["observed_at"],
        event.get("ingested_at"),
    )


def quake_row(event: Mapping[str, Any]) -> tuple:
    return (
        event["event_id"],
        event.get("source", "usgs"),
        event.get("magnitude"),
        event.get("magnitude_type"),
        event.get("place"),
        event["latitude"],
        event["longitude"],
        event.get("depth_km"),
        event.get("felt"),
        bool(event.get("tsunami") or False),
        event.get("alert"),
        event.get("status"),
        event.get("url"),
        event["observed_at"],
        event.get("ingested_at"),
    )


def gauge_row(event: Mapping[str, Any]) -> tuple:
    return (
        event["site_code"],
        event.get("site_name"),
        event.get("param_code"),
        event.get("unit"),
        event["value"],
        event.get("latitude"),
        event.get("longitude"),
        event["observed_at"],
        event.get("ingested_at"),
    )


# ---------------------------------------------------------------------------
# Sink descriptors
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TopicSink:
    name: str
    topic: str
    insert_sql: str
    row_builder: Callable[[Mapping[str, Any]], tuple]


def _sinks_for(settings: PipelineSettings) -> list[TopicSink]:
    return [
        TopicSink(
            name="detections",
            topic=settings.topic_detections,
            insert_sql=(
                "INSERT INTO detections ("
                "detection_id, source, satellite, instrument, latitude, longitude, "
                "brightness, frp, confidence, daynight, scan, track, observed_at, ingested_at"
                ") VALUES ("
                "%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s"
                ") ON CONFLICT (detection_id) DO NOTHING"
            ),
            row_builder=detection_row,
        ),
        TopicSink(
            name="earthquakes",
            topic=settings.topic_earthquakes,
            insert_sql=(
                "INSERT INTO earthquake_events ("
                "event_id, source, magnitude, magnitude_type, place, latitude, longitude, "
                "depth_km, felt, tsunami, alert, status, url, observed_at, ingested_at"
                ") VALUES ("
                "%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s"
                ") ON CONFLICT (event_id) DO UPDATE SET "
                "magnitude = EXCLUDED.magnitude, status = EXCLUDED.status, "
                "alert = EXCLUDED.alert, ingested_at = EXCLUDED.ingested_at"
            ),
            row_builder=quake_row,
        ),
        TopicSink(
            name="gauges",
            topic=settings.topic_gauges,
            insert_sql=(
                "INSERT INTO gauge_observations ("
                "site_code, site_name, param_code, unit, value, latitude, longitude, "
                "observed_at, ingested_at"
                ") VALUES ("
                "%s, %s, %s, %s, %s, %s, %s, %s, %s"
                ") ON CONFLICT (site_code, observed_at) DO NOTHING"
            ),
            row_builder=gauge_row,
        ),
    ]


# ---------------------------------------------------------------------------
# Consumer loop (sync, runs in a thread per sink)
# ---------------------------------------------------------------------------


def _bulk_insert(
    conn: psycopg.Connection, sink: TopicSink, batch: Iterable[Mapping[str, Any]]
) -> int:
    rows = [sink.row_builder(e) for e in batch]
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(sink.insert_sql, rows)
    conn.commit()
    return len(rows)


def _consume_topic_sync(sink: TopicSink, settings: PipelineSettings) -> None:
    """Blocking loop — runs inside ``asyncio.to_thread``."""
    consumer = KafkaConsumer(
        sink.topic,
        bootstrap_servers=settings.kafka_bootstrap.split(","),
        group_id=f"sentry-pg-sink-{sink.name}",
        client_id=f"{settings.kafka_client_id}-sink-{sink.name}",
        enable_auto_commit=False,
        auto_offset_reset="earliest",
        value_deserializer=lambda v: json.loads(v.decode("utf-8")),
        consumer_timeout_ms=2_000,
    )

    logger.info("sink.start", sink=sink.name, topic=sink.topic)

    try:
        with psycopg.connect(settings.pg_dsn, autocommit=False) as conn:
            while True:
                # poll() returns Dict[TopicPartition, List[ConsumerRecord]].
                polled = consumer.poll(timeout_ms=2_000, max_records=500)
                batch: list[Mapping[str, Any]] = []
                for records in polled.values():
                    batch.extend(r.value for r in records)
                if not batch:
                    continue
                try:
                    written = _bulk_insert(conn, sink, batch)
                except Exception as exc:  # noqa: BLE001
                    conn.rollback()
                    logger.error(
                        "sink.write.error", sink=sink.name, error=str(exc), batch=len(batch)
                    )
                    continue
                consumer.commit()
                logger.info("sink.write.batch", sink=sink.name, written=written)
    finally:
        try:
            consumer.close()
        except Exception:  # noqa: BLE001
            pass


async def run_postgres_sinks(settings: PipelineSettings | None = None) -> None:
    """Spawn one consumer thread per sink; awaits them concurrently."""
    settings = settings or get_settings()
    sinks = _sinks_for(settings)
    logger.info("sinks.start", sinks=[s.name for s in sinks])
    await asyncio.gather(
        *(asyncio.to_thread(_consume_topic_sync, s, settings) for s in sinks)
    )
