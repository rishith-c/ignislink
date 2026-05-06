"""Smoke tests for the earthquake aftershock hybrid model."""

from __future__ import annotations

import pytest

torch = pytest.importorskip("torch")

from ml.models.aftershock_etas_npp import (
    AftershockHybridModel,
    aftershock_bce,
    brier_score,
    etas_intensity,
    gutenberg_richter_p_above,
)


def test_etas_intensity_decays_with_time() -> None:
    mag = torch.tensor([[5.0, 5.0]])
    dist = torch.tensor([[0.0, 0.0]])
    early = etas_intensity(mag, torch.tensor([[0.1, 0.1]]), dist)
    late = etas_intensity(mag, torch.tensor([[10.0, 10.0]]), dist)
    assert (early > late).all()


def test_etas_intensity_decays_with_distance() -> None:
    mag = torch.tensor([[5.0]])
    dt = torch.tensor([[1.0]])
    near = etas_intensity(mag, dt, torch.tensor([[1.0]]))
    far = etas_intensity(mag, dt, torch.tensor([[200.0]]))
    assert (near > far).all()


def test_gutenberg_richter_monotone() -> None:
    assert gutenberg_richter_p_above(4.0) > gutenberg_richter_p_above(5.0)
    assert gutenberg_richter_p_above(5.0) > gutenberg_richter_p_above(6.0)


def test_forward_pass_returns_probabilities() -> None:
    model = AftershockHybridModel()
    model.eval()
    B, K = 2, 8
    hist_mag = torch.rand(B, K) * 3 + 2.5
    hist_dt = torch.rand(B, K) * 5
    hist_dist = torch.rand(B, K) * 50
    features = torch.randn(B, K, 11)
    mask = torch.zeros(B, K, dtype=torch.bool)
    with torch.no_grad():
        p = model(hist_mag, hist_dt, hist_dist, features, mask)
    assert p.shape == (B,)
    assert (p >= 0).all() and (p <= 1).all()
    assert torch.isfinite(p).all()


def _realistic_history(B: int, K: int) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
    """Realistic sparse-catalog scenario so the ETAS rate doesn't saturate.

    Most candidate cells see 1-2 small (M ≤ 3.5) recent events. We pad the
    rest of the K slots with masked-out entries (sub-completeness magnitudes
    that the model already filters)."""
    hist_mag = torch.full((B, K), 1.0)  # below M_c, ignored by ETAS
    hist_mag[:, 0] = 3.2   # one small event
    hist_mag[:, 1] = 2.8
    hist_dt = torch.full((B, K), 30.0)  # padded events 30 days old
    hist_dt[:, 0] = 1.5
    hist_dt[:, 1] = 6.0
    hist_dist = torch.full((B, K), 80.0)
    hist_dist[:, 0] = 12.0
    hist_dist[:, 1] = 35.0
    features = torch.randn(B, K, 11)
    mask = torch.zeros(B, K, dtype=torch.bool)
    return hist_mag, hist_dt, hist_dist, features, mask


def test_gradients_flow_through_encoder() -> None:
    torch.manual_seed(0)
    model = AftershockHybridModel()
    B, K = 4, 16
    hist_mag, hist_dt, hist_dist, features, mask = _realistic_history(B, K)
    target = torch.tensor([1.0, 0.0, 0.0, 1.0])

    pred = model(hist_mag, hist_dt, hist_dist, features, mask)
    aftershock_bce(pred, target).backward()
    encoder_grad = sum(
        p.grad.norm().item() for p in model.encoder.parameters() if p.grad is not None
    )
    assert encoder_grad > 0.0, "encoder did not receive any gradient"


def test_optim_step_with_adam_reduces_loss() -> None:
    torch.manual_seed(0)
    model = AftershockHybridModel()
    opt = torch.optim.Adam(model.parameters(), lr=1e-2)
    B, K = 4, 16
    hist_mag, hist_dt, hist_dist, features, mask = _realistic_history(B, K)
    target = torch.tensor([1.0, 0.0, 1.0, 0.0])

    loss_before = aftershock_bce(
        model(hist_mag, hist_dt, hist_dist, features, mask), target
    ).item()
    for _ in range(10):
        opt.zero_grad()
        loss = aftershock_bce(model(hist_mag, hist_dt, hist_dist, features, mask), target)
        loss.backward()
        opt.step()
    loss_after = aftershock_bce(
        model(hist_mag, hist_dt, hist_dist, features, mask), target
    ).item()
    assert loss_after < loss_before, f"{loss_before:.4f} → {loss_after:.4f}"


def test_brier_score_zero_when_perfect() -> None:
    pred = torch.tensor([0.0, 1.0, 0.0, 1.0])
    target = torch.tensor([0.0, 1.0, 0.0, 1.0])
    assert brier_score(pred, target) == 0.0
