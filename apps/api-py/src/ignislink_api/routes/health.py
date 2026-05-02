from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ignislink_api.db import check_database, check_migrations
from ignislink_api.redis import check_redis
from ignislink_api.settings import Settings, get_settings

router = APIRouter(tags=["health"])


class ComponentStatus(BaseModel):
    name: str
    status: Literal["ok", "degraded", "error"]
    detail: str


class ReadyResponse(BaseModel):
    status: Literal["ok", "degraded", "error"]
    components: list[ComponentStatus]


@router.get("/health")
async def health(settings: Settings = Depends(get_settings)) -> dict[str, str]:
    return {"status": "ok", "service": settings.service_name}


@router.get("/ready", response_model=ReadyResponse)
async def ready(settings: Settings = Depends(get_settings)) -> ReadyResponse:
    checks = [
        await check_database(settings),
        await check_redis(settings),
        await check_migrations(settings),
    ]
    if any(check.status == "error" for check in checks):
        status: Literal["ok", "degraded", "error"] = "error"
    elif any(check.status == "degraded" for check in checks):
        status = "degraded"
    else:
        status = "ok"

    return ReadyResponse(
        status=status,
        components=[
            ComponentStatus(name=check.name, status=check.status, detail=check.detail)
            for check in checks
        ],
    )
