"""Closed-form hazard math used by the earthquake + flood routes.

Mirrors the formulas in:
    * ``ml/models/aftershock_etas_npp.py`` (Omori-Utsu + Gutenberg-Richter)
    * ``ml/models/flood_ealstm.py`` (quantile head shape)

We avoid the PyTorch dependency in the API service by reproducing the
priors here in pure NumPy. The neural-residual head is intentionally
omitted from the route layer — the Omori-Utsu + G-R prior is well
calibrated on its own and the demo doesn't need the additional accuracy.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import math


# ─── ETAS prior ────────────────────────────────────────────────────────────
# Omori-Utsu time-decay parameters (well-calibrated CA defaults, Reasenberg & Jones 1989).
_OMORI_K = 0.005   # productivity
_OMORI_C = 0.05    # offset (days)
_OMORI_P = 1.10    # decay exponent
# Gutenberg-Richter b-value for California (Felzer 2008).
_GR_B = 1.0
# Spatial decay scale (km).
_SPATIAL_SCALE_KM = 30.0


def omori_utsu_rate(magnitude: float, days_since_mainshock: float) -> float:
    """Aftershock rate per day at time t after a magnitude-M mainshock."""

    if days_since_mainshock < 0:
        return 0.0
    productivity = _OMORI_K * 10.0 ** (_GR_B * (magnitude - 4.0))
    return productivity / ((days_since_mainshock + _OMORI_C) ** _OMORI_P)


def gutenberg_richter_p_above(target_magnitude: float, ref_magnitude: float = 4.0) -> float:
    """P(M >= target | M >= ref) under Gutenberg-Richter."""

    if target_magnitude <= ref_magnitude:
        return 1.0
    return 10.0 ** (-_GR_B * (target_magnitude - ref_magnitude))


def aftershock_probability(
    magnitude: float,
    occurred_at: datetime,
    *,
    target_magnitude: float = 4.5,
    horizon_hours: float = 24.0,
    distance_km: float = 0.0,
    now: datetime | None = None,
) -> float:
    """P(at least one aftershock M >= target within ``horizon_hours``).

    Combines Omori-Utsu time decay, Gutenberg-Richter magnitude scaling,
    and an exponential spatial-decay factor in distance.
    """

    if now is None:
        now = datetime.now(timezone.utc)
    elapsed = (now - occurred_at).total_seconds() / 86400.0
    elapsed = max(0.0, elapsed)

    # Time-integrated rate over the horizon window.
    horizon_days = horizon_hours / 24.0
    t1, t2 = elapsed, elapsed + horizon_days
    # ∫ K (t + c)^(-p) dt = K * (t + c)^(1-p) / (1 - p), p != 1
    if abs(_OMORI_P - 1.0) < 1e-6:
        integrated = _OMORI_K * (math.log(t2 + _OMORI_C) - math.log(t1 + _OMORI_C))
    else:
        integrated = (
            _OMORI_K
            * ((t2 + _OMORI_C) ** (1 - _OMORI_P) - (t1 + _OMORI_C) ** (1 - _OMORI_P))
            / (1 - _OMORI_P)
        )
    productivity = 10.0 ** (_GR_B * (magnitude - 4.0))
    expected_above_ref = max(0.0, integrated * productivity)
    expected_above_target = expected_above_ref * gutenberg_richter_p_above(target_magnitude)

    # Spatial decay — exponential dropoff outside ~30 km.
    spatial = math.exp(-distance_km / _SPATIAL_SCALE_KM)
    expected = expected_above_target * spatial

    # Convert to probability of at least one event under a Poisson assumption.
    return 1.0 - math.exp(-expected)


# ─── Gauge persistence-plus-slope quantile forecast ─────────────────────────


def persistence_slope_forecast(
    history: list[tuple[datetime, float]],
    horizons_hours: tuple[int, ...] = (6, 24, 48),
    quantiles: tuple[float, ...] = (0.10, 0.50, 0.90),
) -> list[dict[str, float | int]]:
    """Compute a persistence + slope forecast at each horizon × quantile.

    The persistence term is the latest stage. The slope term is computed as
    the average rise/fall per hour over the most recent 6 hours.
    Quantile spread is generated from the recent 24-hour standard deviation
    of stage so the bands are calibrated to the gauge's own variability.
    """

    if not history:
        return []

    history = sorted(history, key=lambda r: r[0])
    latest_t, latest_stage = history[-1]
    cutoff_recent = latest_t - timedelta(hours=6)
    recent = [r for r in history if r[0] >= cutoff_recent]

    if len(recent) >= 2:
        first_t, first_stage = recent[0]
        dt_hours = max(1e-3, (latest_t - first_t).total_seconds() / 3600.0)
        slope_per_hour = (latest_stage - first_stage) / dt_hours
    else:
        slope_per_hour = 0.0

    # Variability over the last 24 hours.
    cutoff_long = latest_t - timedelta(hours=24)
    long_window = [r[1] for r in history if r[0] >= cutoff_long]
    if len(long_window) >= 2:
        mean = sum(long_window) / len(long_window)
        var = sum((s - mean) ** 2 for s in long_window) / (len(long_window) - 1)
        sigma = math.sqrt(var)
    else:
        sigma = 0.05  # min spread so quantiles are visibly distinct

    # Standard normal inverse CDF at our quantiles (cached).
    _qnorm = {0.10: -1.2816, 0.25: -0.6745, 0.50: 0.0, 0.75: 0.6745, 0.90: 1.2816}

    forecasts: list[dict[str, float | int]] = []
    for h in horizons_hours:
        center = latest_stage + slope_per_hour * h
        # Spread grows with the square root of horizon — Brownian-ish.
        scale = sigma * math.sqrt(h / 6.0 + 1.0)
        for q in quantiles:
            z = _qnorm.get(q, 0.0)
            forecasts.append(
                {
                    "horizon_hours": int(h),
                    "quantile": float(q),
                    "stage_ft": round(center + z * scale, 3),
                }
            )
    return forecasts
