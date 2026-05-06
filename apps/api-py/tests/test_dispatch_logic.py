"""Unit tests for the resource ranker."""

from __future__ import annotations

from sentry_max_api.contracts import Point
from sentry_max_api.dispatch_logic import rank_resources, staging_area


def test_rank_resources_returns_top_n() -> None:
    sf = Point(coordinates=[-122.4194, 37.7749])
    candidates = rank_resources(sf, top_n=3)
    assert len(candidates) == 3
    # All distances refreshed and non-negative.
    for c in candidates:
        assert c.distance_meters >= 0
        assert c.eta_seconds >= 0


def test_rank_resources_prefers_closer_stations() -> None:
    sf = Point(coordinates=[-122.4194, 37.7749])
    top = rank_resources(sf, top_n=1)[0]
    assert top.distance_meters < 50_000  # within 50 km of SF


def test_staging_area_is_offset_from_hotspot() -> None:
    hotspot = Point(coordinates=[-122.4194, 37.7749])
    stage = staging_area(hotspot, wind_u=5.0, wind_v=0.0)
    # Wind blows east → staging is upwind (west).
    assert stage.coordinates[0] < hotspot.coordinates[0]


def test_staging_area_default_when_no_wind() -> None:
    hotspot = Point(coordinates=[-122.4194, 37.7749])
    stage = staging_area(hotspot, wind_u=0.0, wind_v=0.0)
    # Default offset is 2 km west.
    dx = hotspot.coordinates[0] - stage.coordinates[0]
    assert dx > 0
