"""Synthetic + real-shard datasets for the fire-spread model.

Two data sources:

1. :class:`SyntheticFireDataset` — pure-NumPy / pure-torch fire scenes
   generated on the fly. No I/O. Uses Rothermel-CA to produce plausible
   spread targets. Used for CPU smoke training, shape regressions in CI,
   and as the bedrock of the local-runnable training story.

2. :class:`WebDatasetShardDataset` — TODO: WebDataset reader against the
   ``ml/data/shards/`` layout described in PRD §5.4. Stub here; the build
   script + reader land alongside the data-pipeline work.

Both produce ``(input_seq, target_horizons)`` pairs with the shapes the
U-Net+ConvLSTM expects:
- ``input_seq``: ``(T=4, C=14, H, W)`` float32
- ``target_horizons``: ``(3, H, W)`` float32 ∈ {0, 1}

The synthetic dataset does not represent real wildfire physics — its
purpose is to verify the training loop forward-passes, backprops, and
updates without NaN. Real-data training uses the WebDataset path.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Iterator, Tuple

import numpy as np
import torch
from torch.utils.data import Dataset, IterableDataset

from ml.models.rothermel import simulate_ca
from ml.models.unet_convlstm import (
    C_INPUT,
    FBFM40_NUM_CLASSES,
    HORIZONS,
    T_DEFAULT,
)


HORIZONS_MIN: Tuple[int, int, int] = (60, 360, 1440)
"""Forecast horizons in minutes — frozen by ``packages/contracts``."""


@dataclass(frozen=True)
class SyntheticConfig:
    """Synthetic fire-scene generator parameters."""

    grid: int = 64
    """Raster H = W; tests use 32-64, real model trains at 256."""

    timesteps: int = T_DEFAULT
    """Number of past timesteps fed to the model."""

    horizons_min: Tuple[int, int, int] = HORIZONS_MIN
    """Forecast horizons for the targets."""

    minutes_per_step: int = 5
    """Minutes per CA step in the synthetic generator."""

    seed: int = 42
    """Deterministic seed; per-sample seed is ``seed + index``."""

    fuel_classes: int = FBFM40_NUM_CLASSES
    """Range of integer fuel-model indices to draw."""

    cell_size_m: float = 30.0
    """Synthetic CA cell size; matches the 30 m model grid in PRD §5.2."""


# ─────────── Channel layout: matches ml/models/unet_convlstm.py ───────────


def _wind_field(grid: int, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    """Spatially smooth wind field — mean direction + small per-cell variance."""
    speed_ms = float(rng.uniform(2.0, 12.0))
    dir_rad = float(rng.uniform(0, 2 * math.pi))
    u = np.full((grid, grid), speed_ms * math.cos(dir_rad), dtype=np.float32)
    v = np.full((grid, grid), speed_ms * math.sin(dir_rad), dtype=np.float32)
    u += rng.normal(0, speed_ms * 0.1, (grid, grid)).astype(np.float32)
    v += rng.normal(0, speed_ms * 0.1, (grid, grid)).astype(np.float32)
    return u, v


def _terrain(grid: int, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    """Slope and aspect from a smooth random surface."""
    base = rng.normal(0, 50, (grid, grid)).astype(np.float32)
    k = np.ones(5, dtype=np.float32) / 5.0
    smooth = base.copy()
    for _ in range(2):
        smooth = np.apply_along_axis(lambda r: np.convolve(r, k, mode="same"), 0, smooth)
        smooth = np.apply_along_axis(lambda r: np.convolve(r, k, mode="same"), 1, smooth)
    dy, dx = np.gradient(smooth)
    slope = np.arctan(np.hypot(dx, dy) / 30.0).astype(np.float32)
    aspect = np.arctan2(dy, dx).astype(np.float32)
    return slope, aspect


def _ignition_mask(grid: int, rng: np.random.Generator) -> np.ndarray:
    """Tiny initial burn — single point or small cluster near the centre."""
    mask = np.zeros((grid, grid), dtype=np.bool_)
    cy, cx = grid // 2, grid // 2
    cy += int(rng.integers(-grid // 8, grid // 8 + 1))
    cx += int(rng.integers(-grid // 8, grid // 8 + 1))
    mask[cy, cx] = True
    if rng.random() > 0.5:
        for dy, dx in [(-1, 0), (0, -1), (0, 1), (1, 0)]:
            ny, nx = cy + dy, cx + dx
            if 0 <= ny < grid and 0 <= nx < grid:
                mask[ny, nx] = True
    return mask


def _smooth_fuel_field(grid: int, rng: np.random.Generator, num_classes: int) -> np.ndarray:
    """LANDFIRE-style blocky integer fuel grid (float32-cast for the model)."""
    block_size = max(2, grid // 8)
    small = rng.integers(0, num_classes, size=(grid // block_size + 1, grid // block_size + 1))
    return np.kron(small, np.ones((block_size, block_size), dtype=np.int64))[:grid, :grid].astype(
        np.float32
    )


class SyntheticFireDataset(Dataset):
    """Procedural dataset producing ``(input, target)`` pairs.

    Returns
    -------
    input  : torch.float32 (T, C=14, H, W)
    target : torch.float32 (3, H, W)
    """

    def __init__(self, n_samples: int = 32, cfg: SyntheticConfig | None = None) -> None:
        self.n = int(n_samples)
        self.cfg = cfg or SyntheticConfig()

    def __len__(self) -> int:
        return self.n

    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, torch.Tensor]:
        if idx < 0 or idx >= self.n:
            raise IndexError(idx)
        cfg = self.cfg
        rng = np.random.default_rng(cfg.seed + idx)
        h = w = cfg.grid

        ignition = _ignition_mask(h, rng)
        wind_u, wind_v = _wind_field(h, rng)
        slope, aspect = _terrain(h, rng)

        rh = float(rng.uniform(0.05, 0.40))
        temp_norm = float(rng.uniform(-0.5, 1.0))
        days_since_precip = float(rng.uniform(0.0, 1.0))

        fuel = _smooth_fuel_field(h, rng, cfg.fuel_classes)
        canopy_cover = np.full((h, w), float(rng.uniform(0, 0.6)), dtype=np.float32)
        canopy_bd = np.full((h, w), float(rng.uniform(0, 0.5)), dtype=np.float32)

        slope_sin = np.sin(slope).astype(np.float32)
        slope_cos = np.cos(slope).astype(np.float32)
        aspect_sin = np.sin(aspect).astype(np.float32)
        aspect_cos = np.cos(aspect).astype(np.float32)

        moisture = np.full((h, w), float(rng.uniform(0.05, 0.20)), dtype=np.float32)

        # Use the Rothermel CA to generate plausible burn evolution. Seed is
        # tied to idx so consecutive calls return identical samples.
        burn_mask = ignition.astype(np.float32)
        ros_prior = np.full(
            (h, w),
            0.05 * float(math.hypot(wind_u.mean(), wind_v.mean())),
            dtype=np.float32,
        )

        input_seq = np.zeros((cfg.timesteps, C_INPUT, h, w), dtype=np.float32)
        for t_idx in range(cfg.timesteps):
            channels = [
                burn_mask,                                  # 0  burn mask
                wind_u,                                     # 1  wind U
                wind_v,                                     # 2  wind V
                np.full((h, w), rh, dtype=np.float32),      # 3  RH
                np.full((h, w), temp_norm, dtype=np.float32),  # 4 temperature
                fuel,                                       # 5  FBFM40 idx
                canopy_cover,                               # 6  canopy cover
                canopy_bd,                                  # 7  canopy BD
                slope_sin,                                  # 8  slope sin
                slope_cos,                                  # 9  slope cos
                aspect_sin,                                 # 10 aspect sin
                aspect_cos,                                 # 11 aspect cos
                np.full((h, w), days_since_precip, dtype=np.float32),  # 12 days-since-precip
                ros_prior,                                  # 13 Rothermel ROS prior
            ]
            assert len(channels) == C_INPUT, (
                f"channel count mismatch: built {len(channels)} but model expects {C_INPUT}"
            )
            input_seq[t_idx] = np.stack(channels, axis=0)

            # Advance the CA forward by one chunk for the next timestep.
            prob = simulate_ca(
                initial_burn_mask=burn_mask.astype(bool),
                fm_grid=None,
                wind_grid=(wind_u, wind_v),
                terrain=(slope, aspect),
                moisture_grid=moisture,
                cell_size_m=cfg.cell_size_m,
                dt_seconds=cfg.minutes_per_step * 60.0,
                n_steps=1,
                seed=cfg.seed + idx + t_idx,
            )
            burn_mask = (prob > 0.4).astype(np.float32)

        # Targets: run the CA out for each forecast horizon, starting from
        # the same ignition. Using the original ignition as the start (rather
        # than the last evolved burn_mask) avoids accumulated CA drift across
        # the four input timesteps — the targets are the canonical "what
        # would have happened from t=0" labels.
        targets: list[np.ndarray] = []
        for horizon_min in cfg.horizons_min[:HORIZONS]:
            n_steps = max(1, horizon_min // cfg.minutes_per_step)
            prob = simulate_ca(
                initial_burn_mask=ignition,
                fm_grid=None,
                wind_grid=(wind_u, wind_v),
                terrain=(slope, aspect),
                moisture_grid=moisture,
                cell_size_m=cfg.cell_size_m,
                dt_seconds=cfg.minutes_per_step * 60.0,
                n_steps=n_steps,
                seed=cfg.seed + idx + 1000 + horizon_min,
            )
            targets.append((prob > 0.5).astype(np.float32))
        y = np.stack(targets, axis=0)

        return torch.from_numpy(input_seq), torch.from_numpy(y)


# ────────────────────────── WebDataset stub ──────────────────────────


class WebDatasetShardDataset(IterableDataset):
    """Real-data WebDataset reader.

    TODO(Stage 3.B): hook up to ``ml/data/shards/*.tar`` once the data
    pipeline (PRD §5.4) is in place. For now this raises NotImplementedError
    so callers get a clear error rather than silent zeros.
    """

    def __init__(self, shard_glob: str) -> None:
        super().__init__()
        self.shard_glob = shard_glob

    def __iter__(self) -> Iterator[Tuple[torch.Tensor, torch.Tensor]]:
        raise NotImplementedError(
            "WebDataset shard reader lands with the data pipeline (PRD §5.4); "
            "use SyntheticFireDataset for the smoke test."
        )
