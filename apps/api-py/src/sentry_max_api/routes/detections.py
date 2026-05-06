"""GET /detections, POST /detections — hotspot ingest + bbox query.

Backed by the ``detections`` hypertable defined in ``infra/sql/0001_init.sql``.

The bbox query format is ``minLon,minLat,maxLon,maxLat`` (RFC 7946 order).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import cast
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import text

from sentry_max_api.contracts import (
    Detection,
    DetectionLocality,
    DetectionProvenance,
    DetectionWrite,
    Point,
)


router = APIRouter()


def _parse_bbox(bbox: str) -> tuple[float, float, float, float]:
    parts = bbox.split(",")
    if len(parts) != 4:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="bbox must be 'minLon,minLat,maxLon,maxLat'",
        )
    try:
        nums = tuple(float(p) for p in parts)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="bbox values must be numeric",
        ) from exc
    return cast(tuple[float, float, float, float], nums)


class DetectionListResponse(BaseModel):
    items: list[Detection]
    total: int
    limit: int
    offset: int


@router.get("", response_model=DetectionListResponse)
async def list_detections(
    request: Request,
    bbox: str = Query(default="-180,-90,180,90", description="minLon,minLat,maxLon,maxLat"),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> DetectionListResponse:
    min_lon, min_lat, max_lon, max_lat = _parse_bbox(bbox)
    sessionmaker = getattr(request.app.state, "session_factory", None)
    if sessionmaker is None:
        # No DB configured (e.g., test app) — return an empty page.
        return DetectionListResponse(items=[], total=0, limit=limit, offset=offset)

    sql = text(
        """
        SELECT id::text                AS id,
               ST_X(hotspot)           AS lon,
               ST_Y(hotspot)           AS lat,
               observed_at,
               created_at              AS ingested_at,
               sensor,
               confidence,
               frp_mw,
               locality,
               provenance
          FROM detections
         WHERE hotspot && ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326)
           AND observed_at >= now() - interval '7 days'
         ORDER BY observed_at DESC
         LIMIT :limit OFFSET :offset
        """
    )
    count_sql = text(
        """
        SELECT count(*) AS n
          FROM detections
         WHERE hotspot && ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326)
           AND observed_at >= now() - interval '7 days'
        """
    )
    params = {
        "min_lon": min_lon,
        "min_lat": min_lat,
        "max_lon": max_lon,
        "max_lat": max_lat,
        "limit": limit,
        "offset": offset,
    }

    async with sessionmaker() as session:
        rows = (await session.execute(sql, params)).mappings().all()
        total_row = (await session.execute(count_sql, params)).first()
        total = int(total_row[0]) if total_row else 0

    items: list[Detection] = []
    for row in rows:
        loc_raw = row["locality"] if isinstance(row["locality"], dict) else json.loads(
            row["locality"] or "{}"
        )
        prov_raw = (
            row["provenance"]
            if isinstance(row["provenance"], dict)
            else json.loads(row["provenance"] or "{}")
        )
        try:
            locality = DetectionLocality.model_validate(loc_raw) if loc_raw else None
        except Exception:
            locality = None
        try:
            provenance = DetectionProvenance.model_validate(prov_raw)
        except Exception:
            provenance = DetectionProvenance(
                feed="standard", source_url_hash="unknown0", poll_batch_id=uuid4()
            )

        items.append(
            Detection(
                schema_version=1,
                detection_id=row["id"],
                hotspot=Point(coordinates=[float(row["lon"]), float(row["lat"])]),
                observed_at=row["observed_at"],
                ingested_at=row["ingested_at"],
                sensor=row["sensor"],
                confidence=row["confidence"],
                bright_ti4_kelvin=None,
                fire_radiative_power_mw=row["frp_mw"],
                locality=locality,
                provenance=provenance,
            )
        )

    return DetectionListResponse(items=items, total=total, limit=limit, offset=offset)


@router.post("", status_code=status.HTTP_201_CREATED, response_model=Detection)
async def create_detection(
    body: DetectionWrite,
    request: Request,
) -> Detection:
    sessionmaker = getattr(request.app.state, "session_factory", None)
    if sessionmaker is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="database is not configured",
        )

    detection_id = uuid4()
    ingested_at = datetime.now(timezone.utc)
    locality = body.locality.model_dump() if body.locality else None
    provenance = (
        body.provenance.model_dump(mode="json")
        if body.provenance
        else {
            "feed": "standard",
            "source_url_hash": "hackathon",
            "poll_batch_id": str(uuid4()),
        }
    )

    sql = text(
        """
        INSERT INTO detections (
            id, hotspot, observed_at, sensor, confidence, frp_mw, locality, provenance
        ) VALUES (
            :id,
            ST_SetSRID(ST_MakePoint(:lon, :lat), 4326),
            :observed_at,
            :sensor,
            :confidence,
            :frp_mw,
            CAST(:locality AS jsonb),
            CAST(:provenance AS jsonb)
        )
        """
    )

    async with sessionmaker() as session:
        await session.execute(
            sql,
            {
                "id": str(detection_id),
                "lon": body.hotspot.coordinates[0],
                "lat": body.hotspot.coordinates[1],
                "observed_at": body.observed_at,
                "sensor": body.sensor,
                "confidence": body.confidence,
                "frp_mw": body.fire_radiative_power_mw,
                "locality": json.dumps(locality) if locality else None,
                "provenance": json.dumps(provenance),
            },
        )
        await session.commit()

    detection = Detection(
        schema_version=1,
        detection_id=detection_id,
        hotspot=body.hotspot,
        observed_at=body.observed_at,
        ingested_at=ingested_at,
        sensor=body.sensor,
        confidence=body.confidence,
        bright_ti4_kelvin=body.bright_ti4_kelvin,
        fire_radiative_power_mw=body.fire_radiative_power_mw,
        locality=body.locality,
        provenance=body.provenance
        or DetectionProvenance(
            feed="standard", source_url_hash="hackathon", poll_batch_id=uuid4()
        ),
    )

    publisher = getattr(request.app.state, "kafka_publisher", None)
    if publisher is not None:
        await publisher.publish(
            "detections.received",
            json.loads(detection.model_dump_json()),
        )
    return detection
