"""U-Net + ConvLSTM primary fire-spread model — PRD §5.3.

Architecture (committed shape)
------------------------------
Input:  ``(B, T=4, C=14, H, W)`` — 4 past timesteps, 14 channels per timestep.
Output: ``(B, 3, H, W)`` — sigmoid burn probabilities, one channel per
horizon (1 h / 6 h / 24 h).

Channel layout (14 channels per timestep)
-----------------------------------------
    0   current burn mask (binary)
    1   wind U (east component, m/s)
    2   wind V (north component, m/s)
    3   relative humidity (0..1)
    4   temperature (normalized °C)
    5   FBFM40 fuel-model index (int8, embedded inside the model)
    6   canopy cover (0..1)
    7   canopy bulk density (normalized)
    8   slope (radians, sin component)
    9   slope (radians, cos component)
    10  aspect (radians, sin component)
    11  aspect (radians, cos component)
    12  days-since-precip (normalized)
    13  Rothermel ROS prior (m/s, derived from ml/models/rothermel.py)

PRD §5.2 enumerates the source feature set, which has more nominal channels
because FBFM40 is listed as a 40-class one-hot. Per PRD §5.3 we collapse
that 40-class one-hot into a single integer index that is embedded inside
the model (8-dim learned embedding broadcast across the spatial grid). The
remaining redundant channels in the source list (gust, separately-stored
sin/cos for wind direction) are dropped — wind U + V already carry both.
This brings the operational input to 14 channels.

Architecture
------------
- Encoder: 4 stages of ``ConvBlock`` (Conv2D → BatchNorm → GELU) × 2,
  with stride-2 downsample between stages.
- Bottleneck: ``ConvLSTMCell`` (hidden 256ch) processing the T=4 sequence.
- Decoder: 4 stages mirroring the encoder, with skip connections.
- Head: 1×1 conv → 3 channels (one per horizon).
- Sigmoid outputs.

Param budget: ~24 M at ``base_channels=48`` plus the 8-dim fuel embedding.
Mixed-precision friendly. Pure conv + ConvLSTM, no attention; trains in
bf16 on a single A100. Quantizes cleanly to int8 for ONNX serving.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F


C_INPUT: int = 14
"""Number of input channels per timestep (see channel layout above)."""

HORIZONS: int = 3
"""1 h / 6 h / 24 h — frozen by `packages/contracts/predict-spread.ts`."""

T_DEFAULT: int = 4
"""Default sequence length: 4 past timesteps."""

FBFM40_NUM_CLASSES: int = 41
"""40 standard fuel models + class 0 reserved for ``non-burnable``."""

FBFM40_EMBED_DIM: int = 8
"""Embedding dimensionality for the fuel-model channel."""

FUEL_CHANNEL_INDEX: int = 5
"""Index of the FBFM40 channel inside the 14-channel input."""


# ───────────────────────── Building blocks ─────────────────────────


class ConvBlock(nn.Module):
    """Two (Conv2D + BatchNorm + GELU) layers (PRD §5.3)."""

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


class Down(nn.Module):
    """Stride-2 downsample + ConvBlock."""

    def __init__(self, in_c: int, out_c: int) -> None:
        super().__init__()
        self.pool = nn.MaxPool2d(2)
        self.block = ConvBlock(in_c, out_c)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.block(self.pool(x))


class Up(nn.Module):
    """Transposed-conv upsample, skip-concat, ConvBlock."""

    def __init__(self, in_c: int, skip_c: int, out_c: int) -> None:
        super().__init__()
        self.up = nn.ConvTranspose2d(in_c, out_c, kernel_size=2, stride=2)
        self.block = ConvBlock(out_c + skip_c, out_c)

    def forward(self, x: torch.Tensor, skip: torch.Tensor) -> torch.Tensor:
        x = self.up(x)
        # Defensive crop/pad: if odd input dims are encountered the upsample
        # may be off-by-one against the skip. Pad with zeros to match.
        if x.shape[-2:] != skip.shape[-2:]:
            diff_h = skip.shape[-2] - x.shape[-2]
            diff_w = skip.shape[-1] - x.shape[-1]
            x = F.pad(x, [0, diff_w, 0, diff_h])
        return self.block(torch.cat([x, skip], dim=1))


class ConvLSTMCell(nn.Module):
    """Standard ConvLSTM cell (Shi et al. 2015).

    Input gate, forget gate, cell update, output gate are computed by a
    single fused conv, then split — equivalent to four separate convs but
    cheaper at inference and easier to compile to ONNX.
    """

    def __init__(self, in_c: int, hidden_c: int, kernel: int = 3) -> None:
        super().__init__()
        self.hidden_c = hidden_c
        pad = kernel // 2
        self.gates = nn.Conv2d(
            in_c + hidden_c, 4 * hidden_c, kernel_size=kernel, padding=pad
        )

    def forward(
        self,
        x: torch.Tensor,
        state: Tuple[torch.Tensor, torch.Tensor],
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        h, c = state
        combined = torch.cat([x, h], dim=1)
        gates = self.gates(combined)
        # Slice along the channel dim instead of torch.split — the latter
        # emits a Split op that requires a num_outputs attribute (ONNX
        # opset 18+); slicing exports cleanly under opset 17.
        hc = self.hidden_c
        i = torch.sigmoid(gates[:, 0 * hc : 1 * hc])
        f = torch.sigmoid(gates[:, 1 * hc : 2 * hc])
        g = torch.tanh(gates[:, 2 * hc : 3 * hc])
        o = torch.sigmoid(gates[:, 3 * hc : 4 * hc])
        c_next = f * c + i * g
        h_next = o * torch.tanh(c_next)
        return h_next, c_next

    def init_state(
        self,
        batch: int,
        h: int,
        w: int,
        device: torch.device,
        dtype: torch.dtype,
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        zeros = torch.zeros(batch, self.hidden_c, h, w, device=device, dtype=dtype)
        return (zeros, zeros.clone())


# ───────────────────────── Main model ─────────────────────────


@dataclass(frozen=True)
class UNetConvLSTMConfig:
    in_channels: int = C_INPUT
    base_channels: int = 48
    horizons: int = HORIZONS
    fuel_classes: int = FBFM40_NUM_CLASSES
    fuel_embed_dim: int = FBFM40_EMBED_DIM
    fuel_channel_index: int = FUEL_CHANNEL_INDEX
    bottleneck_hidden: int = 256


class FireSpreadUNetConvLSTM(nn.Module):
    """U-Net encoder/decoder with a ConvLSTM bottleneck (PRD §5.3).

    The fuel-model channel (FUEL_CHANNEL_INDEX, default 5) is treated as an
    integer class index and projected through an embedding layer. The other
    13 channels are passed straight through. The model concatenates the
    embedding (8 channels) with the 13 continuous channels, giving a
    ``13 + fuel_embed_dim``-channel input to the encoder.

    Args:
        in_channels: total channel count of the raw input (14 by default).
        base_channels: encoder stage-1 channel width. Stages are 1×, 2×, 4×, 8×.
        horizons: number of output horizons (3 = 1h/6h/24h).
        fuel_classes: number of FBFM40 classes including ``non-burnable``.
        fuel_embed_dim: dimension of the learned fuel embedding.
        fuel_channel_index: index of the integer fuel channel in the input.
        bottleneck_hidden: ConvLSTM hidden-state channel count.
    """

    def __init__(
        self,
        in_channels: int = C_INPUT,
        base_channels: int = 48,
        horizons: int = HORIZONS,
        *,
        fuel_classes: int = FBFM40_NUM_CLASSES,
        fuel_embed_dim: int = FBFM40_EMBED_DIM,
        fuel_channel_index: int = FUEL_CHANNEL_INDEX,
        bottleneck_hidden: int = 256,
    ) -> None:
        super().__init__()
        if not (0 <= fuel_channel_index < in_channels):
            raise ValueError("fuel_channel_index out of range for in_channels")

        self.in_channels = in_channels
        self.fuel_channel_index = fuel_channel_index
        self.fuel_classes = fuel_classes
        self.fuel_embed_dim = fuel_embed_dim

        self.fuel_embed = nn.Embedding(fuel_classes, fuel_embed_dim)

        # Continuous channels = in_channels - 1 (drop the integer fuel channel).
        # After projecting fuel through the embedding we re-concat → 13 + 8 = 21.
        encoder_in = (in_channels - 1) + fuel_embed_dim

        c1 = base_channels
        c2 = base_channels * 2
        c3 = base_channels * 4
        c4 = base_channels * 8
        c5 = base_channels * 8  # cap channel growth at 8× to control param count

        # Encoder: 4 down stages + entry block. Each Down halves the spatial
        # dims; together with the entry block this produces 4 spatial scales.
        self.enc1 = ConvBlock(encoder_in, c1)
        self.down1 = Down(c1, c2)
        self.down2 = Down(c2, c3)
        self.down3 = Down(c3, c4)
        self.down4 = Down(c4, c5)

        # Bottleneck — ConvLSTM operating over T past timesteps.
        self.bottleneck_proj_in = (
            nn.Conv2d(c5, bottleneck_hidden, kernel_size=1)
            if c5 != bottleneck_hidden
            else nn.Identity()
        )
        self.bottleneck_proj_out = (
            nn.Conv2d(bottleneck_hidden, c5, kernel_size=1)
            if c5 != bottleneck_hidden
            else nn.Identity()
        )
        self.lstm = ConvLSTMCell(bottleneck_hidden, bottleneck_hidden, kernel=3)

        # Decoder mirrors encoder.
        self.up4 = Up(c5, c4, c4)
        self.up3 = Up(c4, c3, c3)
        self.up2 = Up(c3, c2, c2)
        self.up1 = Up(c2, c1, c1)

        # Head: 1×1 conv to per-horizon channels.
        self.head = nn.Conv2d(c1, horizons, kernel_size=1)

    def _split_and_embed_fuel(self, x: torch.Tensor) -> torch.Tensor:
        """Replace the integer fuel channel with an 8-dim learned embedding.

        x: (B, C, H, W). Returns (B, C-1+embed_dim, H, W).
        """
        b, c, h, w = x.shape
        idx = self.fuel_channel_index
        cont_left = x[:, :idx]
        cont_right = x[:, idx + 1 :]
        fuel = x[:, idx]  # (B, H, W) float

        # Round to nearest valid class index, clamp.
        fuel_idx = fuel.round().clamp(0, self.fuel_classes - 1).long()
        # (B, H, W, embed_dim) → (B, embed_dim, H, W)
        emb = self.fuel_embed(fuel_idx).permute(0, 3, 1, 2).contiguous()
        return torch.cat([cont_left, emb, cont_right], dim=1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """Forward pass.

        Args:
            x: shape ``(B, T, C, H, W)``. T past timesteps fed sequentially.

        Returns:
            ``(B, horizons, H, W)`` sigmoid burn probabilities.
        """
        if x.ndim != 5:
            raise ValueError(f"expected 5D input (B,T,C,H,W), got shape {tuple(x.shape)}")
        b, t, c, h, w = x.shape
        if c != self.in_channels:
            raise ValueError(
                f"expected {self.in_channels} input channels, got {c}"
            )

        skip_e1 = skip_e2 = skip_e3 = skip_e4 = None
        h_state = c_state = None

        for ti in range(t):
            xt = self._split_and_embed_fuel(x[:, ti])
            e1 = self.enc1(xt)
            e2 = self.down1(e1)
            e3 = self.down2(e2)
            e4 = self.down3(e3)
            e5 = self.down4(e4)

            bottleneck_in = self.bottleneck_proj_in(e5)
            if h_state is None:
                h_state, c_state = self.lstm.init_state(
                    b,
                    bottleneck_in.shape[-2],
                    bottleneck_in.shape[-1],
                    bottleneck_in.device,
                    bottleneck_in.dtype,
                )
            h_state, c_state = self.lstm(bottleneck_in, (h_state, c_state))
            skip_e1, skip_e2, skip_e3, skip_e4 = e1, e2, e3, e4

        assert skip_e1 is not None and skip_e2 is not None and skip_e3 is not None and skip_e4 is not None
        bottleneck_out = self.bottleneck_proj_out(h_state)

        d4 = self.up4(bottleneck_out, skip_e4)
        d3 = self.up3(d4, skip_e3)
        d2 = self.up2(d3, skip_e2)
        d1 = self.up1(d2, skip_e1)
        return torch.sigmoid(self.head(d1))


# ───────────────────────── Convenience factory ─────────────────────────


def build_default_model() -> FireSpreadUNetConvLSTM:
    """Build the canonical model used by training + ONNX export."""
    return FireSpreadUNetConvLSTM(
        in_channels=C_INPUT,
        base_channels=48,
        horizons=HORIZONS,
    )


# ───────────────────────── Loss (re-exported for backwards compat) ─────────────────────────
# The full loss menu now lives in ml/training/losses.py; we keep the legacy
# combined helper here so existing tests that import it still work.


def weighted_bce_dice_iou(
    pred: torch.Tensor,
    target: torch.Tensor,
    pos_weight: float = 7.0,
    alpha: float = 1.0,
    beta: float = 0.5,
    gamma: float = 0.3,
    eps: float = 1e-6,
) -> torch.Tensor:
    """Legacy combined loss helper.

    New code should import from :mod:`ml.training.losses`.
    """
    from ml.training.losses import combined_loss

    return combined_loss(
        pred,
        target,
        alpha=alpha,
        beta=beta,
        gamma=gamma,
        pos_weight=pos_weight,
        eps=eps,
    )
