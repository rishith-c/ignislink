"""Pure-Python geo helpers shared by source pollers and the Spark job.

Kept dependency-free (no shapely/geopandas) so PySpark workers can use them
directly without an extra wheel install. Functions are pure and immutable.
"""

from __future__ import annotations

import math

EARTH_RADIUS_M = 6_371_000.0
_GEOHASH_BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz"


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres between two WGS-84 points."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)

    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return EARTH_RADIUS_M * c


def geohash_encode(lat: float, lon: float, precision: int = 5) -> str:
    """Standard geohash base-32 encoding. Precision-5 ≈ 4.9 km × 4.9 km cells."""
    if precision < 1:
        raise ValueError("geohash precision must be >= 1")

    lat_lo, lat_hi = -90.0, 90.0
    lon_lo, lon_hi = -180.0, 180.0

    bits: list[int] = []
    even = True  # alternate longitude (even) / latitude (odd) bits
    while len(bits) < precision * 5:
        if even:
            mid = (lon_lo + lon_hi) / 2
            if lon >= mid:
                bits.append(1)
                lon_lo = mid
            else:
                bits.append(0)
                lon_hi = mid
        else:
            mid = (lat_lo + lat_hi) / 2
            if lat >= mid:
                bits.append(1)
                lat_lo = mid
            else:
                bits.append(0)
                lat_hi = mid
        even = not even

    out_chars: list[str] = []
    for i in range(0, len(bits), 5):
        idx = (
            (bits[i] << 4)
            | (bits[i + 1] << 3)
            | (bits[i + 2] << 2)
            | (bits[i + 3] << 1)
            | bits[i + 4]
        )
        out_chars.append(_GEOHASH_BASE32[idx])
    return "".join(out_chars)
