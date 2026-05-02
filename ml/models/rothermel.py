"""Physics-informed cellular automata baseline (Rothermel 1972).

This is the Stage 3.A sanity baseline. Pure NumPy, deterministic. Calibrated
against BehavePlus reference outputs in tests. Used in two ways:

1. Sanity check — does the predicted spread plausibly match observed FIRMS
   propagation in the validation set? Catches obvious regressions.
2. Feature channel — Rothermel-derived rate-of-spread is one of the input
   channels to the U-Net + ConvLSTM primary model.

References:
    Rothermel, R. C. (1972). A mathematical model for predicting fire
    spread in wildland fuels. USDA Forest Service Research Paper INT-115.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FuelModel:
    """Subset of the FBFM40 fuel-bed parameters needed for surface-spread.

    All units SI. Concrete fuel models are loaded from LANDFIRE rasters at
    inference time; the dataclass exists so we can unit-test the math
    independently of raster IO.
    """

    sigma_one_over_m: float
    """Surface-area-to-volume ratio of the fuel bed (m^-1)."""

    rho_p_kg_per_m3: float
    """Oven-dry particle density (kg/m^3)."""

    h_kj_per_kg: float
    """Heat content (kJ/kg)."""

    s_t: float
    """Total mineral content (fraction)."""

    s_e: float
    """Effective mineral content (fraction)."""

    m_x: float
    """Moisture of extinction (fraction)."""

    w_o_kg_per_m2: float
    """Oven-dry fuel load (kg/m^2)."""

    delta_m: float
    """Fuel bed depth (m)."""


def rate_of_spread_no_wind_no_slope(_fm: FuelModel, _moisture: float) -> float:
    """Rothermel R0 — base rate of spread on level ground with no wind.

    NOTE: stub. The full formulation has ~30 lines of NumPy; we'll land it
    when Stage 3.A starts. Keeping this signature here so tests and the
    feature-channel pipeline can wire up against a stable interface.

    Returns m/s. Always non-negative.
    """
    raise NotImplementedError("Implemented in Stage 3.A — see PRD §5.3 (baseline).")


def rate_of_spread(
    _fm: FuelModel,
    _moisture: float,
    _wind_speed_ms: float,
    _wind_dir_rad: float,
    _slope_rad: float,
    _aspect_rad: float,
) -> float:
    """Rothermel R — rate of spread with wind + slope correction.

    Returns m/s in the direction of maximum spread. Direction is wind-aligned
    when wind dominates terrain; slope-aligned when slope dominates.
    """
    raise NotImplementedError("Implemented in Stage 3.A — see PRD §5.3 (baseline).")
