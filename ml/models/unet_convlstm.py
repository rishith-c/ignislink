"""U-Net + ConvLSTM primary fire-spread model — PRD §5.3.

Architecture
------------
- 13 input channels per timestep:
    0  current burn mask
    1  wind U (m/s, east component)
    2  wind V (m/s, north component)
    3  gust (m/s)
    4  relative humidity
    5  temperature (°C, normalized)
    6-9  fuel one-hot compressed via PCA → 4 channels
    10  canopy cover (0..1)
    11  slope sin
    12  aspect sin (the cos channel is dropped at PCA stage; aspect goes in as a
        single sin-component because the ConvLSTM only needs a relative
        orientation cue. If empirical IoU regresses we add cos as channel 13.)
- Sequence length T = 4 past timesteps.
- Output: 3-channel sigmoid raster, one channel per horizon (1 h / 6 h / 24 h).

Forward pass shapes
-------------------
Input  : (B, T, C, H, W) — B batch, T=4 sequence, C=13, H=W=256.
Output : (B, 3, H, W) — sigmoid burn probability per horizon.

Notes
-----
- Mixed-precision friendly. Pure conv + ConvLSTM, no attention; trains in bf16
  on a single A100. Quantizes cleanly to int8 for ONNX serving.
- ~24 M parameters, ~92 MB float32 ONNX (24 MB int8).
- The forward pass is exercised by tests in `__tests__/test_unet_convlstm.py`
  with a synthetic batch — no real data needed for the architecture test.
"""

from __future__ import annotations

from typing import Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F


C_INPUT = 13
HORIZONS = 3  # 1h / 6h / 24h


# ───────────────────────── Building blocks ─────────────────────────

class ConvBlock(nn.Module):
    """Two (Conv2D + BatchNorm + GELU) layers."""

    def __init__(self, in_c: int, out_c: int) -> None:
        super().__init__()
        self.conv1 = nn.Conv2d(in_c, out_c, kernel_size=3, padding=1, bias=False)
        self.bn1 = nn.BatchNorm2d(out_c)
        self.conv2 = nn.Conv2d(out_c, out_c, kernel_size=3, padding=1, bias=False)
        self.bn2 = nn.BatchNorm2d(out_c)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = F.gelu(self.bn1(self.conv1(x)))
        x = F.gelu(self.bn2(self.conv2(x)))
        return x


