"""GET /earthquakes — bbox + time-window query with ETAS aftershock prior.

Reads from the ``earthquake_events`` hypertable and decorates each row
with an Omori-Utsu / Gutenberg-Richter aftershock probability so the
dispatcher console can rank rows by risk without a separate inference call.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import text

from sentry_max_api.hazard_math import aftershock_probability


router = APIRouter()


class EarthquakeEvent(BaseModel):
    id: str
    magnitude: float | None
    place: str | None
    occurred_at: datetime
    longitude: float | None
    latitude: float | None
    depth_km: float | None
    aftershock_probability_24h: float


class EarthquakeListResponse(BaseModel):
    items: list[EarthquakeEvent]
    bbox: tuple[float, float, float, float]
    since: datetime
    horizon_hours: int


def _parse_bbox(bbox: str) -> tuple[float, float, float, float]:
    parts = bbox.split(",")
    if len(parts) != 4:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="bbox must be 'minLon,minLat,maxLon,maxLat'",
        )
    try:
        return (float(parts[0]), float(parts[1]), float(parts[2]), float(parts[3]))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="bbox values must be numeric",
        ) from exc


@router.get("", response_model=EarthquakeListResponse)
async def list_earthquakes(
    request: Request,
    bbox: str = Query(default="-180,-90,180,90"),
    since: datetime | None = Query(default=None),
    horizon_hours: int = Query(default=24, ge=1, le=168),
    limit: int = Query(default=200, ge=1, le=1000),
) -> EarthquakeListResponse:
    if since is None:
        since = datetime.now(timezone.utc) - timedelta(days=7)
    else:
        if since.tzinfo is None:
            since = since.replace(tzinfo=timezone.utc)

    parsed_bbox = _parse_bbox(bbox)
    sessionmaker = getattr(request.app.state, "session_factory", None)
    if sessionmaker is None:
        return EarthquakeListResponse(
            items=[], bbox=parsed_bbox, since=since, horizon_hours=horizon_hours
        )

    sql = text(
        """
        SELECT id,
               mag,
               place,
               occurred_at,
               ST_X(location) AS lon,
               ST_Y(location) AS lat,
               depth_km
          FROM earthquake_events
         WHERE occurred_at >= :since
           AND (location IS NULL OR location && ST_MakeEnvelope(
                   :min_lon, :min_lat, :max_lon, :max_lat, 4326))
         ORDER BY occurred_at DESC
         LIMIT :limit
        """
    )
    params = {
        "since": since,
        "min_lon": parsed_bbox[0],
        "min_lat": parsed_bbox[1],
        "max_lon": parsed_bbox[2],
        "max_lat": parsed_bbox[3],
        "limit": limit,
    }
    async with sessionmaker() as session:  # type: ignore[misc]
        rows = (await session.execute(sql, params)).mappings().all()

    now = datetime.now(timezone.utc)
    items: list[EarthquakeEvent] = []
    for row in rows:
        mag = float(row["mag"]) if row["mag"] is not None else 0.0
        prob = (
            aftershock_probability(
                magnitude=mag,
                occurred_at=row["occurred_at"],
                target_magnitude=4.5,
                horizon_hours=horizon_hours,
                distance_km=0.0,
                now=now,
            )
            if mag > 0
            else 0.0
        )
        items.append(
            EarthquakeEvent(
                id=row["id"],
                magnitude=row["mag"],
                place=row["place"],
                occurred_at=row["occurred_at"],
                longitude=row["lon"],
                latitude=row["lat"],
                depth_km=row["depth_km"],
                aftershock_probability_24h=round(prob, 4),
            )
        )

    return EarthquakeListResponse(
        items=items, bbox=parsed_bbox, since=since, horizon_hours=horizon_hours
    )
