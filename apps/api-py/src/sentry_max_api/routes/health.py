"""Liveness + readiness endpoints.

``/health`` returns immediately with the service identity. ``/ready``
exercises every external dependency and returns ``ok`` only if all are
reachable. ``error`` short-circuits Kubernetes liveness rotation when
``REQUIRE_DEPENDENCIES=true``.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from sentry_max_api.db import (
    DependencyCheck,
    check_database,
    check_migrations,
)
from sentry_max_api.redis import check_redis
from sentry_max_api.settings import Settings, get_settings


router = APIRouter(tags=["health"])


class ComponentStatus(BaseModel):
    name: str
    status: Literal["ok", "degraded", "error"]
    detail: str


class ReadyResponse(BaseModel):
    status: Literal["ok", "degraded", "error"]
    components: list[ComponentStatus]


def _check_kafka(request: Request, settings: Settings) -> DependencyCheck:
    publisher = getattr(request.app.state, "kafka_publisher", None)
    if not settings.kafka_bootstrap:
        status: Literal["ok", "degraded", "error"] = (
            "error" if settings.require_dependencies else "degraded"
        )
        return DependencyCheck("kafka", status, "KAFKA_BOOTSTRAP is not configured")
    if publisher is None:
        return DependencyCheck("kafka", "degraded", "publisher not initialized")
    if publisher.connected:
        return DependencyCheck("kafka", "ok", f"connected to {settings.kafka_bootstrap}")
    return DependencyCheck("kafka", "degraded", "publisher running in fail-soft mode")


def _check_onnx(request: Request, settings: Settings) -> DependencyCheck:
    session = getattr(request.app.state, "onnx_session", None)
    if session is None:
        status: Literal["ok", "degraded", "error"] = (
            "error" if settings.require_dependencies else "degraded"
        )
        return DependencyCheck("onnx", status, "model session not loaded")
    return DependencyCheck("onnx", "ok", "loaded")


@router.get("/health")
async def health(settings: Settings = Depends(get_settings)) -> dict[str, str]:
    return {"status": "ok", "service": settings.service_name}


@router.get("/ready", response_model=ReadyResponse)
async def ready(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> ReadyResponse:
    checks = [
        await check_database(settings),
        await check_redis(settings),
        await check_migrations(settings),
        _check_kafka(request, settings),
        _check_onnx(request, settings),
    ]
    if any(check.status == "error" for check in checks):
        rollup: Literal["ok", "degraded", "error"] = "error"
    elif any(check.status == "degraded" for check in checks):
        rollup = "degraded"
    else:
        rollup = "ok"

    return ReadyResponse(
        status=rollup,
        components=[
            ComponentStatus(name=check.name, status=check.status, detail=check.detail)
            for check in checks
        ],
    )
