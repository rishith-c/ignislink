"""Resource ranker — picks fire stations to dispatch.

Ports the logic that lives in ``packages/contracts/src/dispatch.ts``
(``rankResources``) so the Python backend produces an identical ordering
without depending on the TS package at runtime.

Ranking rule (hackathon default):
    score = eta_seconds + 0.05 * distance_meters - 600 * agency_bonus

`agency_bonus` reflects mutual-aid affinity (e.g. CAL FIRE picks up CAL
FIRE incidents preferentially). Lower score is better.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from sentry_max_api.contracts import Point, StationCandidate


# Fixture stations for the demo — covering the broader Bay Area / California
# coast so a click anywhere in the region returns useful candidates. The
# coordinates are approximations from public OSM data; they're intentionally
# not exact ArcGIS REST station IDs.
_STATIONS: tuple[StationCandidate, ...] = (
    StationCandidate(
        station_id="cf-1001",
        name="CAL FIRE Morgan Hill",
        agency="CAL FIRE",
        location=Point(coordinates=[-121.6555, 37.1305]),
        eta_seconds=540,
        distance_meters=8200,
    ),
    StationCandidate(
        station_id="cf-1002",
        name="CAL FIRE San Mateo",
        agency="CAL FIRE",
        location=Point(coordinates=[-122.3275, 37.5630]),
        eta_seconds=720,
        distance_meters=12500,
    ),
    StationCandidate(
        station_id="cf-1003",
        name="CAL FIRE Sonoma Valley",
        agency="CAL FIRE",
        location=Point(coordinates=[-122.4730, 38.2920]),
        eta_seconds=900,
        distance_meters=15800,
    ),
    StationCandidate(
        station_id="sf-fd-15",
        name="SF Fire Station 15",
        agency="SF Fire Department",
        location=Point(coordinates=[-122.4194, 37.7749]),
        eta_seconds=480,
        distance_meters=7100,
    ),
    StationCandidate(
        station_id="oak-fd-3",
        name="Oakland Fire Station 3",
        agency="Oakland Fire Department",
        location=Point(coordinates=[-122.2711, 37.8044]),
        eta_seconds=620,
        distance_meters=9300,
    ),
    StationCandidate(
        station_id="usfs-mh-1",
        name="USFS Mendocino Helibase",
        agency="USFS",
        location=Point(coordinates=[-123.1170, 39.3076]),
        eta_seconds=1200,
        distance_meters=22400,
    ),
    StationCandidate(
        station_id="lacofd-149",
        name="LA County Fire Station 149",
        agency="LA County Fire",
        location=Point(coordinates=[-118.2437, 34.0522]),
        eta_seconds=560,
        distance_meters=8400,
    ),
)


_AGENCY_BONUS: dict[str, float] = {
    "CAL FIRE": 1.0,
    "USFS": 0.7,
    "LA County Fire": 0.6,
    "SF Fire Department": 0.5,
    "Oakland Fire Department": 0.4,
}


@dataclass(frozen=True)
class _Scored:
    score: float
    candidate: StationCandidate
    distance_meters: int


def _haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1 = a
    lon2, lat2 = b
    r = 6371000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    h = (
        math.sin(dp / 2) ** 2
        + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    )
    return 2 * r * math.asin(math.sqrt(h))


def _adjusted_eta_seconds(distance_m: float) -> int:
    # Driving model — assume 11 m/s average through suburban + arterial.
    return int(distance_m / 11.0)


def rank_resources(
    hotspot: Point, *, top_n: int = 5
) -> list[StationCandidate]:
    """Return the top-N stations sorted by composite score (best first)."""

    hotspot_xy = (hotspot.coordinates[0], hotspot.coordinates[1])
    scored: list[_Scored] = []

    for station in _STATIONS:
        st_xy = (station.location.coordinates[0], station.location.coordinates[1])
        distance_m = _haversine_m(hotspot_xy, st_xy)
        eta_s = _adjusted_eta_seconds(distance_m)

        score = (
            eta_s
            + 0.05 * distance_m
            - 600.0 * _AGENCY_BONUS.get(station.agency, 0.0)
        )

        # Refresh the candidate with the freshly computed eta/distance so
        # the response matches the actual hotspot, not the fixture's
        # baked-in numbers.
        refreshed = station.model_copy(
            update={
                "eta_seconds": eta_s,
                "distance_meters": int(distance_m),
            }
        )
        scored.append(
            _Scored(score=score, candidate=refreshed, distance_meters=int(distance_m))
        )

    scored.sort(key=lambda s: s.score)
    return [s.candidate for s in scored[:top_n]]


def staging_area(hotspot: Point, wind_u: float = 0.0, wind_v: float = 0.0) -> Point:
    """Compute an upwind staging point ~2 km from the hotspot.

    If wind is unknown (zeros), default to a point 2 km west of the
    hotspot — matches the §4.1 mock used in the dispatcher console.
    """

    lon, lat = hotspot.coordinates[0], hotspot.coordinates[1]
    wind_mag = math.hypot(wind_u, wind_v)
    if wind_mag < 0.1:
        u_unit, v_unit = -1.0, 0.0
    else:
        # Staging is upwind: invert the wind vector.
        u_unit = -wind_u / wind_mag
        v_unit = -wind_v / wind_mag

    distance_m = 2000.0
    lat_rad = math.radians(lat)
    m_per_deg_lat = 111_320.0
    m_per_deg_lon = max(1.0, 111_320.0 * math.cos(lat_rad))
    new_lon = lon + (u_unit * distance_m) / m_per_deg_lon
    new_lat = lat + (v_unit * distance_m) / m_per_deg_lat
    return Point(coordinates=[new_lon, new_lat])
