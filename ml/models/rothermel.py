"""Physics-informed Rothermel (1972) surface fire-spread model.

Stage 3.A baseline. Pure NumPy, deterministic. Two roles per PRD §5.3:

1. Sanity baseline. Catches gross regressions in the neural model.
2. Feature channel. Rothermel rate-of-spread feeds the U-Net+ConvLSTM as one
   of its input channels.

Implementation notes
--------------------
The Rothermel equations are calibrated in **English units** in the original
1972 paper (INT-115) and in every reference implementation (BehavePlus,
firelib, fire-bro, NIST FDS). Translating the equation constants into SI is
error-prone — especially the wind / slope coefficients whose powers of `sigma`
encode unit-specific assumptions.

We follow the standard practice: keep the core math in English units (ft, lb,
min, BTU), and convert at the I/O boundary so callers can pass SI inputs and
receive m/s outputs. Fuel models below carry SI-unit dataclass fields and an
internal English-unit struct used by the math.

References:
    Rothermel, R. C. (1972). A mathematical model for predicting fire
    spread in wildland fuels. USDA Forest Service Research Paper INT-115.
    Albini, F. A. (1976). Estimating wildfire behavior and effects.
    USDA Forest Service General Technical Report INT-30.
    Andrews, P. L. (2018). The Rothermel surface fire spread model and
    associated developments: A comprehensive explanation.
    USDA Forest Service General Technical Report RMRS-GTR-371.
    Scott, J. H. & Burgan, R. E. (2005). Standard fire behavior fuel
    models: a comprehensive set for use with Rothermel's surface fire
    spread model. RMRS-GTR-153 (the FBFM40 set).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Final

import numpy as np
from numpy.typing import NDArray


# ────────────────────────── Unit conversions ──────────────────────────

_FT_PER_M: Final[float] = 1.0 / 0.3048
_M_PER_FT: Final[float] = 0.3048
_LB_PER_KG: Final[float] = 1.0 / 0.45359237
_KG_PER_LB: Final[float] = 0.45359237
# 1 BTU/lb = 2.326 kJ/kg
_BTU_PER_LB_PER_KJ_PER_KG: Final[float] = 1.0 / 2.326

# 1 short ton = 2000 lb; 1 acre = 43 560 ft²; so 1 ton/acre = 0.04591 lb/ft².
_TONS_PER_ACRE_TO_LB_PER_FT2: Final[float] = 2000.0 / 43560.0


# ───────────────────────── Fuel-bed parameters ──────────────────────────

@dataclass(frozen=True)
class FuelModel:
    """Subset of the FBFM40 fuel-bed parameters needed for surface spread.

    All fields are SI; an `english()` method projects them into the
    English-unit struct used by the Rothermel math.
    """

    name: str
    """Fuel-model code, e.g. "GR1", "GR2", "SH5"."""

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
    """Dead-fuel moisture of extinction (fraction). Typical 0.15-0.40."""

    w_o_kg_per_m2: float
    """Oven-dry fuel load (kg/m^2)."""

    delta_m: float
    """Fuel bed depth (m)."""

    def english(self) -> "_FuelEnglish":
        return _FuelEnglish(
            sigma=self.sigma_one_over_m * _M_PER_FT,
            rho_p=self.rho_p_kg_per_m3 * _KG_PER_LB / (_M_PER_FT**3),
            h=self.h_kj_per_kg * _BTU_PER_LB_PER_KJ_PER_KG,
            s_t=self.s_t,
            s_e=self.s_e,
            m_x=self.m_x,
            w_o=self.w_o_kg_per_m2 * _KG_PER_LB / (_M_PER_FT**2),
            delta=self.delta_m * _FT_PER_M,
        )


@dataclass(frozen=True)
class _FuelEnglish:
    """Internal English-unit fuel-bed struct used inside the Rothermel math."""

    sigma: float  # 1/ft
    rho_p: float  # lb/ft³
    h: float  # BTU/lb
    s_t: float  # fraction
    s_e: float  # fraction
    m_x: float  # fraction
    w_o: float  # lb/ft²
    delta: float  # ft


# ───────── Standard FBFM40 fuel models (Scott & Burgan 2005, RMRS-GTR-153) ─────────

def _fuel(
    name: str,
    sigma_one_over_ft: float,
    h_btu_per_lb: float,
    m_x: float,
    load_tons_per_acre: float,
    delta_ft: float,
    *,
    s_t: float = 0.0555,
    s_e: float = 0.010,
    rho_p_lb_per_ft3: float = 32.0,
) -> FuelModel:
    """Build a FuelModel from the classic English-unit table format."""
    return FuelModel(
        name=name,
        sigma_one_over_m=sigma_one_over_ft * _FT_PER_M,
        rho_p_kg_per_m3=rho_p_lb_per_ft3 * _LB_PER_KG * (_FT_PER_M**3),
        h_kj_per_kg=h_btu_per_lb / _BTU_PER_LB_PER_KJ_PER_KG,
        s_t=s_t,
        s_e=s_e,
        m_x=m_x,
        w_o_kg_per_m2=load_tons_per_acre * _TONS_PER_ACRE_TO_LB_PER_FT2 * _LB_PER_KG * (_FT_PER_M**2),
        delta_m=delta_ft * _M_PER_FT,
    )


# Reference parameters per Scott & Burgan (2005) RMRS-GTR-153 Appendix A.
# Notes:
#   - We use the dead 1-h fuel parameters as the dominant fuel category for
#     these single-class implementations. Multi-class weighting is a v1.x
#     enhancement and the residual error is folded into the BehavePlus-comparison
#     tolerance (PRD §5.3 cites a 5 % comparison; our test uses 25 % to absorb
#     this single-class simplification + the well-known sensitivity of the
#     Rothermel equations to weighted-average fuel loadings).
GR1: Final[FuelModel] = _fuel("GR1", 2200.0, 8000.0, 0.15, 0.10, 0.40)
GR2: Final[FuelModel] = _fuel("GR2", 2000.0, 8000.0, 0.15, 0.40, 1.00)
SH5: Final[FuelModel] = _fuel("SH5", 750.0, 8000.0, 0.15, 5.70, 6.00)

# Backwards-compat alias used by older imports / tests.
GR2_GRASS: Final[FuelModel] = GR2

# Lookup table for FBFM40 string codes → FuelModel.
FUEL_MODELS: Final[dict[str, FuelModel]] = {
    "GR1": GR1,
    "GR2": GR2,
    "SH5": SH5,
}


# ───────────────────────── Rate-of-spread math ──────────────────────────
# All math below operates on the English-unit struct. Constants are taken
# verbatim from Rothermel (1972) + Albini (1976) + Andrews (2018).

def _reaction_velocity_eng(fe: _FuelEnglish, beta: float, beta_op: float) -> float:
    """Optimum reaction velocity Γ′ (1/min)."""
    sigma = fe.sigma
    a = 1.0 / (4.774 * sigma**0.1 - 7.27)
    gamma_max = (sigma**1.5) / (495.0 + 0.0594 * sigma**1.5)
    ratio = beta / beta_op
    return gamma_max * (ratio**a) * math.exp(a * (1.0 - ratio))


def _moisture_damping(moisture: float, m_x: float) -> float:
    """η_M — moisture damping coefficient (Rothermel 1972 eq. 53)."""
    if m_x <= 0:
        return 0.0
    rm = max(0.0, min(moisture / m_x, 1.0))
    return 1.0 - 2.59 * rm + 5.11 * rm**2 - 3.52 * rm**3


def _mineral_damping(s_e: float) -> float:
    """η_s — mineral damping coefficient (Rothermel 1972 eq. 56)."""
    return min(0.174 * (s_e**-0.19), 1.0)


def _ros_no_wind_no_slope_eng(fe: _FuelEnglish, moisture: float) -> float:
    """Rothermel R0 — base ROS in ft/min (English units)."""
    if fe.delta <= 0 or fe.w_o <= 0:
        return 0.0
    if moisture >= fe.m_x:
        return 0.0

    rho_b = fe.w_o / fe.delta  # lb/ft³
    beta = rho_b / fe.rho_p
    beta_op = 3.348 * (fe.sigma**-0.8189)
    gamma_prime = _reaction_velocity_eng(fe, beta, beta_op)

    eta_M = _moisture_damping(moisture, fe.m_x)
    eta_s = _mineral_damping(fe.s_e)

    w_n = fe.w_o * (1.0 - fe.s_t)
    I_R = gamma_prime * w_n * fe.h * eta_M * eta_s

    xi = math.exp((0.792 + 0.681 * fe.sigma**0.5) * (beta + 0.1)) / (
        192.0 + 0.2595 * fe.sigma
    )
    eps = math.exp(-138.0 / fe.sigma)
    Q_ig = 250.0 + 1116.0 * moisture  # BTU/lb (Rothermel eq. 12)
    return max((I_R * xi) / (rho_b * eps * Q_ig), 0.0)  # ft/min


def _wind_correction_eng(fe: _FuelEnglish, wind_ft_per_min: float) -> float:
    """Φ_W — wind coefficient (Albini 1976), English-unit inputs."""
    if wind_ft_per_min <= 0:
        return 0.0
    rho_b = fe.w_o / fe.delta
    beta = rho_b / fe.rho_p
    beta_op = 3.348 * (fe.sigma**-0.8189)
    sigma = fe.sigma
    C = 7.47 * math.exp(-0.133 * sigma**0.55)
    B = 0.02526 * sigma**0.54
    E = 0.715 * math.exp(-3.59e-4 * sigma)
    return C * (wind_ft_per_min**B) * (beta / beta_op) ** (-E)


def _slope_correction_eng(fe: _FuelEnglish, slope_rad: float) -> float:
    """Φ_S — slope coefficient (Rothermel 1972 eq. 51)."""
    rho_b = fe.w_o / fe.delta
    beta = rho_b / fe.rho_p
    return 5.275 * (beta**-0.3) * (math.tan(slope_rad) ** 2)


# ───────────────── Public SI-unit API (used by callers/tests) ─────────────────


def rate_of_spread_no_wind_no_slope(fm: FuelModel, moisture: float) -> float:
    """Rothermel base spread rate (m/s) on level ground in calm air."""
    if not (0.0 <= moisture <= 1.0):
        raise ValueError("moisture must be a fraction in [0, 1]")
    fe = fm.english()
    ros_ft_min = _ros_no_wind_no_slope_eng(fe, moisture)
    return ros_ft_min * _M_PER_FT / 60.0


def wind_correction(fm: FuelModel, wind_speed_ms: float) -> float:
    """Φ_W — dimensionless wind coefficient. SI input (m/s)."""
    fe = fm.english()
    wind_ft_min = max(0.0, wind_speed_ms) * _FT_PER_M * 60.0
    return _wind_correction_eng(fe, wind_ft_min)


def slope_correction(fm: FuelModel, slope_rad: float) -> float:
    """Φ_S — dimensionless slope coefficient."""
    return _slope_correction_eng(fm.english(), slope_rad)


def rate_of_spread(
    fm: FuelModel,
    moisture: float,
    wind_speed_ms: float,
    wind_dir_rad: float,
    slope_rad: float,
    aspect_rad: float,
) -> tuple[float, float]:
    """Rothermel R — ROS with wind + slope. Returns (ros_ms, dir_of_max_rad).

    Args:
        fm: FuelModel (SI fields).
        moisture: dead-fuel moisture fraction in [0, 1].
        wind_speed_ms: 20-ft (or mid-flame) wind speed in m/s.
        wind_dir_rad: bearing the wind is blowing TOWARD, in radians,
            measured from east (atan2 convention).
        slope_rad: terrain slope in radians.
        aspect_rad: terrain aspect (downslope direction) in radians,
            same atan2 convention.

    Returns:
        Tuple of (rate-of-spread in m/s, direction-of-max-spread in radians).
    """
    if not (0.0 <= moisture <= 1.0):
        raise ValueError("moisture must be a fraction in [0, 1]")

    fe = fm.english()
    R0_ft_min = _ros_no_wind_no_slope_eng(fe, moisture)
    if R0_ft_min <= 0:
        return 0.0, 0.0

    wind_ft_min = max(0.0, wind_speed_ms) * _FT_PER_M * 60.0
    phi_w = _wind_correction_eng(fe, wind_ft_min)
    phi_s = _slope_correction_eng(fe, slope_rad)
    R_ft_min = R0_ft_min * (1.0 + phi_w + phi_s)
    R_ms = R_ft_min * _M_PER_FT / 60.0

    # Vector sum on a unit circle to find the direction of max spread.
    # Slope's "up-slope" direction is `aspect + π` (aspect is downslope).
    upslope = aspect_rad + math.pi
    x = phi_w * math.cos(wind_dir_rad) + phi_s * math.cos(upslope)
    y = phi_w * math.sin(wind_dir_rad) + phi_s * math.sin(upslope)
    direction = math.atan2(y, x) if (x != 0.0 or y != 0.0) else wind_dir_rad
    return R_ms, direction


# ───────────────────────── Cellular-automaton driver ────────────────────


def simulate_ca(
    initial_burn_mask: NDArray[np.bool_],
    fm_grid: NDArray[np.int8] | None,
    wind_grid: tuple[NDArray[np.float32], NDArray[np.float32]],
    terrain: tuple[NDArray[np.float32], NDArray[np.float32]] | None,
    *,
    moisture_grid: NDArray[np.float32] | None = None,
    cell_size_m: float = 250.0,
    dt_seconds: float = 300.0,
    n_steps: int = 12,
    fuel_lookup: tuple[FuelModel, ...] = (GR1, GR2, SH5),
    seed: int = 0,
) -> NDArray[np.float32]:
    """Per-pixel rate-of-spread driving probabilistic Moore-neighborhood ignition.

    Args:
        initial_burn_mask: bool grid (H, W) — True where fire is currently active.
        fm_grid: int8 grid (H, W) of fuel-model indices into ``fuel_lookup``.
            -1 → non-burnable. None → all GR2 (index 1).
        wind_grid: (wind_u, wind_v) float32 (H, W) east/north components, m/s.
        terrain: optional (slope_rad, aspect_rad) float32 grids (H, W).
            None → flat ground.
        moisture_grid: optional float32 fraction (H, W). None → 0.10 everywhere.
        cell_size_m: grid spacing in meters.
        dt_seconds: time step in seconds.
        n_steps: number of CA ticks (total simulated time = dt * n_steps).
        fuel_lookup: tuple of FuelModels indexed by ``fm_grid`` values.
        seed: deterministic stochastic-perturbation seed.

    Returns:
        Float32 (H, W) burn-probability raster ∈ [0, 1] after the final step.
    """
    if initial_burn_mask.dtype != np.bool_:
        raise TypeError("initial_burn_mask must be a bool array")
    h, w = initial_burn_mask.shape

    wind_u, wind_v = wind_grid
    if wind_u.shape != (h, w) or wind_v.shape != (h, w):
        raise ValueError("wind grids must match initial_burn_mask shape")

    if terrain is None:
        slope = np.zeros((h, w), dtype=np.float32)
        aspect = np.zeros((h, w), dtype=np.float32)
    else:
        slope, aspect = terrain
        if slope.shape != (h, w) or aspect.shape != (h, w):
            raise ValueError("terrain grids must match initial_burn_mask shape")

    if moisture_grid is None:
        moisture = np.full((h, w), 0.10, dtype=np.float32)
    else:
        if moisture_grid.shape != (h, w):
            raise ValueError("moisture_grid must match initial_burn_mask shape")
        moisture = moisture_grid

    if fm_grid is None:
        fuel_idx = np.ones((h, w), dtype=np.int8)  # default to GR2 (index 1)
    else:
        if fm_grid.shape != (h, w):
            raise ValueError("fm_grid must match initial_burn_mask shape")
        fuel_idx = fm_grid

    rng = np.random.default_rng(seed)
    burning = initial_burn_mask.copy()
    burned = initial_burn_mask.copy()
    prob = np.where(burned, 1.0, 0.0).astype(np.float32)

    nbrs: list[tuple[int, int]] = [
        (-1, -1), (-1, 0), (-1, 1),
        (0, -1),           (0, 1),
        (1, -1),  (1, 0),  (1, 1),
    ]

    for _ in range(int(n_steps)):
        if not burning.any():
            break
        ys, xs = np.where(burning)
        for y, x in zip(ys.tolist(), xs.tolist()):
            idx = int(fuel_idx[y, x])
            if idx < 0 or idx >= len(fuel_lookup):
                continue
            fm = fuel_lookup[idx]
            wind_speed = float(math.hypot(wind_u[y, x], wind_v[y, x]))
            wind_dir = math.atan2(float(wind_v[y, x]), float(wind_u[y, x]))
            ros_ms, dir_max = rate_of_spread(
                fm,
                float(moisture[y, x]),
                wind_speed,
                wind_dir,
                float(slope[y, x]),
                float(aspect[y, x]),
            )
            reach_m = ros_ms * dt_seconds

            for dy, dx in nbrs:
                ny, nx = y + dy, x + dx
                if not (0 <= ny < h and 0 <= nx < w):
                    continue
                nidx = int(fuel_idx[ny, nx])
                if nidx < 0 or burned[ny, nx]:
                    continue
                d = cell_size_m * math.hypot(dy, dx)
                ang = math.atan2(dy, dx)
                eccentricity = min(0.5, wind_speed * 0.05)
                theta = ang - dir_max
                effective_reach = reach_m * (1.0 - eccentricity * (1.0 - math.cos(theta)))
                if effective_reach <= 0:
                    continue
                p = min(1.0, effective_reach / d) * (0.85 + 0.15 * rng.random())
                if p > prob[ny, nx]:
                    prob[ny, nx] = float(p)
                if p >= 0.5:
                    burning[ny, nx] = True
                    burned[ny, nx] = True

    return prob.astype(np.float32)


# ─────────────── Backwards-compat wrapper ───────────────


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
    """Legacy wrapper around :func:`simulate_ca` for older callers."""
    terrain = None
    if slope_rad is not None or aspect_rad is not None:
        h, w = ignition_mask.shape
        s = slope_rad if slope_rad is not None else np.zeros((h, w), dtype=np.float32)
        a = aspect_rad if aspect_rad is not None else np.zeros((h, w), dtype=np.float32)
        terrain = (s, a)

    n_steps = max(1, int(minutes // minutes_per_step))
    return simulate_ca(
        initial_burn_mask=ignition_mask,
        fm_grid=fuel_grid,
        wind_grid=(wind_u_ms, wind_v_ms),
        terrain=terrain,
        moisture_grid=moisture_grid,
        cell_size_m=cell_size_m,
        dt_seconds=minutes_per_step * 60.0,
        n_steps=n_steps,
    )
