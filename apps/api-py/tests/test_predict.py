"""End-to-end test for the spread predictor.

Exercises the real ONNX session and the post-processing pipeline. This is
the proof-of-life test for the hackathon backend — if it passes the model
forward-passes and the API layer returns the contracted shape.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from sentry_max_api.main import create_app
from sentry_max_api.onnx_loader import FireSpreadOnnx, synthesize_input
from sentry_max_api.routes.predict import derive_input_hash
from sentry_max_api.settings import get_settings
from sentry_max_api.contracts import (
    PredictSpreadRequest,
    Point,
    WindSummary,
)


_REPO_ROOT = Path(__file__).resolve().parents[3]
_ONNX_PATH = _REPO_ROOT / "ml" / "models" / "fire-spread-prod-candidate-bounded.onnx"


@pytest.fixture
def isolated_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.delenv("KAFKA_BOOTSTRAP", raising=False)
    monkeypatch.delenv("REQUIRE_DEPENDENCIES", raising=False)
    monkeypatch.setenv("ONNX_MODEL_PATH", str(_ONNX_PATH))
    get_settings.cache_clear()


def _sample_request_payload() -> dict[str, object]:
    return {
        "schema_version": 1,
        "detection_id": str(uuid4()),
        "hotspot": {"type": "Point", "coordinates": [-122.4194, 37.7749]},
        "context_raster_key": "raster-cache/contexts/abc123.tif",
        "wind_summary": {
            "u_ms": 4.0,
            "v_ms": 2.0,
            "gust_ms": 9.5,
            "sample_at": "2026-05-01T12:00:00+00:00",
        },
        "horizons_min": [60, 360, 1440],
    }


def test_input_hash_is_deterministic() -> None:
    payload = _sample_request_payload()
    req = PredictSpreadRequest.model_validate(payload)
    h1 = derive_input_hash(req, "v1.0")
    h2 = derive_input_hash(req, "v1.0")
    assert h1 == h2
    assert len(h1) == 64
    assert all(c in "0123456789abcdef" for c in h1)


def test_input_hash_changes_with_model_version() -> None:
    payload = _sample_request_payload()
    req = PredictSpreadRequest.model_validate(payload)
    assert derive_input_hash(req, "v1.0") != derive_input_hash(req, "v2.0")


@pytest.mark.skipif(not _ONNX_PATH.exists(), reason="ONNX model artifact not present")
def test_onnx_forward_pass_shape() -> None:
    session = FireSpreadOnnx.load(_ONNX_PATH)
    x = synthesize_input(grid_size=64)
    import asyncio

    out = asyncio.run(session.infer(x))
    # Expected (B=1, 3, H, W) sigmoid probability raster.
    assert out.ndim == 4
    assert out.shape[0] == 1
    assert out.shape[1] == 3
    assert (out >= 0).all() and (out <= 1).all()


@pytest.mark.skipif(not _ONNX_PATH.exists(), reason="ONNX model artifact not present")
def test_predict_spread_returns_contract_shape(isolated_env: None) -> None:
    with TestClient(create_app()) as client:
        response = client.post("/predict/spread", json=_sample_request_payload())
    assert response.status_code == 200, response.text
    body = response.json()

    # Required top-level fields
    for key in (
        "schema_version",
        "model_version",
        "generated_at",
        "horizons",
        "inference_ms",
        "cache_hit",
        "input_hash",
        "context_source",
    ):
        assert key in body, f"missing field: {key}"

    assert body["schema_version"] == 1
    assert body["cache_hit"] is False
    assert len(body["input_hash"]) == 64
    assert body["context_source"] in {"hrrr", "open-meteo"}

    horizons = body["horizons"]
    assert len(horizons) == 3
    horizon_set = {h["horizon_min"] for h in horizons}
    assert horizon_set == {60, 360, 1440}

    # Each horizon has the contour MultiPolygon triple.
    for h in horizons:
        assert "contours" in h
        for q in ("p25", "p50", "p75"):
            assert h["contours"][q]["type"] == "MultiPolygon"
            assert len(h["contours"][q]["coordinates"]) >= 1


@pytest.mark.skipif(not _ONNX_PATH.exists(), reason="ONNX model artifact not present")
def test_predict_spread_subset_of_horizons(isolated_env: None) -> None:
    payload = _sample_request_payload()
    payload["horizons_min"] = [60, 360]
    with TestClient(create_app()) as client:
        response = client.post("/predict/spread", json=payload)
    assert response.status_code == 200, response.text
    horizons = response.json()["horizons"]
    assert {h["horizon_min"] for h in horizons} == {60, 360}
