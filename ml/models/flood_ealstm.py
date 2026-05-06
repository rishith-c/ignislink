"""Flood / river-stage prediction model — Entity-Aware LSTM (EA-LSTM).

Architecture (per the SENTRY research report):

This is the architecture Google's Flood Forecasting Initiative used in the
Nature 2024 paper "Global prediction of extreme floods in ungauged
watersheds" (https://www.nature.com/articles/s41586-024-07145-1) and the
NeuralHydrology library (https://github.com/neuralhydrology/neuralhydrology).
EA-LSTM (Kratzert et al. 2018, https://arxiv.org/pdf/2010.07921) sits on the
single-site Pareto frontier; only RiverMamba (https://hf.co/papers/2505.22535)
and graph-network variants beat it for multi-gauge networks.

Why EA-LSTM
-----------
A vanilla LSTM trained jointly on N basins forgets per-basin specifics.
EA-LSTM splits the network: static catchment attributes (basin area, slope,
soil class, land cover, mean elevation, …) gate the input via a learned
input gate, while the standard LSTM handles the dynamic forcings (precip,
temperature, snow water equivalent, antecedent precip). This lets one model
generalise across hundreds of basins without forgetting.

We output a quantile head (10 / 50 / 90th percentile river-stage) for the
next 6 / 24 / 48 hours so the dispatcher console can render uncertainty
bands instead of a single point estimate.

Training data
-------------
- USGS NWIS Instantaneous Values service (https://waterservices.usgs.gov/),
  parameter codes 00065 (gauge stage) and 00060 (discharge).
- CAMELS basin attributes (https://ral.ucar.edu/solutions/products/camels)
  — 671 CONUS basins with co-registered hydrological + climatic features.
- ERA5-Land reanalysis for historical forcings.
- HRRR / GFS for live forecast forcings.

References
----------
- Kratzert et al. (2019). Towards learning universal, regional, and local
  hydrological behaviors via machine learning applied to large-sample
  datasets. HESS 23:5089–5110.
- Nearing et al. (2024). Global prediction of extreme floods in ungauged
  watersheds. Nature 627:559–563.
- Code: https://github.com/neuralhydrology/neuralhydrology
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


# ─────────────────────────── EA-LSTM cell ───────────────────────────

class EALSTMCell(nn.Module):
    """Entity-Aware LSTM cell.

    Standard LSTM equations except the INPUT gate is computed only from the
    static catchment attributes — it stays fixed per-basin while the
    dynamic forcings flow through the forget / cell / output gates as
    usual. This is the key insight from Kratzert 2019.
    """

    def __init__(self, dynamic_input_size: int, static_input_size: int, hidden_size: int) -> None:
        super().__init__()
        self.hidden_size = hidden_size

        # Input gate: from static features only.
        self.input_gate = nn.Linear(static_input_size, hidden_size)

        # Forget / cell-update / output gates: standard LSTM (dynamic + h_prev).
        self.fco_gates = nn.Linear(dynamic_input_size + hidden_size, 3 * hidden_size)

    def forward(
        self,
        x_d: torch.Tensor,        # (B, T, D_dynamic)
        x_s: torch.Tensor,        # (B, D_static)
    ) -> tuple[torch.Tensor, tuple[torch.Tensor, torch.Tensor]]:
        b, t, _ = x_d.shape
        device = x_d.device
        h = torch.zeros(b, self.hidden_size, device=device)
        c = torch.zeros(b, self.hidden_size, device=device)
        i = torch.sigmoid(self.input_gate(x_s))  # (B, H), constant over t
        outputs = []
        for ti in range(t):
            x_t = x_d[:, ti, :]
            combined = torch.cat([x_t, h], dim=-1)
            gates = self.fco_gates(combined)
            f, g, o = torch.split(gates, self.hidden_size, dim=-1)
            f = torch.sigmoid(f)
            g = torch.tanh(g)
            o = torch.sigmoid(o)
            c = f * c + i * g
            h = o * torch.tanh(c)
            outputs.append(h)
        return torch.stack(outputs, dim=1), (h, c)


# ─────────────────────── Quantile head + full model ───────────────────────

class FloodEALSTM(nn.Module):
    """Stage-prediction model: EA-LSTM encoder + per-horizon quantile head."""

    def __init__(
        self,
        dynamic_input_size: int = 8,
        static_input_size: int = 27,  # CAMELS attribute count
        hidden_size: int = 128,
        horizons: tuple[int, ...] = (6, 24, 48),
        quantiles: tuple[float, ...] = (0.10, 0.50, 0.90),
    ) -> None:
        super().__init__()
        self.cell = EALSTMCell(dynamic_input_size, static_input_size, hidden_size)
        self.horizons = horizons
        self.quantiles = quantiles
        self.head = nn.Linear(hidden_size, len(horizons) * len(quantiles))

    def forward(self, x_d: torch.Tensor, x_s: torch.Tensor) -> torch.Tensor:
        """x_d: (B, T_lookback, D_dynamic); x_s: (B, D_static).

        Returns predictions of shape (B, H, Q) where:
          H = len(horizons), Q = len(quantiles).
        Values are stage in metres above gauge datum.
        """
        outputs, _ = self.cell(x_d, x_s)
        last = outputs[:, -1, :]  # (B, H_hidden)
        out = self.head(last)
        return out.view(-1, len(self.horizons), len(self.quantiles))


# ───────────────────────── Quantile loss ─────────────────────────

def pinball_loss(
    pred: torch.Tensor,
    target: torch.Tensor,
    quantiles: tuple[float, ...] = (0.10, 0.50, 0.90),
) -> torch.Tensor:
    """Pinball / quantile-regression loss.

    pred: (B, H, Q); target: (B, H). The same target is compared against each
    quantile head with the asymmetric pinball penalty.
    """
    q = torch.tensor(quantiles, device=pred.device).view(1, 1, -1)
    target_b = target.unsqueeze(-1).expand_as(pred)
    diff = target_b - pred
    return torch.maximum(q * diff, (q - 1.0) * diff).mean()


# ─────────────────────────── Feature columns ───────────────────────────

DEFAULT_DYNAMIC_FEATURES = [
    "precip_mm_per_hr",
    "temperature_c",
    "snow_water_equivalent_mm",
    "antecedent_precip_30d_mm",
    "upstream_stage_m",
    "upstream_discharge_cms",
    "soil_moisture_pct",
    "doy_sin",
]
"""Hourly time-varying features. Lookback window per the paper: 365 days
hourly (≈ 8760 timesteps); we'll use 168 (one week) as the smoke default."""

DEFAULT_STATIC_FEATURES = [
    "drainage_area_km2",
    "mean_elevation_m",
    "slope_mean_deg",
    "stream_density_per_km2",
    "frac_forest",
    "frac_urban",
    "frac_cropland",
    "frac_grass",
    "frac_water",
    "frac_snowice",
    "soil_porosity",
    "soil_conductivity",
    "max_water_content_mm",
    "geol_carbonate_frac",
    "geol_clay_frac",
    "p_mean_mm_per_d",
    "pet_mean_mm_per_d",
    "aridity_index",
    "frac_snow",
    "high_prec_freq_per_yr",
    "high_prec_dur_d",
    "low_prec_freq_per_yr",
    "low_prec_dur_d",
    "lat_outlet_deg",
    "lon_outlet_deg",
    "elev_outlet_m",
    "river_length_km",
]
"""CAMELS-derived basin attributes. 27 columns matches the reduced set used
in Kratzert 2019 Table 4."""
