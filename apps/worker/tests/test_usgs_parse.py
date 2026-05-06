"""Unit tests for USGS earthquake + water parsers."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from sources.usgs_quakes import parse_quakes
from sources.usgs_water import parse_water

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


@pytest.fixture(scope="module")
def quakes_payload():
    with (FIXTURES / "usgs_quakes_sample.geojson").open() as fh:
        return json.load(fh)


@pytest.fixture(scope="module")
def water_payload():
    with (FIXTURES / "usgs_water_sample.json").open() as fh:
        return json.load(fh)


class TestUsgsQuakes:
    def test_returns_one_event_per_feature(self, quakes_payload):
        events = parse_quakes(quakes_payload)
        assert len(events) == 3

    def test_event_shape(self, quakes_payload):
        events = parse_quakes(quakes_payload)
        first = events[0]
        assert first["event_id"] == "ci40123456"
        assert first["source"] == "usgs"
        assert first["magnitude"] == pytest.approx(4.2)
        assert first["latitude"] == pytest.approx(33.547)
        assert first["longitude"] == pytest.approx(-116.439)
        assert first["depth_km"] == pytest.approx(8.4)
        assert first["tsunami"] is False
        assert first["observed_at"].startswith("2026-")

    def test_tsunami_alert_is_boolean(self, quakes_payload):
        events = parse_quakes(quakes_payload)
        for e in events:
            assert isinstance(e["tsunami"], bool)

    def test_handles_empty_feature_collection(self):
        events = parse_quakes({"type": "FeatureCollection", "features": []})
        assert events == []

    def test_skips_feature_without_time(self):
        broken = {
            "features": [
                {
                    "id": "x",
                    "properties": {"mag": 1.0},
                    "geometry": {"type": "Point", "coordinates": [0, 0, 0]},
                }
            ]
        }
        assert parse_quakes(broken) == []


class TestUsgsWater:
    def test_emits_one_event_per_observation(self, water_payload):
        events = parse_water(water_payload)
        # 4 observations on site 11425500 + 3 valid on 11447650 (the -999999 row drops).
        assert len(events) == 7

    def test_missing_value_marker_is_skipped(self, water_payload):
        events = parse_water(water_payload)
        for e in events:
            assert e["value"] > -1_000.0

    def test_event_shape(self, water_payload):
        events = parse_water(water_payload)
        first = events[0]
        assert first["site_code"] == "11425500"
        assert first["param_code"] == "00065"
        assert first["unit"] == "ft"
        assert first["latitude"] == pytest.approx(38.9013889)
        assert first["longitude"] == pytest.approx(-121.5908333)
        assert first["value"] == pytest.approx(12.45)
        assert first["observed_at"].startswith("2026-04-30T20:00:00")

    def test_handles_empty_payload(self):
        assert parse_water({}) == []
        assert parse_water({"value": {}}) == []
        assert parse_water({"value": {"timeSeries": []}}) == []
