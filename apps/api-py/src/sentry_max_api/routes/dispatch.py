"""POST /dispatch/{detection_id} — pick stations and emit a dispatch.

Hackathon happy-path:
    1. Look up the detection (or accept a synthetic detection if it isn't
       in the DB yet — keeps the demo unblocked).
    2. Run the resource ranker over fixture stations.
    3. Persist the chosen dispatch row.
    4. Emit ``dispatches.sent`` on Kafka.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import cast
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import text

from sentry_max_api.contracts import (
    DispatchPayload,
    DispatchRequest,
    MultiPolygon,
    Point,
    SuggestedSpreadHorizon,
)
from sentry_max_api.dispatch_logic import rank_resources, staging_area
from sentry_max_api.spread_post import _circle_polygon


router = APIRouter()


async def _load_hotspot(
    sessionmaker: object | None, detection_id: UUID
) -> Point | None:
    if sessionmaker is None:
        return None
    sql = text(
        "SELECT ST_X(hotspot) AS lon, ST_Y(hotspot) AS lat "
        "FROM detections WHERE id = :id LIMIT 1"
    )
    async with sessionmaker() as session:  # type: ignore[misc]
        row = (await session.execute(sql, {"id": str(detection_id)})).first()
    if not row:
        return None
    return Point(coordinates=[float(row[0]), float(row[1])])


def _stub_spread(hotspot: Point) -> list[SuggestedSpreadHorizon]:
    """Build a synthetic predicted-spread payload when ML hasn't run yet."""

    lon, lat = hotspot.coordinates[0], hotspot.coordinates[1]
    horizons: list[SuggestedSpreadHorizon] = []
    for horizon, radius in ((60, 250.0), (360, 700.0), (1440, 1500.0)):
        polygon_coords = _circle_polygon(lon, lat, radius)
        horizons.append(
            SuggestedSpreadHorizon(
                horizon_min=horizon,  # type: ignore[arg-type]
                contour_p50=MultiPolygon(coordinates=polygon_coords),
            )
        )
    return horizons


@router.post(
    "/{detection_id}",
    status_code=status.HTTP_201_CREATED,
    response_model=DispatchPayload,
)
async def create_dispatch(
    detection_id: UUID,
    body: DispatchRequest,
    request: Request,
) -> DispatchPayload:
    sessionmaker = getattr(request.app.state, "session_factory", None)
    publisher = getattr(request.app.state, "kafka_publisher", None)

    hotspot = await _load_hotspot(sessionmaker, detection_id)
    if hotspot is None:
        # Fallback: assume a CA-coast demo hotspot so the route stays usable
        # without a populated DB.
        hotspot = Point(coordinates=[-122.42, 37.77])

    candidates = rank_resources(hotspot, top_n=5)
    if not candidates:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="no station candidates available",
        )

    chosen = candidates[0]
    dispatch_id = uuid4()
    incident_id = body.incident_id or uuid4()
    dispatched_at = datetime.now(timezone.utc)

    payload = DispatchPayload(
        schema_version=1,
        dispatch_id=dispatch_id,
        incident_id=incident_id,
        detection_id=detection_id,
        hotspot=hotspot,
        verification_status="EMERGING",
        firms_confidence="nominal",
        predicted_spread=_stub_spread(hotspot),
        staging_area=staging_area(hotspot),
        station_candidates=candidates,
        dispatched_by_user_id=body.dispatched_by_user_id,
        dispatched_at=dispatched_at,
        model_version=request.app.state.model_version,
        context_source="hrrr",
    )

    if sessionmaker is not None:
        async with sessionmaker() as session:  # type: ignore[misc]
            await session.execute(
                text(
                    """
                    INSERT INTO dispatches (
                        id, detection_id, dispatched_at, station_id,
                        channel, delivery_state, payload
                    )
                    VALUES (
                        :id, :detection_id, :dispatched_at, :station_id,
                        :channel, :delivery_state, CAST(:payload AS jsonb)
                    )
                    """
                ),
                {
                    "id": str(dispatch_id),
                    "detection_id": str(detection_id),
                    "dispatched_at": dispatched_at,
                    "station_id": chosen.station_id,
                    "channel": "internal-cad",
                    "delivery_state": "queued",
                    "payload": payload.model_dump_json(),
                },
            )
            await session.commit()

    if publisher is not None:
        await publisher.publish(
            "dispatches.sent",
            json.loads(payload.model_dump_json()),
        )
    return payload
