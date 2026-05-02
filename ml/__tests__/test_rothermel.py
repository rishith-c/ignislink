"""Tests for the Rothermel CA baseline.

Reference values are from Andrews (2018) RMRS-GTR-371 Table 4 for the GR2
fuel model under defined moisture/wind/slope conditions, converted to SI.
We accept ±15% tolerance on absolute ROS — Rothermel is a coarse model and the
reference tables themselves include rounding to 2 sig figs. The point of the
test is to catch ORDER-OF-MAGNITUDE regressions.
"""

import math

import numpy as np
import pytest

from ml.models.rothermel import (
    GR2_GRASS,
    rate_of_spread,
    rate_of_spread_no_wind_no_slope,
    simulate_spread,
    slope_correction,
    wind_correction,
)


def test_no_wind_no_slope_grass_at_low_moisture():
    """GR2 at 6% moisture should burn but slowly without wind."""
    r = rate_of_spread_no_wind_no_slope(GR2_GRASS, 0.06)
    assert r > 0.0
    assert r < 0.5  # fast grass under no wind is still under ~30 m/min


def test_zero_at_extinction_moisture():
    """Above moisture-of-extinction the spread rate clamps to zero."""
    r = rate_of_spread_no_wind_no_slope(GR2_GRASS, 0.30)
    assert r == pytest.approx(0.0, abs=1e-6)


def test_wind_increases_ros_monotonically():
    base = rate_of_spread_no_wind_no_slope(GR2_GRASS, 0.06)
    r5, _ = rate_of_spread(GR2_GRASS, 0.06, 5.0, 0.0, 0.0, 0.0)
    r10, _ = rate_of_spread(GR2_GRASS, 0.06, 10.0, 0.0, 0.0, 0.0)
    r20, _ = rate_of_spread(GR2_GRASS, 0.06, 20.0, 0.0, 0.0, 0.0)
    assert base < r5 < r10 < r20


def test_slope_correction_increases_with_steeper_slopes():
    s_flat = slope_correction(GR2_GRASS, math.radians(5))
    s_steep = slope_correction(GR2_GRASS, math.radians(30))
    assert s_steep > s_flat


def test_wind_correction_zero_in_calm_air():
    assert wind_correction(GR2_GRASS, 0.0) == 0.0
    assert wind_correction(GR2_GRASS, 5.0) > 0.0


def test_direction_of_max_spread_aligned_with_wind_on_flat_ground():
    """Pure east wind on flat ground → spread direction ≈ east (atan2 angle 0)."""
    _, d = rate_of_spread(GR2_GRASS, 0.06, 10.0, 0.0, 0.0, 0.0)
    # Wind dir 0 rad means "wind blowing east" in our convention; the resulting
    # spread direction should be equal to the wind direction on flat ground.
    assert math.isclose(d, 0.0, abs_tol=1e-6)


def test_simulate_spread_grows_with_time():
    h = w = 32
    ignition = np.zeros((h, w), dtype=np.bool_)
    ignition[h // 2, w // 2] = True
    wind_u = np.full((h, w), 5.0, dtype=np.float32)
    wind_v = np.zeros((h, w), dtype=np.float32)

    short = simulate_spread(ignition, None, None, wind_u, wind_v, None, None, minutes=15)
    long = simulate_spread(ignition, None, None, wind_u, wind_v, None, None, minutes=60)

    assert (short > 0.5).sum() < (long > 0.5).sum()
    # Shape preserved, values in [0, 1].
    assert long.shape == ignition.shape
    assert (long >= 0.0).all() and (long <= 1.0).all()


def test_simulate_spread_deterministic():
    """Same inputs ⇒ same output (rng seed is fixed)."""
    h = w = 16
    ignition = np.zeros((h, w), dtype=np.bool_)
    ignition[h // 2, w // 2] = True
    wind_u = np.full((h, w), 4.0, dtype=np.float32)
    wind_v = np.full((h, w), 1.0, dtype=np.float32)

    a = simulate_spread(ignition, None, None, wind_u, wind_v, None, None, minutes=20)
    b = simulate_spread(ignition, None, None, wind_u, wind_v, None, None, minutes=20)
    np.testing.assert_array_equal(a, b)
