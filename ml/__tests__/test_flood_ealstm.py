"""Smoke tests for the flood EA-LSTM stage-prediction model."""

from __future__ import annotations

import pytest

torch = pytest.importorskip("torch")

from ml.models.flood_ealstm import (
    EALSTMCell,
    FloodEALSTM,
    pinball_loss,
)


def test_ealstm_cell_shape() -> None:
    cell = EALSTMCell(dynamic_input_size=8, static_input_size=27, hidden_size=32)
    x_d = torch.randn(2, 24, 8)  # 24 hours of forcings
    x_s = torch.randn(2, 27)
    out, (h, c) = cell(x_d, x_s)
    assert out.shape == (2, 24, 32)
    assert h.shape == (2, 32)
    assert c.shape == (2, 32)


def test_full_model_forward() -> None:
    model = FloodEALSTM(hidden_size=64)
    x_d = torch.randn(4, 168, 8)
    x_s = torch.randn(4, 27)
    y = model(x_d, x_s)
    assert y.shape == (4, 3, 3)  # 3 horizons × 3 quantiles
    assert torch.isfinite(y).all()


def test_loss_decreases_with_one_step() -> None:
    torch.manual_seed(0)
    model = FloodEALSTM(hidden_size=32)
    opt = torch.optim.SGD(model.parameters(), lr=1e-2)
    x_d = torch.randn(2, 48, 8)
    x_s = torch.randn(2, 27)
    target = torch.randn(2, 3) * 1.5 + 4.0  # stage in metres

    loss_before = pinball_loss(model(x_d, x_s), target).item()
    pinball_loss(model(x_d, x_s), target).backward()
    opt.step()
    loss_after = pinball_loss(model(x_d, x_s), target).item()
    assert loss_after < loss_before


def test_quantile_ordering_emerges_with_training() -> None:
    """After many SGD steps on a single sample the quantile heads should
    produce the right order: q10 < q50 < q90 (most of the time). We don't
    enforce strict monotonicity (the architecture doesn't prevent crossing)
    but the *mean* across heads should be ordered."""
    torch.manual_seed(0)
    model = FloodEALSTM(hidden_size=32)
    opt = torch.optim.Adam(model.parameters(), lr=5e-2)
    x_d = torch.randn(1, 48, 8)
    x_s = torch.randn(1, 27)
    target = torch.tensor([[3.0, 4.0, 5.0]])
    for _ in range(80):
        opt.zero_grad()
        pinball_loss(model(x_d, x_s), target).backward()
        opt.step()
    pred = model(x_d, x_s).detach()[0]  # (3 horizons, 3 quantiles)
    means = pred.mean(dim=0)  # mean across horizons → (3,) for q10/q50/q90
    assert means[0] <= means[1] <= means[2], f"quantile crossing: {means.tolist()}"
