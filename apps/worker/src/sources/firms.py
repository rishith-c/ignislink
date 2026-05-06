"""NASA FIRMS active-fire poller.

Pulls VIIRS_NOAA20_NRT detections from the FIRMS Area API every
``firms_poll_seconds`` (default 60), normalizes them into a stable JSON shape,
deduplicates against the last 24h within ``firms_dedup_radius_m`` (default
375 m — VIIRS pixel footprint), and publishes survivors to the
``detections.created`` Kafka topic.

When ``FIRMS_API_KEY`` is unset, falls back to ``apps/worker/fixtures/firms_sample.csv``
so the pipeline boots end-to-end with no credentials — critical for the demo.
"""

from __future__ import annotations

import asyncio
import csv
import io
import time
from collections import deque
from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import requests

from common.config import PipelineSettings, get_settings
from common.geo import haversine_m
from common.kafka import KafkaJsonProducer, with_retry
from common.logging import get_logger

logger = get_logger(__name__)

FIRMS_BASE_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
FIXTURE_PATH = Path(__file__).resolve().parents[2] / "fixtures" / "firms_sample.csv"


# ---------------------------------------------------------------------------
# Dedup window (pure data — easy to test, no I/O)
# ---------------------------------------------------------------------------


@dataclass
class _Entry:
    lat: float
    lon: float
    seen_at: datetime


@dataclass
class FirmsDedupWindow:
    """Sliding-window deduplicator for FIRMS detections.

    Two detections are duplicates when:
      1. They are within ``radius_m`` great-circle metres of each other, AND
      2. Both were observed within ``window`` of "now" (the most recent input).

    Internally an immutable-by-convention list of recent points is kept.
    Points falling out of the window are dropped on insert.
    """

    radius_m: float = 375.0
    window: timedelta = timedelta(hours=24)
    _entries: deque[_Entry] = field(default_factory=deque)

    def is_duplicate(self, lat: float, lon: float, observed_at: datetime) -> bool:
        cutoff = observed_at - self.window
        while self._entries and self._entries[0].seen_at < cutoff:
            self._entries.popleft()
        return any(
            haversine_m(lat, lon, e.lat, e.lon) <= self.radius_m for e in self._entries
        )

    def remember(self, lat: float, lon: float, observed_at: datetime) -> None:
        self._entries.append(_Entry(lat=lat, lon=lon, seen_at=observed_at))

    def filter(
        self, rows: Iterable[Mapping[str, Any]]
    ) -> Iterator[Mapping[str, Any]]:
        """Yield only rows that are not duplicates and update the window."""
        for row in rows:
            lat = float(row["latitude"])
            lon = float(row["longitude"])
            obs = row["observed_at"]
            if isinstance(obs, str):
                obs = datetime.fromisoformat(obs.replace("Z", "+00:00"))
            if self.is_duplicate(lat, lon, obs):
                continue
            self.remember(lat, lon, obs)
            yield row


# ---------------------------------------------------------------------------
# Row normalization
# ---------------------------------------------------------------------------


def _parse_observed_at(date_str: str, time_str: str) -> datetime:
    """FIRMS CSV provides ``acq_date`` (YYYY-MM-DD) and ``acq_time`` (HHMM, UTC)."""
    time_str = time_str.zfill(4)
    hh, mm = int(time_str[:2]), int(time_str[2:])
    yyyy, mo, dd = (int(p) for p in date_str.split("-"))
    return datetime(yyyy, mo, dd, hh, mm, tzinfo=UTC)


def _safe_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def normalize_firms_row(row: Mapping[str, str]) -> dict[str, Any] | None:
    """Map a raw FIRMS CSV row to the canonical Kafka payload shape.

    Returns ``None`` when required fields are missing — never raises so the
    poller can keep going on a partial feed.
    """
    try:
        lat = float(row["latitude"])
        lon = float(row["longitude"])
    except (KeyError, ValueError):
        return None

    try:
        observed_at = _parse_observed_at(row["acq_date"], row["acq_time"])
    except (KeyError, ValueError):
        return None

    detection_id = (
        f"firms-{row.get('satellite', 'NOAA20').lower()}-"
        f"{lat:.5f}-{lon:.5f}-{int(observed_at.timestamp())}"
    )

    return {
        "detection_id": detection_id,
        "source": "firms",
        "satellite": row.get("satellite") or "NOAA20",
        "instrument": row.get("instrument") or "VIIRS",
        "latitude": lat,
        "longitude": lon,
        "brightness": _safe_float(row.get("bright_ti4") or row.get("brightness")),
        "frp": _safe_float(row.get("frp")),
        "confidence": (row.get("confidence") or "n").strip().lower(),
        "daynight": (row.get("daynight") or "").strip().upper() or None,
        "scan": _safe_float(row.get("scan")),
        "track": _safe_float(row.get("track")),
        "observed_at": observed_at.isoformat(),
        "ingested_at": datetime.now(UTC).isoformat(),
    }


# ---------------------------------------------------------------------------
# Fetch + poll loop
# ---------------------------------------------------------------------------


def _fixture_rows() -> list[dict[str, str]]:
    with FIXTURE_PATH.open() as fh:
        return list(csv.DictReader(fh))


def _fetch_firms_csv(settings: PipelineSettings) -> list[dict[str, str]]:
    """Fetch live FIRMS CSV. Falls back to fixture when no API key is configured."""
    if not settings.firms_api_key:
        logger.info("firms.fixture_mode", reason="FIRMS_API_KEY unset")
        return _fixture_rows()

    url = (
        f"{FIRMS_BASE_URL}/{settings.firms_api_key}/{settings.firms_source}/"
        f"{settings.firms_area}/{settings.firms_days}"
    )
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    body = resp.text
    if not body.strip() or body.lstrip().startswith("Invalid"):
        logger.warning("firms.empty_response", body_head=body[:120])
        return []
    reader = csv.DictReader(io.StringIO(body))
    return list(reader)


async def _poll_once(
    producer: KafkaJsonProducer,
    dedup: FirmsDedupWindow,
    settings: PipelineSettings,
) -> int:
    raw_rows = await asyncio.to_thread(_fetch_firms_csv, settings)
    normalized = (n for n in (normalize_firms_row(r) for r in raw_rows) if n is not None)
    survivors = list(dedup.filter(normalized))

    for event in survivors:
        await producer.send(
            settings.topic_detections,
            event,
            key=event["detection_id"],
        )
    logger.info(
        "firms.poll.complete",
        raw=len(raw_rows),
        published=len(survivors),
        topic=settings.topic_detections,
    )
    return len(survivors)


async def run_firms_source(settings: PipelineSettings | None = None) -> None:
    """Long-running FIRMS poller. Cancellation-safe."""
    settings = settings or get_settings()
    dedup = FirmsDedupWindow(
        radius_m=settings.firms_dedup_radius_m,
        window=timedelta(hours=settings.firms_dedup_window_hours),
    )

    async with KafkaJsonProducer(settings, client_id_suffix="firms") as producer:
        logger.info(
            "firms.source.start",
            poll_seconds=settings.firms_poll_seconds,
            topic=settings.topic_detections,
            has_api_key=bool(settings.firms_api_key),
        )
        while True:
            started = time.monotonic()
            try:
                await with_retry(lambda: _poll_once(producer, dedup, settings))
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.error("firms.poll.error", error=str(exc))
            elapsed = time.monotonic() - started
            sleep_for = max(1.0, settings.firms_poll_seconds - elapsed)
            await asyncio.sleep(sleep_for)
