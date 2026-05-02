"""Tests for the synthetic training dataset."""

from __future__ import annotations

import pytest

torch = pytest.importorskip("torch")  # type: ignore[assignment]

from ml.training.dataset import (  # noqa: E402
    HORIZONS_MIN,
    SyntheticConfig,
    SyntheticFireDataset,
    WebDatasetShardDataset,
)


def test_synthetic_dataset_returns_correct_shapes() -> None:
    cfg = SyntheticConfig(grid=32, timesteps=4)
    ds = SyntheticFireDataset(n_samples=4, cfg=cfg)
    assert len(ds) == 4
    x, y = ds[0]
    assert x.shape == (4, 14, 32, 32)
    assert y.shape == (3, 32, 32)
    assert x.dtype == torch.float32
    assert y.dtype == torch.float32


def test_synthetic_dataset_targets_are_binary() -> None:
    cfg = SyntheticConfig(grid=24, timesteps=4)
    ds = SyntheticFireDataset(n_samples=2, cfg=cfg)
    _, y = ds[0]
    unique = torch.unique(y)
    assert set(unique.tolist()).issubset({0.0, 1.0})


def test_synthetic_dataset_deterministic() -> None:
    cfg = SyntheticConfig(grid=16, timesteps=4, seed=7)
    ds_a = SyntheticFireDataset(n_samples=2, cfg=cfg)
    ds_b = SyntheticFireDataset(n_samples=2, cfg=cfg)
    a_x, a_y = ds_a[0]
    b_x, b_y = ds_b[0]
    torch.testing.assert_close(a_x, b_x)
    torch.testing.assert_close(a_y, b_y)


def test_synthetic_dataset_index_out_of_range_raises() -> None:
    ds = SyntheticFireDataset(n_samples=2)
    with pytest.raises(IndexError):
        _ = ds[2]


def test_horizons_min_constant_is_60_360_1440() -> None:
    """Frozen by packages/contracts/predict-spread.ts."""
    assert HORIZONS_MIN == (60, 360, 1440)


def test_webdataset_shard_reader_is_a_clear_stub() -> None:
    """Until the data pipeline lands, the WebDataset reader must error loudly."""
    ds = WebDatasetShardDataset("ml/data/shards/*.tar")
    with pytest.raises(NotImplementedError):
        next(iter(ds))
