from fastapi.testclient import TestClient

from ignislink_api.main import create_app


def test_health_reports_liveness() -> None:
    client = TestClient(create_app())

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "ignislink-api-py"}
