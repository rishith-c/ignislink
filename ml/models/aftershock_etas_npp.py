"""Earthquake aftershock probability model — ETAS-prior + Neural Hawkes residual.

Architecture (per the SENTRY research report):

EarthquakeNPP benchmark (Stockman et al., NeurIPS 2024 — arXiv:2410.08226)
shows that pure neural temporal point processes DO NOT yet beat classical
ETAS on aftershock log-likelihood. The right move is a HYBRID: keep the
Omori-Utsu / Gutenberg-Richter physics as a hard prior, learn a small neural
correction on top. POSEIDON (arXiv:2601.02264) uses a similar physics-prior
approach.

Model
-----
For each candidate cell at (lat, lon, t) within 50 km of a recent M ≥ 5
mainshock, predict P(M ≥ M_target within Δt = 24h).

  λ_total(t, x, M) = λ_ETAS(t, x, M) * exp(g_θ(history, t, x, M))
                     ─────────────────   ─────────────────────────
                     classical prior     learned residual ∈ [-3, 3]

- λ_ETAS implements the Hawkes process from Ogata (1988):
    λ_ETAS(t) = μ + Σᵢ K · 10^(α(Mᵢ - M_c)) / ((t - tᵢ + c) ^ p)
  with the Gutenberg-Richter magnitude distribution
    P(M | event) ∝ 10^(-b * (M - M_c))
- g_θ is a small Transformer encoder over the K most recent events in a
  spatial window, outputting a scalar log-multiplier in [-3, 3].

The neural head sees event features the classical Hawkes can't:
  (mag, depth, lat, lon, time-delta, distance-to-cell, fault-zone one-hot,
   PGA estimate, b-value rolling estimate, day-of-year sin/cos)

Training data: USGS ComCat bulk catalog (1900-present), Poseidon HF
dataset (BorisKriuk/Poseidon, 2.8M events).

Live inference: USGS GeoJSON feed
  https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson

References
----------
- Ogata, Y. (1988). Statistical models for earthquake occurrences and
  residual analysis for point processes. JASA 83(401):9–27.
- Stockman et al. (2024). EarthquakeNPP. NeurIPS Datasets & Benchmarks.
  https://hf.co/papers/2410.08226
- Kriuk (2026). POSEIDON: A Physics-Informed Neural Hawkes Model.
  https://hf.co/papers/2601.02264
- Code reference: https://github.com/ss15859/EarthquakeNPP
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import torch
import torch.nn as nn
import torch.nn.functional as F


# ───────────────────────── ETAS prior ─────────────────────────

@dataclass(frozen=True)
class ETASParams:
    """Ogata (1988) ETAS parameters. Reasonable Southern-California defaults
    from the EarthquakeNPP paper Table 2."""

    mu: float = 1.5e-4  # background rate, events / km^2 / day
    K: float = 0.0089   # productivity
    alpha: float = 1.65  # mainshock-magnitude scaling exponent
    c: float = 0.012    # Omori-Utsu time offset, days
    p: float = 1.07     # Omori decay exponent
    b: float = 1.0      # Gutenberg-Richter b-value
    M_c: float = 2.5    # completeness threshold


def etas_intensity(
    history_mag: torch.Tensor,           # (B, K) past event magnitudes
    history_dt_days: torch.Tensor,       # (B, K) Δt to "now", days, ≥0
    history_dist_km: torch.Tensor,       # (B, K) distance from candidate cell, km
    params: ETASParams = ETASParams(),
    spatial_kernel_km: float = 30.0,
) -> torch.Tensor:
    """Compute the Ogata-1988 ETAS conditional intensity at the candidate cell.

    Returns shape (B,). All inputs use a "right-pad with zero magnitude" mask
    convention — events with mag < M_c are ignored.
    """
    mask = (history_mag >= params.M_c).float()
    mag_term = 10.0 ** (params.alpha * (history_mag - params.M_c))
    omori = 1.0 / ((history_dt_days + params.c) ** params.p)
    spatial = torch.exp(-(history_dist_km / spatial_kernel_km) ** 2)
    contribution = params.K * mag_term * omori * spatial * mask
    return params.mu + contribution.sum(dim=-1)


def gutenberg_richter_p_above(M_target: float, b: float = 1.0, M_c: float = 2.5) -> float:
    """P(M ≥ M_target | event has occurred), using the truncated G-R law."""
    if M_target <= M_c:
        return 1.0
    return 10.0 ** (-b * (M_target - M_c))


# ─────────────────────── Neural Hawkes residual ───────────────────────

class TransformerEventEncoder(nn.Module):
    """Encoder over the K most recent events in a spatial window.

    Per-event features: 11 channels — see the module docstring."""

    def __init__(
        self,
        d_model: int = 64,
        n_heads: int = 4,
        n_layers: int = 2,
        n_event_features: int = 11,
        max_history: int = 64,
    ) -> None:
        super().__init__()
        self.embed = nn.Linear(n_event_features, d_model)
        self.pos_embed = nn.Embedding(max_history, d_model)
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=n_heads,
            dim_feedforward=d_model * 2,
            batch_first=True,
            activation="gelu",
        )
        self.encoder = nn.TransformerEncoder(encoder_layer, num_layers=n_layers)
        self.head = nn.Linear(d_model, 1)

    def forward(self, history_features: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
        """history_features: (B, K, F=11), mask: (B, K) — True = pad."""
        b, k, _ = history_features.shape
        pos = torch.arange(k, device=history_features.device).unsqueeze(0).expand(b, k)
        x = self.embed(history_features) + self.pos_embed(pos)
        x = self.encoder(x, src_key_padding_mask=mask)
        # Aggregate via mean over non-padded positions.
        valid = (~mask).float().unsqueeze(-1)  # (B, K, 1)
        agg = (x * valid).sum(dim=1) / valid.sum(dim=1).clamp(min=1)
        # Output a scalar log-multiplier ∈ [-3, 3] so the residual can dampen
        # OR amplify the ETAS intensity within physically reasonable bounds.
        return torch.tanh(self.head(agg).squeeze(-1)) * 3.0


class AftershockHybridModel(nn.Module):
    """Full model: ETAS prior + neural Hawkes residual."""

    def __init__(self, params: ETASParams = ETASParams(), **kw) -> None:
        super().__init__()
        self.params = params
        self.encoder = TransformerEventEncoder(**kw)

    def forward(
        self,
        history_mag: torch.Tensor,
        history_dt_days: torch.Tensor,
        history_dist_km: torch.Tensor,
        history_features: torch.Tensor,
        history_pad_mask: torch.Tensor,
        horizon_days: float = 1.0,
        m_target: float = 4.0,
    ) -> torch.Tensor:
        """Return P(M ≥ m_target within `horizon_days`) per batch element."""
        log_mult = self.encoder(history_features, history_pad_mask)  # (B,)
        mult = torch.exp(log_mult)
        lam_etas = etas_intensity(history_mag, history_dt_days, history_dist_km, self.params)
        lam = lam_etas * mult  # events / day in the candidate cell
        # P(at least one event in horizon | rate λ) = 1 - exp(-λ * dt)
        p_any = 1.0 - torch.exp(-lam * horizon_days)
        # Multiply by P(M ≥ m_target | event occurred) under G-R.
        p_mag = gutenberg_richter_p_above(m_target, b=self.params.b, M_c=self.params.M_c)
        return torch.clamp(p_any * p_mag, 0.0, 1.0)


# ─────────────────────────── Loss + metric ───────────────────────────

def aftershock_bce(pred: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
    """Binary-cross-entropy on the realised aftershock-occurred label.

    Use this as the training loss against a labelled dataset of (history,
    realised next-24h aftershock above M_target ?) pairs."""
    eps = 1e-6
    pred = pred.clamp(eps, 1.0 - eps)
    return -(target * torch.log(pred) + (1.0 - target) * torch.log(1.0 - pred)).mean()


def brier_score(pred: torch.Tensor, target: torch.Tensor) -> float:
    """Brier score — proper scoring rule used for ETAS evaluation."""
    return float(((pred - target) ** 2).mean().item())


# ─────────────────────────── Convenience ──────────────────────────────

DEFAULT_FEATURE_COLUMNS = [
    "mag",
    "depth_km",
    "lat",
    "lon",
    "dt_days",
    "dist_km",
    "fault_zone_id",   # int category, embedded externally
    "pga_g",
    "b_value_local",
    "doy_sin",
    "doy_cos",
]
