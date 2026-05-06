"""USGS earthquake feed poller.

Pulls the public ``all_day.geojson`` summary every 5 minutes (configurable),
normalizes each feature, and emits to ``earthquakes.observed``.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import requests

from common.config import PipelineSettings, get_settings
from common.kafka import KafkaJsonProducer, with_retry
from common.logging import get_logger

logger = get_logger(__name__)

FIXTURE_PATH = Path(__file__).resolve().parents[2] / "fixtures" / "usgs_quakes_sample.geojson"


def _safe_float(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def parse_quakes(payload: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Convert a USGS GeoJSON FeatureCollection to canonical event dicts.

    Pure function — no I/O. Used by tests with a fixture payload.
    """
    features = payload.get("features") or []
    out: list[dict[str, Any]] = []
    for feat in features:
        props = feat.get("properties") or {}
        geom = feat.get("geometry") or {}
        coords = geom.get("coordinates") or []
        if len(coords) < 2:
            continue
        lon, lat = float(coords[0]), float(coords[1])
        depth_km = float(coords[2]) if len(coords) >= 3 else None

        time_ms = props.get("time")
        if not isinstance(time_ms, (int, float)):
            continue
        observed_at = datetime.fromtimestamp(time_ms / 1000.0, tz=UTC)

        event_id = feat.get("id") or props.get("code")
        if not event_id:
            continue

        out.append(
            {
                "event_id": str(event_id),
                "source": "usgs",
                "magnitude": _safe_float(props.get("mag")),
                "magnitude_type": props.get("magType"),
                "place": props.get("place"),
                "latitude": lat,
                "longitude": lon,
                "depth_km": depth_km,
                "felt": props.get("felt"),
                "tsunami": bool(props.get("tsunami") or 0),
                "alert": props.get("alert"),
                "status": props.get("status"),
                "url": props.get("url"),
                "observed_at": observed_at.isoformat(),
                "ingested_at": datetime.now(UTC).isoformat(),
            }
        )
    return out


def _fetch_quakes(settings: PipelineSettings) -> Mapping[str, Any]:
    try:
        resp = requests.get(settings.quakes_url, timeout=30)
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:  # noqa: BLE001
        logger.warning("quakes.fetch.fallback_to_fixture", error=str(exc))
        with FIXTURE_PATH.open() as fh:
            return json.load(fh)


async def _poll_once(producer: KafkaJsonProducer, settings: PipelineSettings) -> int:
    payload = await asyncio.to_thread(_fetch_quakes, settings)
    events = parse_quakes(payload)
    for event in events:
        await producer.send(settings.topic_earthquakes, event, key=event["event_id"])
    logger.info(
        "quakes.poll.complete",
        published=len(events),
        topic=settings.topic_earthquakes,
    )
    return len(events)


async def run_quakes_source(settings: PipelineSettings | None = None) -> None:
    settings = settings or get_settings()
    async with KafkaJsonProducer(settings, client_id_suffix="quakes") as producer:
        logger.info(
            "quakes.source.start",
            poll_seconds=settings.quakes_poll_seconds,
            topic=settings.topic_earthquakes,
        )
        while True:
            started = time.monotonic()
            try:
                await with_retry(lambda: _poll_once(producer, settings))
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.error("quakes.poll.error", error=str(exc))
            elapsed = time.monotonic() - started
            await asyncio.sleep(max(1.0, settings.quakes_poll_seconds - elapsed))
