"""Synthetic + real-shard datasets for the fire-spread model.

Two data sources:

1. `SyntheticFireDataset` — pure-NumPy / pure-torch fire scenes generated on
   the fly. No I/O. Uses Rothermel-CA to produce plausible spread targets.
   Used for CPU smoke training, shape regressions in CI, and as the bedrock
   of the local-runnable training story.

2. `WebDatasetShardDataset` — reads `.tar` shards prepared by
   `ml/data/build_shards.py` (Stage-3 deliverable). Each shard contains
   `(input.npz, target.npz, metadata.json)` triples per PRD §5.5. Stub here;
   the build script is a follow-on.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import torch
from torch.utils.data import Dataset

from ml.models.rothermel import (
    GR2_GRASS,
    simulate_spread,
)


C_INPUT = 13  # must match ml/models/unet_convlstm.py
HORIZONS_MIN = (60, 360, 1440)


@dataclass(frozen=True)
class SyntheticConfig:
    """Synthetic fire-scene generator parameters."""

    grid: int = 64
    timesteps: int = 4
    horizons_min: tuple[int, int, int] = HORIZONS_MIN
    minutes_per_step: int = 5
    seed: int = 42


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
    # Smooth with a 5x5 box filter (separable, NumPy-only).
    k = np.ones(5, dtype=np.float32) / 5.0
    smooth = base.copy()
    for _ in range(2):
        smooth = np.apply_along_axis(lambda r: np.convolve(r, k, mode="same"), 0, smooth)
        smooth = np.apply_along_axis(lambda r: np.convolve(r, k, mode="same"), 1, smooth)
    dy, dx = np.gradient(smooth)
    slope = np.arctan(np.hypot(dx, dy) / 30.0).astype(np.float32)  # cell ≈ 30 m
    aspect = np.arctan2(dy, dx).astype(np.float32)
    return slope, aspect


def _ignition_mask(grid: int, rng: np.random.Generator) -> np.ndarray:
    """Tiny initial burn — single point or small cluster near the center."""
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


class SyntheticFireDataset(Dataset):
    """Procedural dataset producing (input, target) pairs.

    input  shape: (T, C=13, H, W)
    target shape: (3, H, W) — one channel per horizon (1h / 6h / 24h)
    """

    def __init__(self, n_samples: int, cfg: SyntheticConfig | None = None) -> None:
        self.n = n_samples
        self.cfg = cfg or SyntheticConfig()

    def __len__(self) -> int:
        return self.n

    def __getitem__(self, idx: int):
        cfg = self.cfg
        rng = np.random.default_rng(cfg.seed + idx)
        h = w = cfg.grid

        ignition = _ignition_mask(h, rng)
        wind_u, wind_v = _wind_field(h, rng)
        slope, aspect = _terrain(h, rng)

        gust = np.full((h, w), float(rng.uniform(0, 15)), dtype=np.float32)
        rh = np.full((h, w), float(rng.uniform(0.05, 0.7)), dtype=np.float32)
        temp_norm = np.full((h, w), float(rng.uniform(-1, 1)), dtype=np.float32)

        # Compressed fuel one-hot — 4 channels of soft assignments.
        fuel_pca = rng.dirichlet([1, 1, 1, 1], size=(h, w)).astype(np.float32)
        fuel_pca = np.transpose(fuel_pca, (2, 0, 1))  # (4, H, W)

        canopy_cover = np.full((h, w), float(rng.uniform(0, 0.6)), dtype=np.float32)
        slope_sin = np.sin(slope).astype(np.float32)
        aspect_sin = np.sin(aspect).astype(np.float32)
        moisture = np.full((h, w), float(rng.uniform(0.05, 0.20)), dtype=np.float32)

        burn_mask = ignition.astype(np.float32)
        timesteps: list[np.ndarray] = []
        for _ in range(cfg.timesteps):
            channels = np.stack(
                [
                    burn_mask,
                    wind_u,
                    wind_v,
                    gust,
                    rh,
                    temp_norm,
                    fuel_pca[0],
                    fuel_pca[1],
                    fuel_pca[2],
                    fuel_pca[3],
                    canopy_cover,
                    slope_sin,
                    aspect_sin,
                ],
                axis=0,
            )
            timesteps.append(channels.astype(np.float32))
            # Step the burn forward via the CA so each timestep reflects new state.
            prob = simulate_spread(
                burn_mask.astype(bool),
                None,
                moisture,
                wind_u,
                wind_v,
                slope,
                aspect,
                cell_size_m=30.0,
                minutes=cfg.minutes_per_step,
                minutes_per_step=cfg.minutes_per_step,
            )
            burn_mask = (prob > 0.4).astype(np.float32)

        x = np.stack(timesteps, axis=0)  # (T, C, H, W)

        # Targets: run the CA out further for each horizon.
        targets: list[np.ndarray] = []
        for horizon_min in cfg.horizons_min:
            prob = simulate_spread(
                ignition,
                None,
                moisture,
                wind_u,
                wind_v,
                slope,
                aspect,
                cell_size_m=30.0,
                minutes=horizon_min,
                minutes_per_step=cfg.minutes_per_step,
            )
            targets.append((prob > 0.5).astype(np.float32))
        y = np.stack(targets, axis=0)  # (3, H, W)

        return torch.from_numpy(x), torch.from_numpy(y)
