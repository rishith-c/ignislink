from fastapi.testclient import TestClient

from sentry_max_api.main import create_app
from sentry_max_api.settings import get_settings


_EXPECTED_COMPONENTS = {"database", "redis", "migrations", "kafka", "onnx"}


def test_ready_reports_dependency_state_without_external_services(monkeypatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.delenv("KAFKA_BOOTSTRAP", raising=False)
    monkeypatch.delenv("REQUIRE_DEPENDENCIES", raising=False)
    get_settings.cache_clear()

    response = TestClient(create_app()).get("/ready")

    assert response.status_code == 200
    payload = response.json()
    # No deps configured, REQUIRE_DEPENDENCIES off → degraded (or ok if onnx
    # session loaded successfully from the bundled artifact path).
    assert payload["status"] in {"degraded", "ok"}
    assert {component["name"] for component in payload["components"]} == _EXPECTED_COMPONENTS


def test_ready_can_fail_closed_when_dependencies_are_required(monkeypatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.delenv("KAFKA_BOOTSTRAP", raising=False)
    monkeypatch.setenv("REQUIRE_DEPENDENCIES", "true")
    get_settings.cache_clear()

    response = TestClient(create_app()).get("/ready")

    assert response.status_code == 200
    assert response.json()["status"] == "error"
