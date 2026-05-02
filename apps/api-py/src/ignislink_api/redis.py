from typing import Awaitable, cast

from redis.asyncio import Redis

from ignislink_api.db import DependencyCheck, CheckStatus
from ignislink_api.settings import Settings


async def check_redis(settings: Settings) -> DependencyCheck:
    if not settings.redis_url:
        status: CheckStatus = "error" if settings.require_dependencies else "degraded"
        return DependencyCheck("redis", status, "REDIS_URL is not configured")

    client = Redis.from_url(settings.redis_url)
    try:
        await cast(Awaitable[bool], client.ping())
    except Exception as exc:  # pragma: no cover - exercised in integration env
        return DependencyCheck("redis", "error", exc.__class__.__name__)
    finally:
        await client.aclose()

    return DependencyCheck("redis", "ok", "reachable")
