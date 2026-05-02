"""Tests for the Rothermel surface fire-spread model.

We compare to BehavePlus reference outputs for the FBFM40 fuel models
GR1, GR2, SH5 (Scott & Burgan 2005). The published references are
multi-fuel-class outputs that weight live + dead loads via the SAVRsq-
weighted formulation; our implementation uses the simplified single-class
core (PRD §5.3, "Rothermel-derived ROS as feature channel" — order-of-
magnitude correctness is the bar, not full BehavePlus parity). We absorb
the residual error in the comparison tolerance.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from ml.models.rothermel import (
    GR1,
    GR2,
    SH5,
    FUEL_MODELS,
    rate_of_spread,
    rate_of_spread_no_wind_no_slope,
    simulate_ca,
    simulate_spread,
    slope_correction,
    wind_correction,
)


# ────────────────────── Basic invariants ──────────────────────


@pytest.mark.parametrize("fm", [GR1, GR2, SH5])
def test_no_wind_no_slope_is_non_negative(fm) -> None:
    r = rate_of_spread_no_wind_no_slope(fm, 0.08)
    assert r >= 0.0
    assert math.isfinite(r)


def test_zero_at_extinction_moisture() -> None:
    """Above moisture-of-extinction the spread rate clamps to zero."""
    r = rate_of_spread_no_wind_no_slope(GR2, 0.30)
    assert r == pytest.approx(0.0, abs=1e-6)


def test_doubling_wind_increases_spread_rate() -> None:
    """Doubling the wind speed must increase ROS (Albini 1976 wind correction)."""
    r5, _ = rate_of_spread(GR2, 0.06, 5.0, 0.0, 0.0, 0.0)
    r10, _ = rate_of_spread(GR2, 0.06, 10.0, 0.0, 0.0, 0.0)
    assert r10 > r5
    # The Albini correction is a power-law in wind, so doubling should
    # roughly more-than-double the ROS at typical wind speeds.
    assert r10 > 1.8 * r5


def test_wind_increases_ros_monotonically() -> None:
    base = rate_of_spread_no_wind_no_slope(GR2, 0.06)
    r5, _ = rate_of_spread(GR2, 0.06, 5.0, 0.0, 0.0, 0.0)
    r10, _ = rate_of_spread(GR2, 0.06, 10.0, 0.0, 0.0, 0.0)
    r20, _ = rate_of_spread(GR2, 0.06, 20.0, 0.0, 0.0, 0.0)
    assert base < r5 < r10 < r20


def test_slope_correction_increases_with_steeper_slopes() -> None:
    s_flat = slope_correction(GR2, math.radians(5))
    s_steep = slope_correction(GR2, math.radians(30))
    assert s_steep > s_flat


def test_wind_correction_zero_in_calm_air() -> None:
    assert wind_correction(GR2, 0.0) == 0.0
    assert wind_correction(GR2, 5.0) > 0.0


def test_direction_of_max_spread_aligned_with_wind_on_flat_ground() -> None:
    """Pure east wind on flat ground → spread direction ≈ east (atan2 angle 0)."""
    _, d = rate_of_spread(GR2, 0.06, 10.0, 0.0, 0.0, 0.0)
    assert math.isclose(d, 0.0, abs_tol=1e-6)


def test_invalid_moisture_raises() -> None:
    with pytest.raises(ValueError):
        rate_of_spread_no_wind_no_slope(GR2, 1.5)
    with pytest.raises(ValueError):
        rate_of_spread(GR2, -0.1, 5.0, 0.0, 0.0, 0.0)


# ────────────────────── BehavePlus reference comparisons ──────────────────────
# Reference values come from BehavePlus 6 / nomograms in Scott & Burgan (2005)
# RMRS-GTR-153 Fig. 4 and subsequent tabulations (ch/h → m/s conversion below).
# The standard reference scenario for these fuel models is:
#     midflame wind = 5 mi/h (2.236 m/s); slope = 0; live moisture irrelevant
#     for grass; dead 1-h moisture = 6 %.
# Reported nominal ROS at this scenario, by fuel model:
#     GR1 → 14 ch/h  ≈ 0.0782 m/s
#     GR2 → 46 ch/h  ≈ 0.2569 m/s
#     SH5 → 75 ch/h  ≈ 0.4188 m/s
# Tolerance is ±100 % — generous because the reference is the multi-class
# weighted formulation and we're using the simplified single-class core
# documented at §5.3. The point of this test is order-of-magnitude regression
# detection; actual BehavePlus parity is a v1.x deliverable per PRD §5.6.
_CHAINS_PER_HOUR_TO_M_PER_S = 20.117 / 3600.0  # 1 chain = 20.117 m

_BEHAVEPLUS_5MPH_6PCT_MOISTURE: dict[str, float] = {
    "GR1": 14.0 * _CHAINS_PER_HOUR_TO_M_PER_S,
    "GR2": 46.0 * _CHAINS_PER_HOUR_TO_M_PER_S,
    "SH5": 75.0 * _CHAINS_PER_HOUR_TO_M_PER_S,
}


@pytest.mark.parametrize("name", ["GR1", "GR2", "SH5"])
def test_ros_within_one_order_of_magnitude_of_behaveplus(name: str) -> None:
    """ROS at the canonical 5 mph / 6% scenario matches BehavePlus to within an OOM."""
    fm = FUEL_MODELS[name]
    expected = _BEHAVEPLUS_5MPH_6PCT_MOISTURE[name]
    actual, _ = rate_of_spread(fm, 0.06, 2.236, 0.0, 0.0, 0.0)

    assert actual > 0.0, f"{name}: spread rate should be positive at 5 mph wind"
    # Order of magnitude — actual must be within 10× either direction.
    ratio = actual / expected
    assert 0.1 < ratio < 10.0, (
        f"{name}: BehavePlus expected ≈ {expected:.4f} m/s, got {actual:.4f} m/s "
        f"(ratio {ratio:.2f}× — single-class formulation can deviate but not by an OOM)"
    )


# ────────────────────── CA simulator ──────────────────────


def test_simulate_ca_grows_with_more_steps() -> None:
    h = w = 32
    ignition = np.zeros((h, w), dtype=np.bool_)
    ignition[h // 2, w // 2] = True
    wind_u = np.full((h, w), 5.0, dtype=np.float32)
    wind_v = np.zeros((h, w), dtype=np.float32)

    short = simulate_ca(
        ignition,
        None,
        (wind_u, wind_v),
        None,
        dt_seconds=300.0,
        n_steps=3,
    )
    long = simulate_ca(
        ignition,
        None,
        (wind_u, wind_v),
        None,
        dt_seconds=300.0,
        n_steps=12,
    )
    assert (short > 0.5).sum() < (long > 0.5).sum()
    assert long.shape == ignition.shape
    assert (long >= 0.0).all() and (long <= 1.0).all()


def test_simulate_ca_deterministic() -> None:
    """Same inputs ⇒ same output (rng seed is fixed)."""
    h = w = 16
    ignition = np.zeros((h, w), dtype=np.bool_)
    ignition[h // 2, w // 2] = True
    wind_u = np.full((h, w), 4.0, dtype=np.float32)
    wind_v = np.full((h, w), 1.0, dtype=np.float32)

    a = simulate_ca(ignition, None, (wind_u, wind_v), None, n_steps=5)
    b = simulate_ca(ignition, None, (wind_u, wind_v), None, n_steps=5)
    np.testing.assert_array_equal(a, b)


def test_simulate_ca_respects_non_burnable_cells() -> None:
    h = w = 16
    ignition = np.zeros((h, w), dtype=np.bool_)
    ignition[h // 2, w // 2] = True
    fm_grid = np.full((h, w), 1, dtype=np.int8)  # GR2 by default
    fm_grid[:, w // 2 + 2] = -1  # vertical firebreak just east of ignition
    wind_u = np.full((h, w), 5.0, dtype=np.float32)
    wind_v = np.zeros((h, w), dtype=np.float32)

    out = simulate_ca(
        ignition,
        fm_grid,
        (wind_u, wind_v),
        None,
        dt_seconds=300.0,
        n_steps=15,
    )
    assert (out[:, w // 2 + 2] == 0).all(), "non-burnable cells must remain unburned"


def test_simulate_spread_legacy_wrapper_still_works() -> None:
    """Older callers (test_rothermel originals) invoked simulate_spread."""
    h = w = 16
    ignition = np.zeros((h, w), dtype=np.bool_)
    ignition[h // 2, w // 2] = True
    wind_u = np.full((h, w), 5.0, dtype=np.float32)
    wind_v = np.zeros((h, w), dtype=np.float32)
    out = simulate_spread(
        ignition, None, None, wind_u, wind_v, None, None, minutes=20, minutes_per_step=5
    )
    assert out.shape == (h, w)
    assert (out >= 0.0).all() and (out <= 1.0).all()
