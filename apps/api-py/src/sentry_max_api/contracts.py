"""Pydantic v2 models mirroring ``packages/contracts/src/*.ts``.

These hand-written models are the canonical Python contracts for the
hackathon backend. They match the zod schemas field-for-field; a contract
test is in ``tests/test_contracts.py``.

Naming convention: schema names match the TypeScript exports verbatim
(``DetectionSchema`` → ``Detection``, etc.). Snake-case field names mirror
the wire format from the zod side (which is already snake_case).
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

# ─────────────────────────────────────────────────────────────────────────────
# geometry.ts — minimal RFC 7946 GeoJSON types
# ─────────────────────────────────────────────────────────────────────────────

# A position is [lon, lat]. We allow any numeric tuple; range checks are
# enforced at the model layer where it matters (Point.coordinates below).
Position = Annotated[list[float], Field(min_length=2, max_length=2)]


class Point(BaseModel):
    type: Literal["Point"] = "Point"
    coordinates: Position


class LineString(BaseModel):
    type: Literal["LineString"] = "LineString"
    coordinates: list[Position] = Field(min_length=2)


class Polygon(BaseModel):
    type: Literal["Polygon"] = "Polygon"
    coordinates: list[list[Position]] = Field(min_length=1)


class MultiPolygon(BaseModel):
    type: Literal["MultiPolygon"] = "MultiPolygon"
    coordinates: list[list[list[Position]]] = Field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────────
# detection.ts
# ─────────────────────────────────────────────────────────────────────────────

FirmsConfidence = Literal["low", "nominal", "high"]
FirmsSensor = Literal[
    "viirs_snpp", "viirs_noaa20", "viirs_noaa21", "modis_aqua", "modis_terra"
]


class DetectionLocality(BaseModel):
    neighborhood: str | None = None
    county: str | None = None
    state_code: str | None = Field(default=None, min_length=2, max_length=2)
    country_code: str = Field(min_length=2, max_length=2)


class DetectionProvenance(BaseModel):
    feed: Literal["urt", "standard", "archive"]
    source_url_hash: str = Field(min_length=8)
    poll_batch_id: UUID


class Detection(BaseModel):
    schema_version: Literal[1] = 1
    detection_id: UUID
    hotspot: Point
    observed_at: datetime
    ingested_at: datetime
    sensor: FirmsSensor
    confidence: FirmsConfidence
    bright_ti4_kelvin: float | None = Field(default=None, ge=200, le=800)
    fire_radiative_power_mw: float | None = Field(default=None, ge=0, le=20000)
    locality: DetectionLocality | None = None
    provenance: DetectionProvenance


# Lightweight write payload used by ``POST /detections`` so demo callers
# don't have to mint a UUID/ingested_at themselves.
class DetectionWrite(BaseModel):
    hotspot: Point
    observed_at: datetime
    sensor: FirmsSensor
    confidence: FirmsConfidence
    bright_ti4_kelvin: float | None = Field(default=None, ge=200, le=800)
    fire_radiative_power_mw: float | None = Field(default=None, ge=0, le=20000)
    locality: DetectionLocality | None = None
    provenance: DetectionProvenance | None = None


# ─────────────────────────────────────────────────────────────────────────────
# verification.ts
# ─────────────────────────────────────────────────────────────────────────────

VerificationStatus = Literal[
    "UNREPORTED",
    "EMERGING",
    "CREWS_ACTIVE",
    "KNOWN_PRESCRIBED",
    "LIKELY_INDUSTRIAL",
]


# ─────────────────────────────────────────────────────────────────────────────
# predict-spread.ts
# ─────────────────────────────────────────────────────────────────────────────

HorizonMin = Literal[60, 360, 1440]
PREDICT_SCHEMA_VERSION = 1


class WindSummary(BaseModel):
    u_ms: float
    v_ms: float
    gust_ms: float = Field(ge=0)
    sample_at: datetime


class PredictSpreadRequest(BaseModel):
    schema_version: Literal[1] = 1
    detection_id: UUID
    hotspot: Point
    context_raster_key: str = Field(min_length=1)
    wind_summary: WindSummary
    horizons_min: list[HorizonMin] = Field(
        default_factory=lambda: [60, 360, 1440],
        min_length=1,
        max_length=3,
    )


class HorizonContours(BaseModel):
    p25: MultiPolygon
    p50: MultiPolygon
    p75: MultiPolygon


class HorizonResult(BaseModel):
    horizon_min: HorizonMin
    contours: HorizonContours
    raster_key: str = Field(min_length=1)
    reliability: Literal["low", "medium", "high"] | None = None


SHA256_HEX = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]


class PredictSpreadResponse(BaseModel):
    schema_version: Literal[1] = 1
    model_version: str = Field(min_length=1)
    generated_at: datetime
    horizons: list[HorizonResult] = Field(min_length=1)
    inference_ms: int = Field(ge=0)
    cache_hit: bool
    input_hash: SHA256_HEX
    context_source: Literal["hrrr", "open-meteo"] = "hrrr"


# ─────────────────────────────────────────────────────────────────────────────
# dispatch.ts
# ─────────────────────────────────────────────────────────────────────────────


class StationCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    station_id: str = Field(min_length=1)
    name: str
    agency: str
    location: Point
    eta_seconds: int = Field(ge=0)
    distance_meters: int = Field(ge=0)


class SuggestedSpreadHorizon(BaseModel):
    model_config = ConfigDict(extra="forbid")

    horizon_min: HorizonMin
    contour_p50: MultiPolygon


class DispatchPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1] = 1
    dispatch_id: UUID
    incident_id: UUID
    detection_id: UUID
    hotspot: Point
    verification_status: VerificationStatus
    firms_confidence: FirmsConfidence
    predicted_spread: list[SuggestedSpreadHorizon] = Field(max_length=3)
    staging_area: Point
    station_candidates: list[StationCandidate] = Field(max_length=5)
    dispatched_by_user_id: str = Field(min_length=1)
    dispatched_at: datetime
    model_version: str = Field(min_length=1)
    context_source: Literal["hrrr", "open-meteo"]


# Request shape for the convenience ``POST /dispatch/{detection_id}`` route —
# tells the backend which user is invoking it and how to phrase the payload.
class DispatchRequest(BaseModel):
    dispatched_by_user_id: str = Field(min_length=1, default="hackathon-operator")
    incident_id: UUID | None = None  # auto-generate if omitted


# ─────────────────────────────────────────────────────────────────────────────
# incident-events.ts (internal-only — used for Kafka emissions)
# ─────────────────────────────────────────────────────────────────────────────


class IncidentInternalHorizon(BaseModel):
    horizon_min: HorizonMin
    p25: MultiPolygon
    p50: MultiPolygon
    p75: MultiPolygon


class IncidentInternalLocality(BaseModel):
    neighborhood: str | None = None
    county: str | None = None
    state_code: str | None = Field(default=None, min_length=2, max_length=2)


class IncidentInternalEvent(BaseModel):
    schema_version: Literal[1] = 1
    event: Literal[
        "incident.internal.created",
        "incident.internal.updated",
        "incident.internal.resolved",
    ]
    incident_id: UUID
    emitted_at: datetime
    hotspot: Point
    verification_status: VerificationStatus
    firms_confidence: FirmsConfidence
    predicted_horizons: list[IncidentInternalHorizon] = Field(max_length=3)
    locality: IncidentInternalLocality
    station_candidates: list[StationCandidate] = Field(max_length=5)
    partner_metadata: dict[str, Any] = Field(default_factory=dict)


__all__ = [
    "Position",
    "Point",
    "LineString",
    "Polygon",
    "MultiPolygon",
    "FirmsConfidence",
    "FirmsSensor",
    "DetectionLocality",
    "DetectionProvenance",
    "Detection",
    "DetectionWrite",
    "VerificationStatus",
    "HorizonMin",
    "WindSummary",
    "PredictSpreadRequest",
    "HorizonContours",
    "HorizonResult",
    "PredictSpreadResponse",
    "StationCandidate",
    "SuggestedSpreadHorizon",
    "DispatchPayload",
    "DispatchRequest",
    "IncidentInternalHorizon",
    "IncidentInternalLocality",
    "IncidentInternalEvent",
    "PREDICT_SCHEMA_VERSION",
]
