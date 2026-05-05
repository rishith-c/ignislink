"""USGS NWIS instantaneous-values poller (gauge-stage parameter 00065).

Pulls California gauge stage every 15 minutes by default and publishes one
Kafka event per (site, observation_at) tuple to ``gauges.stage``.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Iterable, Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import requests

from common.config import PipelineSettings, get_settings
from common.kafka import KafkaJsonProducer, with_retry
from common.logging import get_logger

logger = get_logger(__name__)

FIXTURE_PATH = Path(__file__).resolve().parents[2] / "fixtures" / "usgs_water_sample.json"


def _safe_float(value: Any) -> float | None:
    try:
        f = float(value) if value is not None else None
        # USGS uses -999999 to indicate missing.
        if f is None or f <= -9_999.0:
            return None
        return f
    except (TypeError, ValueError):
        return None


def parse_water(payload: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Convert a USGS NWIS IV JSON payload to canonical events."""
    series: Iterable[Mapping[str, Any]] = (
        ((payload.get("value") or {}).get("timeSeries")) or []
    )
    now_iso = datetime.now(UTC).isoformat()
    out: list[dict[str, Any]] = []

    for ts in series:
        source_info = ts.get("sourceInfo") or {}
        site_code = (source_info.get("siteCode") or [{}])[0].get("value")
        if not site_code:
            continue
        site_name = source_info.get("siteName")
        loc = source_info.get("geoLocation", {}).get("geogLocation", {})
        lat = _safe_float(loc.get("latitude"))
        lon = _safe_float(loc.get("longitude"))
        variable = ts.get("variable") or {}
        unit = (variable.get("unit") or {}).get("unitCode")
        param_code = (variable.get("variableCode") or [{}])[0].get("value")

        for block in ts.get("values") or []:
            for v in block.get("value") or []:
                value_f = _safe_float(v.get("value"))
                if value_f is None:
                    continue
                ts_str = v.get("dateTime")
                if not ts_str:
                    continue
                try:
                    observed_at = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                except ValueError:
                    continue
                out.append(
                    {
                        "site_code": site_code,
                        "site_name": site_name,
                        "param_code": param_code,
                        "unit": unit,
                        "value": value_f,
                        "latitude": lat,
                        "longitude": lon,
                        "observed_at": observed_at.isoformat(),
                        "ingested_at": now_iso,
                    }
                )
    return out


def _fetch_water(settings: PipelineSettings) -> Mapping[str, Any]:
    try:
        resp = requests.get(settings.water_url, timeout=30)
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:  # noqa: BLE001
        logger.warning("water.fetch.fallback_to_fixture", error=str(exc))
        with FIXTURE_PATH.open() as fh:
            return json.load(fh)


async def _poll_once(producer: KafkaJsonProducer, settings: PipelineSettings) -> int:
    payload = await asyncio.to_thread(_fetch_water, settings)
    events = parse_water(payload)
    for event in events:
        key = f"{event['site_code']}|{event['observed_at']}"
        await producer.send(settings.topic_gauges, event, key=key)
    logger.info(
        "water.poll.complete",
        published=len(events),
        topic=settings.topic_gauges,
    )
    return len(events)


async def run_water_source(settings: PipelineSettings | None = None) -> None:
    settings = settings or get_settings()
    async with KafkaJsonProducer(settings, client_id_suffix="water") as producer:
        logger.info(
            "water.source.start",
            poll_seconds=settings.water_poll_seconds,
            topic=settings.topic_gauges,
        )
        while True:
            started = time.monotonic()
            try:
                await with_retry(lambda: _poll_once(producer, settings))
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.error("water.poll.error", error=str(exc))
            elapsed = time.monotonic() - started
            await asyncio.sleep(max(1.0, settings.water_poll_seconds - elapsed))
