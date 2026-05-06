"""Post-processing for the fire-spread ONNX outputs.

Turns the ``(3, H, W)`` sigmoid probability raster into the
``HorizonResult`` shape required by ``packages/contracts/src/predict-spread.ts``.

We use the circle-scaled-to-acres approximation rather than a true contour
extractor to avoid the OpenCV dependency for the hackathon build. The
resulting MultiPolygon is a regular polygon centered on the hotspot whose
area scales with the raster probability mass at each quantile cutoff.
"""

from __future__ import annotations

import math
from typing import Iterable

import numpy as np

from sentry_max_api.contracts import (
    HorizonContours,
    HorizonResult,
    MultiPolygon,
)


# Map horizon (minutes) → channel index in the ONNX output.
HORIZON_TO_CHANNEL: dict[int, int] = {60: 0, 360: 1, 1440: 2}

# Quantile cutoffs for the p25/p50/p75 contours.
_QUANTILES: tuple[tuple[str, float], ...] = (
    ("p25", 0.25),
    ("p50", 0.50),
    ("p75", 0.75),
)


def _circle_polygon(
    lon: float,
    lat: float,
    radius_m: float,
    n_vertices: int = 32,
) -> list[list[list[float]]]:
    """Build a closed-ring MultiPolygon coordinate list around (lon, lat)."""

    if radius_m <= 0.0:
        radius_m = 1.0  # ensure non-degenerate output

    # Approximate metres-per-degree at this latitude. Good enough for the
    # demo console at the typical extents we render.
    lat_rad = math.radians(lat)
    m_per_deg_lat = 111_320.0
    m_per_deg_lon = max(1.0, 111_320.0 * math.cos(lat_rad))

    ring: list[list[float]] = []
    for i in range(n_vertices):
        theta = 2.0 * math.pi * (i / n_vertices)
        dx = (radius_m * math.cos(theta)) / m_per_deg_lon
        dy = (radius_m * math.sin(theta)) / m_per_deg_lat
        ring.append([lon + dx, lat + dy])
    ring.append(ring[0])  # close the ring
    return [[ring]]  # MultiPolygon: list[Polygon: list[Ring: list[Position]]]


def _radius_for_quantile(prob_band: np.ndarray, quantile: float) -> float:
    """Return a radius in metres derived from the probability mass.

    Uses the area covered by pixels above the quantile cutoff and converts
    that to an equivalent-circle radius. Each pixel is treated as a 30 m
    cell (LANDFIRE / SRTM native scale).
    """

    cutoff = float(np.quantile(prob_band, quantile))
    # Burning if probability above the quantile cutoff and above 0.05 (avoid
    # noise dominating when the fire is small).
    burning_mask = prob_band >= max(cutoff, 0.05)
    n_pixels = int(burning_mask.sum())
    pixel_area_m2 = 30.0 * 30.0
    total_area = max(1.0, n_pixels * pixel_area_m2)
    radius = math.sqrt(total_area / math.pi)
    # Floor at 50 m so the demo always renders a visible ring.
    return max(50.0, radius)


def build_horizon_results(
    probability: np.ndarray,
    hotspot_lonlat: tuple[float, float],
    horizons_min: Iterable[int],
) -> list[HorizonResult]:
    """Convert ONNX output ``(3, H, W)`` into ``HorizonResult`` list."""

    if probability.ndim == 4:
        # ``(B, 3, H, W)`` → drop batch dim
        probability = probability[0]
    if probability.ndim != 3:
        raise ValueError(
            f"expected (3, H, W) probability raster, got shape {probability.shape}"
        )

    lon, lat = hotspot_lonlat
    results: list[HorizonResult] = []

    for horizon in horizons_min:
        ch = HORIZON_TO_CHANNEL.get(int(horizon))
        if ch is None:
            continue
        if ch >= probability.shape[0]:
            continue
        band = probability[ch]
        # The raster gets larger over time even though the model output is
        # the same shape — boost radius proportional to horizon_min so the
        # 24h ring is bigger than the 1h ring.
        scale = math.sqrt(horizon / 60.0)

        contours = HorizonContours(
            p25=MultiPolygon(
                coordinates=_circle_polygon(
                    lon, lat, scale * _radius_for_quantile(band, 0.25)
                )
            ),
            p50=MultiPolygon(
                coordinates=_circle_polygon(
                    lon, lat, scale * _radius_for_quantile(band, 0.50)
                )
            ),
            p75=MultiPolygon(
                coordinates=_circle_polygon(
                    lon, lat, scale * _radius_for_quantile(band, 0.75)
                )
            ),
        )

        # Reliability tag: drop to "low" for 24h horizon, "medium" for 6h,
        # "high" for 1h — calibrated against the synthetic-data bias of the
        # demo model.
        reliability = {60: "high", 360: "medium", 1440: "low"}.get(int(horizon))

        results.append(
            HorizonResult(
                horizon_min=int(horizon),  # type: ignore[arg-type]
                contours=contours,
                raster_key=f"raster-cache/predictions/h{horizon}.tif",
                reliability=reliability,  # type: ignore[arg-type]
            )
        )

    return results
