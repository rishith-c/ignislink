"""Unit tests for the closed-form aftershock + flood priors.

These mirror the test contracts already covered for the PyTorch model in
``ml/__tests__/test_aftershock.py``.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sentry_max_api.hazard_math import (
    aftershock_probability,
    gutenberg_richter_p_above,
    omori_utsu_rate,
    persistence_slope_forecast,
)


def test_omori_decays_with_time() -> None:
    early = omori_utsu_rate(magnitude=5.0, days_since_mainshock=0.1)
    late = omori_utsu_rate(magnitude=5.0, days_since_mainshock=10.0)
    assert early > late > 0


def test_gutenberg_richter_monotone() -> None:
    assert gutenberg_richter_p_above(4.0) > gutenberg_richter_p_above(5.0)
    assert gutenberg_richter_p_above(5.0) > gutenberg_richter_p_above(6.0)


def test_aftershock_probability_in_unit_interval() -> None:
    occurred = datetime.now(timezone.utc) - timedelta(hours=2)
    p = aftershock_probability(magnitude=5.5, occurred_at=occurred)
    assert 0.0 <= p <= 1.0


def test_aftershock_probability_drops_with_distance() -> None:
    occurred = datetime.now(timezone.utc) - timedelta(hours=2)
    near = aftershock_probability(magnitude=5.5, occurred_at=occurred, distance_km=0.0)
    far = aftershock_probability(magnitude=5.5, occurred_at=occurred, distance_km=400.0)
    assert near > far


def test_persistence_forecast_emits_three_horizons_three_quantiles() -> None:
    now = datetime.now(timezone.utc)
    history = [
        (now - timedelta(hours=24), 5.0),
        (now - timedelta(hours=18), 5.1),
        (now - timedelta(hours=12), 5.4),
        (now - timedelta(hours=6), 5.7),
        (now, 6.0),
    ]
    bins = persistence_slope_forecast(history)
    assert len(bins) == 9  # 3 horizons × 3 quantiles
    horizons = {b["horizon_hours"] for b in bins}
    assert horizons == {6, 24, 48}
    quantiles = {b["quantile"] for b in bins}
    assert quantiles == {0.10, 0.50, 0.90}


def test_persistence_quantiles_are_ordered() -> None:
    now = datetime.now(timezone.utc)
    history = [
        (now - timedelta(hours=24), 5.0),
        (now - timedelta(hours=12), 5.5),
        (now, 6.0),
    ]
    bins = persistence_slope_forecast(history)
    by_horizon: dict[int, dict[float, float]] = {}
    for b in bins:
        by_horizon.setdefault(int(b["horizon_hours"]), {})[float(b["quantile"])] = float(
            b["stage_ft"]
        )
    for h, q_map in by_horizon.items():
        assert q_map[0.10] <= q_map[0.50] <= q_map[0.90]
