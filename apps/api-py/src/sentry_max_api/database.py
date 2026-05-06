"""Async SQLAlchemy engine + session factory.

Distinct from ``sentry_max_api.db`` (which is the legacy
``check_database`` helper used by the readiness probe). This module owns
the live engine + sessionmaker that the route layer depends on.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from sentry_max_api.settings import Settings


def make_engine(settings: Settings) -> AsyncEngine:
    """Build an async engine from settings.

    Raises ``RuntimeError`` if ``DATABASE_URL`` is unset — the API cannot run
    without a database, but tests can still construct the app and only hit
    routes that do not depend on the engine.
    """

    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is not configured")
    return create_async_engine(
        settings.database_url,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=10,
        future=True,
    )


def make_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@asynccontextmanager
async def lifespan_engine(settings: Settings) -> AsyncIterator[AsyncEngine]:
    engine = make_engine(settings)
    try:
        yield engine
    finally:
        await engine.dispose()
