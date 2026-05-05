"""Sanity tests for the dependency-free geo helpers."""

from __future__ import annotations

import pytest

from common.geo import geohash_encode, haversine_m


def test_haversine_zero():
    assert haversine_m(0, 0, 0, 0) == pytest.approx(0.0)


def test_haversine_known_distance():
    # SF -> NYC ≈ 4128 km. Generous tolerance for the spherical approximation.
    d = haversine_m(37.7749, -122.4194, 40.7128, -74.0060)
    assert 4_000_000 < d < 4_300_000


def test_geohash_precision_5_known_point():
    # Reference: the Eiffel Tower (48.8584, 2.2945) at precision 5 -> "u09tu".
    assert geohash_encode(48.8584, 2.2945, 5) == "u09tu"


def test_geohash_default_precision_is_5():
    assert len(geohash_encode(0, 0)) == 5


def test_geohash_invalid_precision():
    with pytest.raises(ValueError):
        geohash_encode(0, 0, 0)
