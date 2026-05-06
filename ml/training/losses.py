"""Loss functions for the SentryMax fire-spread model — PRD §5.3.

Combined loss::

    L = α · BCE_weighted + β · Dice + γ · FireFrontIoU
    α = 1.0, β = 0.5, γ = 0.3

- ``BCE_weighted`` — pixel-weighted binary cross-entropy. The positive-class
  weight is computed per batch as the inverse of the positive-pixel
  frequency, so under-burned batches don't drown the loss in zeros.
- ``Dice`` — smooth Dice loss across all spatial+channel dims.
- ``FireFrontIoU`` — 1 − IoU on the *fire-front* (morphological gradient of
  the binarised mask). This penalises perimeter mismatch even when the
  burn-area Dice is good, which matches the operational metric reported in
  PRD §1.1 (Fire-front IoU is the headline ML metric).

All losses are differentiable; the morphological gradient uses
``F.max_pool2d`` (and its negative for erosion), which has well-defined
sub-gradients in PyTorch.
"""

from __future__ import annotations

import torch
import torch.nn.functional as F


# ────────────────────── Building blocks ──────────────────────


def _morph_gradient(x: torch.Tensor, kernel: int = 3) -> torch.Tensor:
    """3×3 morphological gradient (dilation − erosion)."""
    pad = kernel // 2
    dilated = F.max_pool2d(x, kernel_size=kernel, stride=1, padding=pad)
    eroded = -F.max_pool2d(-x, kernel_size=kernel, stride=1, padding=pad)
    return (dilated - eroded).clamp(0.0, 1.0)


def _check_shapes(pred: torch.Tensor, target: torch.Tensor) -> None:
    if pred.shape != target.shape:
        raise ValueError(f"shape mismatch: pred {tuple(pred.shape)}, target {tuple(target.shape)}")
    if pred.ndim < 3:
        raise ValueError(f"expected at least 3D tensor (B, ..., H, W), got {tuple(pred.shape)}")


# ────────────────────── Individual losses ──────────────────────


def weighted_bce_loss(
    pred: torch.Tensor,
    target: torch.Tensor,
    *,
    pos_weight: float | None = None,
    eps: float = 1e-6,
) -> torch.Tensor:
    """Pixel-weighted binary cross-entropy.

    If ``pos_weight`` is None it is computed per-batch as
    ``(num_neg + eps) / (num_pos + eps)`` — this matches "weight = 1 / pixel
    frequency" in PRD §5.3 while avoiding division-by-zero on all-negative
    batches.

    pred and target must have matching shapes; both ∈ [0, 1].
    """
    _check_shapes(pred, target)

    if pos_weight is None:
        num_pos = target.sum()
        num_neg = (1.0 - target).sum()
        pos_weight_t = (num_neg + eps) / (num_pos + eps)
    else:
        pos_weight_t = torch.as_tensor(pos_weight, dtype=pred.dtype, device=pred.device)

    pred_clamped = pred.clamp(min=eps, max=1.0 - eps)
    loss = -(
        pos_weight_t * target * torch.log(pred_clamped)
        + (1.0 - target) * torch.log(1.0 - pred_clamped)
    )
    return loss.mean()


def dice_loss(pred: torch.Tensor, target: torch.Tensor, *, eps: float = 1e-6) -> torch.Tensor:
    """Smooth Dice loss across spatial dims, averaged over batch+channel."""
    _check_shapes(pred, target)
    flat_pred = pred.reshape(pred.shape[0], pred.shape[1], -1)
    flat_target = target.reshape(target.shape[0], target.shape[1], -1)
    inter = (flat_pred * flat_target).sum(-1)
    denom = flat_pred.sum(-1) + flat_target.sum(-1)
    return 1.0 - ((2.0 * inter + eps) / (denom + eps)).mean()


def fire_front_iou_loss(
    pred: torch.Tensor,
    target: torch.Tensor,
    *,
    threshold: float = 0.5,
    eps: float = 1e-6,
) -> torch.Tensor:
    """1 − IoU on the morphological gradient of the binarised mask.

    The binarisation uses a straight-through estimator so the loss has a
    usable gradient: forward pass binarises at ``threshold``, backward pass
    treats the binarisation as identity. The morph-gradient uses
    differentiable max-pools (PyTorch) so the rest of the chain is fine.
    """
    _check_shapes(pred, target)

    # Straight-through binarisation.
    bin_pred = (pred > threshold).to(pred.dtype)
    bin_pred = pred + (bin_pred - pred).detach()

    grad_pred = _morph_gradient(bin_pred)
    grad_target = _morph_gradient(target)

    inter = (grad_pred * grad_target).sum()
    union = (grad_pred + grad_target - grad_pred * grad_target).sum()
    return 1.0 - (inter + eps) / (union + eps)


# ────────────────────── Combined loss (PRD §5.3) ──────────────────────


def combined_loss(
    pred: torch.Tensor,
    target: torch.Tensor,
    *,
    alpha: float = 1.0,
    beta: float = 0.5,
    gamma: float = 0.3,
    pos_weight: float | None = None,
    eps: float = 1e-6,
) -> torch.Tensor:
    """L = α·BCE_w + β·Dice + γ·FireFrontIoU."""
    bce = weighted_bce_loss(pred, target, pos_weight=pos_weight, eps=eps)
    dice = dice_loss(pred, target, eps=eps)
    front = fire_front_iou_loss(pred, target, eps=eps)
    return alpha * bce + beta * dice + gamma * front


# ────────────────────── Diagnostic IoU metric ──────────────────────


def fire_front_iou_score(
    pred: torch.Tensor,
    target: torch.Tensor,
    *,
    threshold: float = 0.5,
    eps: float = 1e-6,
) -> torch.Tensor:
    """Hard IoU on the fire-front gradient — used for eval, not loss."""
    _check_shapes(pred, target)
    bin_pred = (pred > threshold).to(pred.dtype)
    bin_target = (target > threshold).to(target.dtype)
    grad_pred = _morph_gradient(bin_pred)
    grad_target = _morph_gradient(bin_target)
    inter = (grad_pred * grad_target).sum()
    union = (grad_pred + grad_target - grad_pred * grad_target).sum()
    return (inter + eps) / (union + eps)
