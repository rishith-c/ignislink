from fastapi.testclient import TestClient

from ignislink_api.main import create_app
from ignislink_api.settings import get_settings


def test_ready_reports_dependency_state_without_external_services(monkeypatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.delenv("REQUIRE_DEPENDENCIES", raising=False)
    get_settings.cache_clear()

    response = TestClient(create_app()).get("/ready")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "degraded"
    assert {component["name"] for component in payload["components"]} == {
        "database",
        "redis",
        "migrations",
    }


def test_ready_can_fail_closed_when_dependencies_are_required(monkeypatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.setenv("REQUIRE_DEPENDENCIES", "true")
    get_settings.cache_clear()

    response = TestClient(create_app()).get("/ready")

    assert response.status_code == 200
    assert response.json()["status"] == "error"
