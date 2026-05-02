"""Tests for training/losses.py.

These tests exercise:
- weighted BCE matches a hand-computed value on a tiny tensor;
- Dice loss = 0 on a perfect prediction;
- FireFrontIoU loss = 0 on a perfect prediction;
- combined loss reduces under SGD on a tiny problem.
"""

from __future__ import annotations

import math

import pytest

torch = pytest.importorskip("torch")  # type: ignore[assignment]

from ml.training.losses import (  # noqa: E402
    combined_loss,
    dice_loss,
    fire_front_iou_loss,
    fire_front_iou_score,
    weighted_bce_loss,
)


# ────────────────────── Dice ──────────────────────


def test_dice_loss_zero_on_perfect_prediction() -> None:
    pred = torch.tensor([[[[0.99, 0.99], [0.99, 0.99]]]])
    target = torch.tensor([[[[1.0, 1.0], [1.0, 1.0]]]])
    loss = dice_loss(pred, target).item()
    assert loss < 0.02, f"expected near-zero dice loss on perfect prediction, got {loss}"


def test_dice_loss_one_on_inverted_prediction() -> None:
    pred = torch.tensor([[[[0.01, 0.01], [0.01, 0.01]]]])
    target = torch.tensor([[[[1.0, 1.0], [1.0, 1.0]]]])
    loss = dice_loss(pred, target).item()
    assert loss > 0.95


def test_dice_loss_shape_mismatch_raises() -> None:
    with pytest.raises(ValueError):
        dice_loss(torch.zeros(1, 1, 4, 4), torch.zeros(1, 1, 5, 5))


# ────────────────────── Weighted BCE ──────────────────────


def test_weighted_bce_matches_hand_computed_value() -> None:
    """Two-pixel example with explicit pos_weight = 3.

    target  = [1, 0]
    pred    = [0.7, 0.2]
    formula = -(pos_w * y log p + (1-y) log(1-p))
    pixel0  = -(3 * 1 * log(0.7))         = -3 * log 0.7
    pixel1  = -(0 + 1 * log(1 - 0.2))     = -log 0.8
    mean    = (pixel0 + pixel1) / 2
    """
    pred = torch.tensor([[[[0.7, 0.2]]]])
    target = torch.tensor([[[[1.0, 0.0]]]])
    loss = weighted_bce_loss(pred, target, pos_weight=3.0).item()
    expected = (-3.0 * math.log(0.7) + -math.log(0.8)) / 2.0
    assert loss == pytest.approx(expected, rel=1e-3, abs=1e-3)


def test_weighted_bce_auto_pos_weight_handles_no_positives() -> None:
    """Auto pos_weight must not blow up when the batch has zero positives."""
    pred = torch.full((1, 1, 4, 4), 0.1)
    target = torch.zeros(1, 1, 4, 4)
    loss = weighted_bce_loss(pred, target).item()
    assert math.isfinite(loss)


# ────────────────────── Fire-front IoU ──────────────────────


def test_fire_front_iou_loss_near_zero_on_perfect_prediction() -> None:
    """Identical perimeters → IoU = 1 → loss = 0."""
    target = torch.zeros(1, 1, 8, 8)
    target[0, 0, 2:6, 2:6] = 1.0  # solid square
    pred = target.clone()
    pred = pred.clamp(0.01, 0.99)  # pred values can't be exactly 0/1 in practice
    loss = fire_front_iou_loss(pred, target).item()
    assert loss < 0.05, f"expected near-zero front IoU loss, got {loss}"


def test_fire_front_iou_loss_one_on_disjoint_perimeters() -> None:
    """Disjoint masks → IoU = 0 → loss = 1."""
    target = torch.zeros(1, 1, 8, 8)
    target[0, 0, 0, 0] = 1.0
    pred = torch.zeros(1, 1, 8, 8)
    pred[0, 0, 7, 7] = 1.0
    loss = fire_front_iou_loss(pred, target).item()
    assert loss > 0.9


def test_fire_front_iou_score_perfect() -> None:
    target = torch.zeros(1, 1, 8, 8)
    target[0, 0, 2:6, 2:6] = 1.0
    pred = target.clone()
    score = fire_front_iou_score(pred, target).item()
    assert score == pytest.approx(1.0, abs=1e-3)


# ────────────────────── Combined ──────────────────────


def test_combined_loss_finite_and_positive() -> None:
    pred = torch.rand(2, 3, 8, 8)
    target = (torch.rand(2, 3, 8, 8) > 0.5).float()
    loss = combined_loss(pred, target)
    assert torch.isfinite(loss)
    assert loss.item() > 0.0


def test_combined_loss_decreases_under_sgd() -> None:
    """Optimising a tiny logits tensor through the combined loss reduces it."""
    torch.manual_seed(0)
    target = (torch.rand(1, 3, 8, 8) > 0.5).float()
    logits = torch.zeros(1, 3, 8, 8, requires_grad=True)
    opt = torch.optim.SGD([logits], lr=1.0)

    def step() -> float:
        opt.zero_grad()
        loss = combined_loss(torch.sigmoid(logits), target)
        loss.backward()
        opt.step()
        return loss.item()

    before = combined_loss(torch.sigmoid(logits), target).item()
    for _ in range(8):
        step()
    after = combined_loss(torch.sigmoid(logits), target).item()
    assert after < before, f"loss did not decrease: {before:.4f} → {after:.4f}"
