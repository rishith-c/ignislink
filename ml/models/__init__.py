"""SentryMax fire-spread models.

- rothermel: physics-informed cellular automaton baseline (Stage 3.A).
- unet_convlstm: U-Net + ConvLSTM primary model (Stage 3.B).
"""

from .rothermel import (
    FuelModel,
    GR2_GRASS,
    rate_of_spread,
    rate_of_spread_no_wind_no_slope,
    simulate_spread,
    slope_correction,
    wind_correction,
)

__all__ = [
    "FuelModel",
    "GR2_GRASS",
    "rate_of_spread",
    "rate_of_spread_no_wind_no_slope",
    "simulate_spread",
    "slope_correction",
    "wind_correction",
]
