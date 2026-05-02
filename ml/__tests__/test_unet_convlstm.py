"""Forward-pass + loss tests for the U-Net + ConvLSTM model.

These exercise the architecture without any real data — synthetic batches
of the right shape are sufficient to catch shape mismatches, NaN/inf, and
gradient issues. Real-data evaluation lives in ml/eval/ once training
runs.
"""

from __future__ import annotations

import pytest

torch = pytest.importorskip("torch")  # type: ignore[assignment]

from ml.models.unet_convlstm import (  # noqa: E402  (import after pytest skip)
    C_INPUT,
    HORIZONS,
    T_DEFAULT,
    FireSpreadUNetConvLSTM,
    weighted_bce_dice_iou,
)


def test_forward_pass_shape() -> None:
    """(B=2, T=4, C=14, 64, 64) → (B=2, 3, 64, 64)."""
    model = FireSpreadUNetConvLSTM(base_channels=8)
    model.eval()
    x = torch.randn(2, T_DEFAULT, C_INPUT, 64, 64)
    with torch.no_grad():
        y = model(x)
    assert y.shape == (2, HORIZONS, 64, 64)
    assert torch.isfinite(y).all(), "model output contains NaN/Inf"
    assert y.min() >= 0.0 and y.max() <= 1.0, "sigmoid head out of range"


def test_forward_pass_no_nans_under_large_inputs() -> None:
    model = FireSpreadUNetConvLSTM(base_channels=8)
    model.eval()
    x = torch.randn(1, T_DEFAULT, C_INPUT, 32, 32) * 5.0
    with torch.no_grad():
        y = model(x)
    assert torch.isfinite(y).all()


def test_rejects_4d_input() -> None:
    model = FireSpreadUNetConvLSTM(base_channels=8)
    with pytest.raises(ValueError):
        model(torch.randn(1, C_INPUT, 32, 32))


def test_rejects_wrong_channel_count() -> None:
    model = FireSpreadUNetConvLSTM(in_channels=14, base_channels=8)
    with pytest.raises(ValueError):
        model(torch.randn(1, T_DEFAULT, 13, 32, 32))


def test_loss_decreases_with_one_step_overfit() -> None:
    """A single optimisation step must reduce the loss on a single sample."""
    torch.manual_seed(0)
    model = FireSpreadUNetConvLSTM(base_channels=8)
    opt = torch.optim.SGD(model.parameters(), lr=1e-1)

    x = torch.randn(1, T_DEFAULT, C_INPUT, 32, 32)
    target = (torch.rand(1, HORIZONS, 32, 32) > 0.5).float()

    pred = model(x)
    loss_before = weighted_bce_dice_iou(pred, target).item()
    opt.zero_grad()
    weighted_bce_dice_iou(model(x), target).backward()
    opt.step()
    loss_after = weighted_bce_dice_iou(model(x), target).item()
    assert loss_after < loss_before


def test_param_count_within_budget() -> None:
    """At base_channels=64 the model should be ~24 M params (PRD §5.3)."""
    model = FireSpreadUNetConvLSTM(base_channels=64)
    n = sum(p.numel() for p in model.parameters())
    assert 18_000_000 < n < 35_000_000, f"unexpected param count: {n:,}"


def test_fuel_embedding_clamps_out_of_range_indices() -> None:
    """Fuel-channel values outside [0, fuel_classes) must not crash."""
    model = FireSpreadUNetConvLSTM(base_channels=8)
    model.eval()
    x = torch.zeros(1, T_DEFAULT, C_INPUT, 32, 32)
    # Fuel channel filled with an out-of-range index.
    x[:, :, 5] = 999.0
    with torch.no_grad():
        y = model(x)
    assert torch.isfinite(y).all()
