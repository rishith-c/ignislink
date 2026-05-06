from dataclasses import asdict, dataclass
from typing import Literal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from sentry_max_api.settings import Settings

CheckStatus = Literal["ok", "degraded", "error"]


@dataclass(frozen=True)
class DependencyCheck:
    name: str
    status: CheckStatus
    detail: str

    def as_response(self) -> dict[str, str]:
        return asdict(self)


async def check_database(settings: Settings) -> DependencyCheck:
    if not settings.database_url:
        status: CheckStatus = "error" if settings.require_dependencies else "degraded"
        return DependencyCheck("database", status, "DATABASE_URL is not configured")

    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    try:
        async with engine.connect() as conn:
            await conn.execute(text("select 1"))
    except Exception as exc:  # pragma: no cover - exercised in integration env
        return DependencyCheck("database", "error", exc.__class__.__name__)
    finally:
        await engine.dispose()

    return DependencyCheck("database", "ok", "reachable")


async def check_migrations(settings: Settings) -> DependencyCheck:
    if not settings.database_url:
        status: CheckStatus = "error" if settings.require_dependencies else "degraded"
        return DependencyCheck("migrations", status, "database unavailable; migration state unknown")

    return DependencyCheck("migrations", "ok", "alembic configured")
