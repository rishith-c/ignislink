"""Smoke tests for routes that work without a live database.

These verify the FastAPI wiring + contracts for routes the demo can serve
even when Postgres is unavailable. The route layer is designed to degrade
gracefully (empty list / 503 / synthetic fallback) — that contract is
exercised here.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from sentry_max_api.main import create_app
from sentry_max_api.settings import get_settings


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.delenv("KAFKA_BOOTSTRAP", raising=False)
    monkeypatch.delenv("REQUIRE_DEPENDENCIES", raising=False)
    get_settings.cache_clear()
    with TestClient(create_app()) as c:
        yield c


def test_detections_list_returns_empty_without_db(client: TestClient) -> None:
    response = client.get("/detections")
    assert response.status_code == 200
    body = response.json()
    assert body == {"items": [], "total": 0, "limit": 100, "offset": 0}


def test_earthquakes_list_returns_empty_without_db(client: TestClient) -> None:
    response = client.get("/earthquakes")
    assert response.status_code == 200
    body = response.json()
    assert body["items"] == []
    assert body["horizon_hours"] == 24


def test_floods_gauges_returns_empty_without_db(client: TestClient) -> None:
    response = client.get("/floods/gauges?state=ca")
    assert response.status_code == 200
    body = response.json()
    assert body["items"] == []
    assert body["state"] == "ca"
    assert body["horizons_hours"] == [6, 24, 48]


def test_dispatch_falls_back_to_synthetic_without_db(client: TestClient) -> None:
    response = client.post(
        "/dispatch/00000000-0000-0000-0000-000000000001",
        json={"dispatched_by_user_id": "test-user"},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["schema_version"] == 1
    assert body["dispatched_by_user_id"] == "test-user"
    assert len(body["station_candidates"]) >= 1
    assert len(body["predicted_spread"]) == 3


def test_invalid_bbox_is_rejected(client: TestClient) -> None:
    response = client.get("/detections?bbox=not-a-bbox")
    assert response.status_code == 400


def test_openapi_includes_all_routes(client: TestClient) -> None:
    response = client.get("/openapi.json")
    assert response.status_code == 200
    paths = response.json()["paths"]
    for path in (
        "/health",
        "/ready",
        "/detections",
        "/predict/spread",
        "/dispatch/{detection_id}",
        "/earthquakes",
        "/floods/gauges",
    ):
        assert path in paths, f"missing {path} in OpenAPI"