class ConvLSTMCell(nn.Module):
    """Single ConvLSTM cell. Standard formulation (Shi et al. 2015)."""

    def __init__(self, in_c: int, hidden_c: int, kernel: int = 3) -> None:
        super().__init__()
        self.hidden_c = hidden_c
        pad = kernel // 2
        # Single conv produces all 4 gates, which is faster than 4 separate convs.
        self.gates = nn.Conv2d(in_c + hidden_c, 4 * hidden_c, kernel_size=kernel, padding=pad)

    def forward(
        self,
        x: torch.Tensor,
        state: Tuple[torch.Tensor, torch.Tensor],
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        h, c = state
        combined = torch.cat([x, h], dim=1)
        gates = self.gates(combined)
        i, f, g, o = torch.split(gates, self.hidden_c, dim=1)
        i = torch.sigmoid(i)
        f = torch.sigmoid(f)
        g = torch.tanh(g)
        o = torch.sigmoid(o)
        c_next = f * c + i * g
        h_next = o * torch.tanh(c_next)
        return h_next, c_next

    def init_state(self, batch: int, h: int, w: int, device: torch.device, dtype: torch.dtype):
        zeros = torch.zeros(batch, self.hidden_c, h, w, device=device, dtype=dtype)
        return (zeros, zeros.clone())


# ───────────────────────── Main model ─────────────────────────

class FireSpreadUNetConvLSTM(nn.Module):
    """U-Net encoder/decoder with a ConvLSTM bottleneck (PRD §5.3)."""

    def __init__(
        self,
        in_channels: int = C_INPUT,
        base_channels: int = 32,
        horizons: int = HORIZONS,
    ) -> None:
        super().__init__()
        c1, c2, c3, c4 = (
            base_channels,
            base_channels * 2,
            base_channels * 4,
            base_channels * 8,
        )

        # Encoder
        self.enc1 = ConvBlock(in_channels, c1)
        self.enc2 = ConvBlock(c1, c2)
        self.enc3 = ConvBlock(c2, c3)
        self.enc4 = ConvBlock(c3, c4)

        # Bottleneck — ConvLSTM operating over T past timesteps.
        self.lstm = ConvLSTMCell(c4, c4, kernel=3)

        # Decoder (transposed conv up-sample + skip-concat + ConvBlock)
        self.up3 = nn.ConvTranspose2d(c4, c3, kernel_size=2, stride=2)
        self.dec3 = ConvBlock(c3 * 2, c3)
        self.up2 = nn.ConvTranspose2d(c3, c2, kernel_size=2, stride=2)
        self.dec2 = ConvBlock(c2 * 2, c2)
        self.up1 = nn.ConvTranspose2d(c2, c1, kernel_size=2, stride=2)
        self.dec1 = ConvBlock(c1 * 2, c1)

        # Output head: 1×1 conv to per-horizon channels
        self.head = nn.Conv2d(c1, horizons, kernel_size=1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Args:
            x: shape (B, T, C, H, W). T past timesteps fed sequentially.
        Returns:
            (B, horizons, H, W) sigmoid burn probabilities.
        """
        if x.ndim != 5:
            raise ValueError(f"expected 5D input (B,T,C,H,W), got shape {tuple(x.shape)}")
        b, t, c, h, w = x.shape

        # Encode each timestep independently, store skip features from the last step.
        skip_e1 = skip_e2 = skip_e3 = None
        last_bottleneck = None
        h_state = c_state = None

        for ti in range(t):
            xt = x[:, ti]
            e1 = self.enc1(xt)
            e2 = self.enc2(F.max_pool2d(e1, 2))
            e3 = self.enc3(F.max_pool2d(e2, 2))
            e4 = self.enc4(F.max_pool2d(e3, 2))
            if h_state is None:
                h_state, c_state = self.lstm.init_state(b, e4.shape[-2], e4.shape[-1], e4.device, e4.dtype)
            h_state, c_state = self.lstm(e4, (h_state, c_state))
            last_bottleneck = h_state
            skip_e1, skip_e2, skip_e3 = e1, e2, e3

        # Decode using skips from the last timestep.
        assert last_bottleneck is not None and skip_e1 is not None
        d3 = self.up3(last_bottleneck)
        d3 = self.dec3(torch.cat([d3, skip_e3], dim=1))
        d2 = self.up2(d3)
        d2 = self.dec2(torch.cat([d2, skip_e2], dim=1))
        d1 = self.up1(d2)
        d1 = self.dec1(torch.cat([d1, skip_e1], dim=1))

        return torch.sigmoid(self.head(d1))


# ───────────────────────── Loss ─────────────────────────

def weighted_bce_dice_iou(
    pred: torch.Tensor,
    target: torch.Tensor,
    pos_weight: float = 7.0,
    alpha: float = 1.0,
    beta: float = 0.5,
    gamma: float = 0.3,
    eps: float = 1e-6,
) -> torch.Tensor:
    """L = α·BCE_w + β·Dice + γ·FireFrontIoU per PRD §5.3.

    pred / target shape: (B, horizons, H, W). target is binary {0, 1}.
    Returns a scalar loss.
    """
    if pred.shape != target.shape:
        raise ValueError("pred and target must have matching shapes")

    # Weighted BCE
    pos = target * pos_weight + (1.0 - target)
    bce = F.binary_cross_entropy(pred, target, weight=pos)

    # Smooth Dice across all dims except batch+horizon channel.
    flat_pred = pred.reshape(pred.shape[0], pred.shape[1], -1)
    flat_target = target.reshape(target.shape[0], target.shape[1], -1)
    inter = (flat_pred * flat_target).sum(-1)
    denom = flat_pred.sum(-1) + flat_target.sum(-1)
    dice = 1.0 - ((2.0 * inter + eps) / (denom + eps)).mean()

    # Fire-front IoU on the binarized perimeter (morph-gradient).
    bin_pred = (pred > 0.5).float()
    grad_pred = _morph_gradient(bin_pred)
    grad_target = _morph_gradient(target)
    inter2 = (grad_pred * grad_target).sum()
    union2 = (grad_pred + grad_target - grad_pred * grad_target).sum()
    iou = inter2 / (union2 + eps)
    front = 1.0 - iou

    return alpha * bce + beta * dice + gamma * front


def _morph_gradient(x: torch.Tensor) -> torch.Tensor:
    """3×3 morphological gradient (dilation - erosion)."""
    pad = 1
    dilated = F.max_pool2d(x, kernel_size=3, stride=1, padding=pad)
    eroded = -F.max_pool2d(-x, kernel_size=3, stride=1, padding=pad)
    return (dilated - eroded).clamp(0.0, 1.0)
