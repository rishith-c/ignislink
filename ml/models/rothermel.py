"""Physics-informed cellular automaton baseline (Rothermel 1972).

Stage 3.A baseline. Pure NumPy, deterministic. Two roles:

1. Sanity baseline. Catches gross regressions in the neural model.
2. Feature channel. Rothermel rate-of-spread feeds the U-Net+ConvLSTM as one
   of its 13 input channels (PRD §5.3).

The math follows Rothermel (1972) INT-115 + Albini (1976) wind/slope correction
+ Andrews (2018) BehavePlus reference. Units are SI throughout. The CA driver
is a Huygens-style elliptical-front propagation on a 256×256 grid.

References:
    Rothermel, R. C. (1972). A mathematical model for predicting fire
    spread in wildland fuels. USDA Forest Service Research Paper INT-115.
    Andrews, P. L. (2018). The Rothermel surface fire spread model and
    associated developments: A comprehensive explanation. RMRS-GTR-371.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Final

import numpy as np
from numpy.typing import NDArray


# ───────────────────────── Fuel-bed parameters ──────────────────────────

@dataclass(frozen=True)
class FuelModel:
    """Subset of the FBFM40 fuel-bed parameters needed for surface spread.

    All units SI. Concrete fuel models load from LANDFIRE rasters at inference
    time; the dataclass lets us unit-test the math without raster IO.
    """

    sigma_one_over_m: float
    """Surface-area-to-volume ratio of the fuel bed (1/m)."""

    rho_p_kg_per_m3: float
    """Oven-dry particle density (kg/m^3). Wood ~ 512."""

    h_kj_per_kg: float
    """Heat content (kJ/kg). Most wildland fuels ~ 18 600."""

    s_t: float
    """Total mineral content (fraction). Typical 0.0555."""

    s_e: float
    """Effective mineral content (fraction). Typical 0.010."""

    m_x: float
    """Dead-fuel moisture of extinction (fraction). Typical 0.30."""

    w_o_kg_per_m2: float
    """Oven-dry fuel load (kg/m^2)."""

    delta_m: float
    """Fuel bed depth (m)."""


# A lightweight "GR2 — low load, dry climate grass" fuel model in SI units.
# Used as a default for tests + feature-channel sanity checks.
GR2_GRASS: Final[FuelModel] = FuelModel(
    sigma_one_over_m=4920.0,
    rho_p_kg_per_m3=512.0,
    h_kj_per_kg=18608.0,
    s_t=0.0555,
    s_e=0.0100,
    m_x=0.15,
    w_o_kg_per_m2=0.224,
    delta_m=0.305,
)


# ───────────────────────── Rate-of-spread math ──────────────────────────

def _reaction_velocity(fm: FuelModel, beta: float, beta_op: float) -> float:
    """Optimum reaction velocity Γ′ (1/min)."""
    sigma = fm.sigma_one_over_m
    a = 1.0 / (4.774 * sigma**0.1 - 7.27)
    gamma_max = (sigma**1.5) / (495.0 + 0.0594 * sigma**1.5)
    ratio = beta / beta_op
    return gamma_max * (ratio**a) * math.exp(a * (1.0 - ratio))


def _moisture_damping(moisture: float, m_x: float) -> float:
    """η_M — moisture damping coefficient (Rothermel 1972 eq. 53)."""
    rm = max(0.0, min(moisture / m_x, 1.0))
    return 1.0 - 2.59 * rm + 5.11 * rm**2 - 3.52 * rm**3


def _mineral_damping(s_e: float) -> float:
    """η_s — mineral damping coefficient (Rothermel 1972 eq. 56)."""
    return min(0.174 * (s_e**-0.19), 1.0)


def rate_of_spread_no_wind_no_slope(fm: FuelModel, moisture: float) -> float:
    """Rothermel R0 — base ROS on level ground, no wind. Returns m/s."""
    if not (0.0 <= moisture <= 1.0):
        raise ValueError("moisture must be a fraction in [0, 1]")
    if fm.delta_m <= 0 or fm.w_o_kg_per_m2 <= 0:
        return 0.0

    rho_b = fm.w_o_kg_per_m2 / fm.delta_m
    beta = rho_b / fm.rho_p_kg_per_m3
    beta_op = 3.348 * (fm.sigma_one_over_m**-0.8189)
    gamma_prime = _reaction_velocity(fm, beta, beta_op)

    eta_M = _moisture_damping(moisture, fm.m_x)
    eta_s = _mineral_damping(fm.s_e)

    w_n = fm.w_o_kg_per_m2 * (1.0 - fm.s_t)
    I_R = gamma_prime * w_n * fm.h_kj_per_kg * eta_M * eta_s

    xi = math.exp((0.792 + 0.681 * fm.sigma_one_over_m**0.5) * (beta + 0.1)) / (
        192.0 + 0.2595 * fm.sigma_one_over_m
    )
    eps = math.exp(-138.0 / fm.sigma_one_over_m)
    Q_ig = 581.0 + 2594.0 * moisture
    R_min_per_min = (I_R * xi) / (rho_b * eps * Q_ig)
    return max(R_min_per_min, 0.0) / 60.0


_M_PER_FT = 0.3048
# Open-10m → midflame wind attenuation factor for short grass (BehavePlus default
# in the absence of canopy). Concrete fuel models override this once the LANDFIRE
# canopy raster is wired in (PRD §5.2).
_MIDFLAME_ATTEN_GRASS = 0.40


def wind_correction(fm: FuelModel, wind_ms: float) -> float:
    """Φ_W — wind coefficient (Albini 1976).

    The empirical coefficients (C, B, E) were fit with sigma in 1/ft and wind
    in ft/min — the formula is **not** unit-invariant. We convert
    `sigma_one_over_m` → `sigma_one_over_ft` and the input `wind_ms` is
    treated as **open 10 m wind**, then scaled to midflame using a fuel-bed
    attenuation factor before substitution. Capped at φ_W = 12 to keep extreme
    winds from running away in the CA — BehavePlus uses an analogous
    'effective wind speed' cap in its release builds.
    """
    if wind_ms <= 0:
        return 0.0
    rho_b = fm.w_o_kg_per_m2 / fm.delta_m
    beta = rho_b / fm.rho_p_kg_per_m3
    sigma_ft = fm.sigma_one_over_m * _M_PER_FT  # 1/m → 1/ft
    beta_op = 3.348 * (sigma_ft**-0.8189)
    C = 7.47 * math.exp(-0.133 * sigma_ft**0.55)
    B = 0.02526 * sigma_ft**0.54
    E = 0.715 * math.exp(-3.59e-4 * sigma_ft)
    midflame_ms = wind_ms * _MIDFLAME_ATTEN_GRASS
    U_ft_min = midflame_ms * 196.85
    phi = C * (U_ft_min**B) * (beta / beta_op) ** (-E)
    return min(phi, 12.0)


def slope_correction(fm: FuelModel, slope_rad: float) -> float:
    """Φ_S — slope coefficient (Rothermel 1972). Dimensionless beta makes this
    unit-independent on the ratio side."""
    rho_b = fm.w_o_kg_per_m2 / fm.delta_m
    beta = rho_b / fm.rho_p_kg_per_m3
    return 5.275 * (beta**-0.3) * (math.tan(slope_rad) ** 2)


def rate_of_spread(
    fm: FuelModel,
    moisture: float,
    wind_ms: float,
    wind_dir_rad: float,
    slope_rad: float,
    aspect_rad: float,
) -> tuple[float, float]:
    """Rothermel R — ROS with wind + slope. Returns (ros_ms, dir_of_max_rad).

    The direction of maximum spread is the resultant of the wind and slope
    vectors weighted by their respective coefficients.
    """
    R0 = rate_of_spread_no_wind_no_slope(fm, moisture)
    if R0 <= 0:
        return 0.0, 0.0

    phi_w = wind_correction(fm, wind_ms)
    phi_s = slope_correction(fm, slope_rad)
    R = R0 * (1.0 + phi_w + phi_s)

    # Vector sum on a unit circle to find the direction of max spread.
    # Slope's "up-slope" direction is `aspect + π` (aspect is downslope).
    upslope = aspect_rad + math.pi
    x = phi_w * math.cos(wind_dir_rad) + phi_s * math.cos(upslope)
    y = phi_w * math.sin(wind_dir_rad) + phi_s * math.sin(upslope)
    direction = math.atan2(y, x) if (x or y) else wind_dir_rad
    return R, direction


# ───────────────────────── Cellular-automaton driver ────────────────────

def simulate_spread(
    ignition_mask: NDArray[np.bool_],
    fuel_grid: NDArray[np.int8] | None,
    moisture_grid: NDArray[np.float32] | None,
    wind_u_ms: NDArray[np.float32],
    wind_v_ms: NDArray[np.float32],
    slope_rad: NDArray[np.float32] | None,
    aspect_rad: NDArray[np.float32] | None,
    *,
    cell_size_m: float = 250.0,
    minutes: int = 60,
    minutes_per_step: int = 5,
) -> NDArray[np.float32]:
    """Huygens-style elliptical-front CA. Returns a [0,1] burn-probability raster.

    ignition_mask: bool grid, True where the fire is currently active.
    fuel_grid: int8 codes (currently treated as 0=non-burnable, otherwise GR2).
    moisture_grid: dead-fuel moisture fraction (defaults to 0.10 if None).
    wind_u_ms / wind_v_ms: east/north wind components, m/s.
    slope_rad / aspect_rad: terrain slope + aspect (radians); zero if None.
    cell_size_m: grid spacing, default 250 m.
    minutes: total simulated time; minutes_per_step: CA tick.

    Output is the probability that the cell will have burned by `minutes`. The
    "probability" comes from a small per-cell stochastic perturbation on the
    spread rate; deterministic seeding makes runs reproducible.
    """
    if ignition_mask.dtype != np.bool_:
        raise TypeError("ignition_mask must be bool")
    h, w = ignition_mask.shape
    if wind_u_ms.shape != (h, w) or wind_v_ms.shape != (h, w):
        raise ValueError("wind grids must match ignition_mask shape")

    moisture = moisture_grid if moisture_grid is not None else np.full((h, w), 0.10, np.float32)
    slope = slope_rad if slope_rad is not None else np.zeros((h, w), np.float32)
    aspect = aspect_rad if aspect_rad is not None else np.zeros((h, w), np.float32)
    fuel = fuel_grid if fuel_grid is not None else np.ones((h, w), np.int8)

    rng = np.random.default_rng(0)
    burning = ignition_mask.copy()
    burned = ignition_mask.copy()
    prob = np.where(burned, 1.0, 0.0).astype(np.float32)

    steps = max(1, minutes // minutes_per_step)
    dt_s = minutes_per_step * 60.0

    # 8-connected neighborhood offsets.
    nbrs: list[tuple[int, int]] = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]

    for _ in range(steps):
        if not burning.any():
            break
        ys, xs = np.where(burning)
        for y, x in zip(ys.tolist(), xs.tolist()):
            wind_speed = float(math.hypot(wind_u_ms[y, x], wind_v_ms[y, x]))
            wind_dir = math.atan2(wind_v_ms[y, x], wind_u_ms[y, x])
            ros_ms, dir_max = rate_of_spread(
                GR2_GRASS,
                float(moisture[y, x]),
                wind_speed,
                wind_dir,
                float(slope[y, x]),
                float(aspect[y, x]),
            )
            reach_m = ros_ms * dt_s

            for dy, dx in nbrs:
                ny, nx = y + dy, x + dx
                if not (0 <= ny < h and 0 <= nx < w):
                    continue
                if fuel[ny, nx] == 0 or burned[ny, nx]:
                    continue
                # Distance and angle to neighbor.
                d = cell_size_m * math.hypot(dy, dx)
                ang = math.atan2(dy, dx)
                # Elliptical compression along the cross-wind axis.
                eccentricity = min(0.5, wind_speed * 0.05)
                theta = ang - dir_max
                effective_reach = reach_m * (1.0 - eccentricity * (1.0 - math.cos(theta)))
                if effective_reach <= 0:
                    continue
                p = min(1.0, effective_reach / d) * (0.85 + 0.15 * rng.random())
                if p > prob[ny, nx]:
                    prob[ny, nx] = p
                if p >= 0.5:
                    burning[ny, nx] = True
                    burned[ny, nx] = True

    return prob.astype(np.float32)
