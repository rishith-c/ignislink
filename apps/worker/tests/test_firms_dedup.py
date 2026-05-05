"""Unit tests for FIRMS dedup + row normalization."""

from __future__ import annotations

import csv
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from sources.firms import FirmsDedupWindow, normalize_firms_row

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "firms_sample.csv"


def _row(lat: float, lon: float, when: datetime) -> dict:
    return {
        "latitude": lat,
        "longitude": lon,
        "observed_at": when.isoformat(),
    }


class TestFirmsDedupWindow:
    def test_within_radius_is_duplicate(self):
        window = FirmsDedupWindow(radius_m=375.0, window=timedelta(hours=24))
        now = datetime(2026, 4, 30, 21, 5, tzinfo=UTC)

        # First detection — survives.
        first = list(window.filter([_row(40.5821, -122.3115, now)]))
        assert len(first) == 1

        # Second within ~50m — must be filtered.
        too_close = list(
            window.filter([_row(40.5818, -122.3110, now + timedelta(minutes=8))])
        )
        assert too_close == []

    def test_outside_radius_passes(self):
        window = FirmsDedupWindow(radius_m=375.0, window=timedelta(hours=24))
        now = datetime(2026, 4, 30, 21, 5, tzinfo=UTC)
        kept = list(
            window.filter(
                [
                    _row(40.5821, -122.3115, now),
                    _row(40.6000, -122.3115, now + timedelta(minutes=2)),  # ~2 km north
                ]
            )
        )
        assert len(kept) == 2

    def test_old_entries_expire_outside_window(self):
        window = FirmsDedupWindow(radius_m=375.0, window=timedelta(hours=24))
        old = datetime(2026, 4, 28, 12, 0, tzinfo=UTC)
        new = old + timedelta(hours=25)

        list(window.filter([_row(40.5821, -122.3115, old)]))  # prime
        # Past the 24h horizon — same coordinate must be allowed again.
        kept = list(window.filter([_row(40.5821, -122.3115, new)]))
        assert len(kept) == 1

    def test_fixture_round_trip_drops_only_the_known_dup(self):
        with FIXTURE.open() as fh:
            rows = [normalize_firms_row(r) for r in csv.DictReader(fh)]
        rows = [r for r in rows if r is not None]

        window = FirmsDedupWindow(radius_m=375.0, window=timedelta(hours=24))
        kept = list(window.filter(rows))

        # Fixture has 10 rows. The only pair within 375 m radius is:
        #   (40.5821,-122.3115) vs (40.5818,-122.3110) ~54 m apart.
        # The (38.9472,-120.6533) / (38.9501,-120.6562) pair is ~410 m apart
        # and stays distinct. Net: one duplicate filtered -> 9 unique.
        assert len(kept) == 9

    def test_normalize_handles_missing_fields(self):
        assert normalize_firms_row({}) is None
        assert (
            normalize_firms_row(
                {"latitude": "abc", "longitude": "1", "acq_date": "2026-04-30", "acq_time": "2105"}
            )
            is None
        )

    def test_normalize_includes_canonical_fields(self):
        out = normalize_firms_row(
            {
                "latitude": "38.9472",
                "longitude": "-120.6533",
                "bright_ti4": "330.5",
                "scan": "0.39",
                "track": "0.36",
                "acq_date": "2026-04-30",
                "acq_time": "2105",
                "satellite": "N20",
                "instrument": "VIIRS",
                "confidence": "h",
                "frp": "12.4",
                "daynight": "N",
            }
        )
        assert out is not None
        assert out["source"] == "firms"
        assert out["latitude"] == pytest.approx(38.9472)
        assert out["longitude"] == pytest.approx(-120.6533)
        assert out["frp"] == pytest.approx(12.4)
        assert out["confidence"] == "h"
        assert out["observed_at"].endswith("+00:00")
        assert out["detection_id"].startswith("firms-n20-")
