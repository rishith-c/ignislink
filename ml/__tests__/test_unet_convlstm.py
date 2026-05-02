"""Forward-pass + loss tests for the U-Net + ConvLSTM model.

These exercise the architecture without any real data — synthetic batches
of the right shape are sufficient to catch shape mismatches, NaN/inf, and
gradient issues. Real-data evaluation lives in ml/eval/ once training runs.
"""

import pytest

torch = pytest.importorskip("torch")

from ml.models.unet_convlstm import (
    C_INPUT,
    HORIZONS,
    FireSpreadUNetConvLSTM,
    weighted_bce_dice_iou,
)


def test_forward_pass_shape():
    """(B=2, T=4, C=13, 64, 64) → (B=2, 3, 64, 64)."""
    model = FireSpreadUNetConvLSTM(base_channels=8)
    model.eval()
    x = torch.randn(2, 4, C_INPUT, 64, 64)
    with torch.no_grad():
        y = model(x)
    assert y.shape == (2, HORIZONS, 64, 64)
    assert y.min() >= 0.0 and y.max() <= 1.0


def test_forward_pass_no_nans():
    model = FireSpreadUNetConvLSTM(base_channels=8)
    model.eval()
    x = torch.randn(1, 4, C_INPUT, 32, 32) * 5.0  # large values to stress norms
    with torch.no_grad():
        y = model(x)
    assert torch.isfinite(y).all()


def test_rejects_4d_input():
    model = FireSpreadUNetConvLSTM(base_channels=8)
    with pytest.raises(ValueError):
        model(torch.randn(1, C_INPUT, 32, 32))


def test_loss_decreases_with_one_step_overfit():
    """A single optimization step on a single sample should reduce the loss.

    This is the cheapest end-to-end gradient check: it fails if any of the
    layers are non-differentiable, if loss returns NaN, or if the shapes are
    mismatched between pred and target.
    """
    torch.manual_seed(0)
    model = FireSpreadUNetConvLSTM(base_channels=8)
    opt = torch.optim.SGD(model.parameters(), lr=1e-1)

    x = torch.randn(1, 4, C_INPUT, 32, 32)
    target = (torch.rand(1, HORIZONS, 32, 32) > 0.5).float()

    pred = model(x)
    loss_before = weighted_bce_dice_iou(pred, target).item()
    opt.zero_grad()
    weighted_bce_dice_iou(model(x), target).backward()
    opt.step()
    loss_after = weighted_bce_dice_iou(model(x), target).item()
    assert loss_after < loss_before


def test_param_count_within_budget():
    """At base_channels=32 the model should be ~24 M params (PRD §5.3)."""
    model = FireSpreadUNetConvLSTM(base_channels=32)
    n = sum(p.numel() for p in model.parameters())
    # Allow a healthy band — the PRD claim is ~24 M, ConvLSTM gates dominate.
    assert 5_000_000 < n < 60_000_000, f"unexpected param count: {n:,}"
