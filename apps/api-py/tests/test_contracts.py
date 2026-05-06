"""Round-trip tests for the pydantic mirrors of ``packages/contracts``.

These guard against drift between the zod schemas and the python models —
if a TS field is added/renamed, this test should fail loudly. We test the
shapes that matter most for the hackathon backend: PredictSpread{Request,
Response}, DispatchPayload, Detection.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sentry_max_api.contracts import (
    Detection,
    DetectionLocality,
    DetectionProvenance,
    DispatchPayload,
    HorizonContours,
    HorizonResult,
    MultiPolygon,
    Point,
    PredictSpreadRequest,
    PredictSpreadResponse,
    StationCandidate,
    SuggestedSpreadHorizon,
    WindSummary,
)


def _ring(lon: float, lat: float, r: float = 0.001) -> list[list[float]]:
    return [
        [lon - r, lat - r],
        [lon + r, lat - r],
        [lon + r, lat + r],
        [lon - r, lat + r],
        [lon - r, lat - r],
    ]


def test_detection_round_trip() -> None:
    d = Detection(
        schema_version=1,
        detection_id=uuid4(),
        hotspot=Point(coordinates=[-122.4, 37.7]),
        observed_at=datetime(2026, 5, 1, tzinfo=timezone.utc),
        ingested_at=datetime(2026, 5, 1, 0, 1, tzinfo=timezone.utc),
        sensor="viirs_snpp",
        confidence="nominal",
        bright_ti4_kelvin=320.5,
        fire_radiative_power_mw=15.0,
        locality=DetectionLocality(
            neighborhood="Mission",
            county="San Francisco",
            state_code="CA",
            country_code="US",
        ),
        provenance=DetectionProvenance(
            feed="standard", source_url_hash="ab12cd34", poll_batch_id=uuid4()
        ),
    )
    payload = d.model_dump_json()
    parsed = Detection.model_validate_json(payload)
    assert parsed.confidence == "nominal"
    assert parsed.locality is not None
    assert parsed.locality.country_code == "US"


def test_predict_spread_request_defaults_horizons() -> None:
    req = PredictSpreadRequest(
        schema_version=1,
        detection_id=uuid4(),
        hotspot=Point(coordinates=[-122.4, 37.7]),
        context_raster_key="raster-cache/abc.tif",
        wind_summary=WindSummary(
            u_ms=1.0,
            v_ms=0.5,
            gust_ms=4.0,
            sample_at=datetime(2026, 5, 1, tzinfo=timezone.utc),
        ),
    )
    assert req.horizons_min == [60, 360, 1440]


def test_predict_spread_response_validates_input_hash() -> None:
    poly = MultiPolygon(coordinates=[[_ring(-122.0, 37.0)]])
    contours = HorizonContours(p25=poly, p50=poly, p75=poly)
    horizon = HorizonResult(
        horizon_min=60,
        contours=contours,
        raster_key="raster-cache/h60.tif",
        reliability="high",
    )
    response = PredictSpreadResponse(
        schema_version=1,
        model_version="fire-spread-v0",
        generated_at=datetime(2026, 5, 1, tzinfo=timezone.utc),
        horizons=[horizon],
        inference_ms=125,
        cache_hit=False,
        input_hash="0" * 64,
        context_source="hrrr",
    )
    assert response.cache_hit is False


def test_dispatch_payload_strict_extra_keys_rejected() -> None:
    poly = MultiPolygon(coordinates=[[_ring(-122.0, 37.0)]])
    payload = DispatchPayload(
        schema_version=1,
        dispatch_id=uuid4(),
        incident_id=uuid4(),
        detection_id=uuid4(),
        hotspot=Point(coordinates=[-122.4, 37.7]),
        verification_status="EMERGING",
        firms_confidence="nominal",
        predicted_spread=[
            SuggestedSpreadHorizon(horizon_min=60, contour_p50=poly),
        ],
        staging_area=Point(coordinates=[-122.5, 37.7]),
        station_candidates=[
            StationCandidate(
                station_id="cf-1001",
                name="CAL FIRE Demo",
                agency="CAL FIRE",
                location=Point(coordinates=[-122.5, 37.7]),
                eta_seconds=300,
                distance_meters=4000,
            ),
        ],
        dispatched_by_user_id="hackathon-operator",
        dispatched_at=datetime(2026, 5, 1, tzinfo=timezone.utc),
        model_version="fire-spread-v0",
        context_source="hrrr",
    )
    js = payload.model_dump_json()
    assert "schema_version" in js
    assert payload.station_candidates[0].agency == "CAL FIRE"
