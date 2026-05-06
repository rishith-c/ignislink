"""FastAPI app factory + lifespan management.

The lifespan opens (and on shutdown closes):
    * Postgres async engine + sessionmaker
    * Redis client
    * Kafka publisher
    * ONNX inference session

All four are best-effort: if a dependency is missing the corresponding
``app.state.*`` attribute is set to ``None`` so the routes can degrade
gracefully (return 503 / empty responses) without crashing the process.
This is intentional for hackathon-mode local development — pass
``REQUIRE_DEPENDENCIES=true`` once stable.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from redis.asyncio import Redis

from sentry_max_api import __version__
from sentry_max_api.database import make_engine, make_session_factory
from sentry_max_api.kafka_io import KafkaPublisher
from sentry_max_api.observability import configure_observability
from sentry_max_api.onnx_loader import FireSpreadOnnx
from sentry_max_api.routes import (
    detections,
    dispatch,
    earthquakes,
    floods,
    health,
    predict,
)
from sentry_max_api.settings import Settings, get_settings


log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings: Settings = get_settings()

    # ---- Postgres ----
    app.state.engine = None
    app.state.session_factory = None
    if settings.database_url:
        try:
            engine = make_engine(settings)
            app.state.engine = engine
            app.state.session_factory = make_session_factory(engine)
        except Exception as exc:
            log.warning("postgres unavailable at startup: %s", exc)

    # ---- Redis ----
    app.state.redis = None
    if settings.redis_url:
        try:
            app.state.redis = Redis.from_url(settings.redis_url, decode_responses=False)
        except Exception as exc:
            log.warning("redis unavailable at startup: %s", exc)

    # ---- Kafka ----
    publisher = KafkaPublisher(settings.kafka_bootstrap)
    await publisher.start()
    app.state.kafka_publisher = publisher

    # ---- ONNX ----
    app.state.onnx_session = None
    try:
        app.state.onnx_session = FireSpreadOnnx.load(settings.onnx_model_path)
    except Exception as exc:
        log.warning("onnx model unavailable at startup: %s", exc)

    app.state.model_version = settings.model_version

    try:
        yield
    finally:
        if app.state.engine is not None:
            await app.state.engine.dispose()
        if app.state.redis is not None:
            try:
                await app.state.redis.aclose()
            except Exception:
                pass
        if app.state.kafka_publisher is not None:
            await app.state.kafka_publisher.stop()


def create_app() -> FastAPI:
    configure_observability()
    settings = get_settings()

    app = FastAPI(
        title="SentryMax Internal API",
        version=__version__,
        docs_url="/docs",
        redoc_url=None,
        lifespan=lifespan,
    )

    # Default app.state to None for tests using TestClient (which still runs
    # the lifespan, but we belt-and-suspenders so attribute access is safe
    # in any code path).
    app.state.engine = None
    app.state.session_factory = None
    app.state.redis = None
    app.state.kafka_publisher = None
    app.state.onnx_session = None
    app.state.model_version = settings.model_version

    app.include_router(health.router)
    app.include_router(detections.router, prefix="/detections", tags=["detections"])
    app.include_router(predict.router)
    app.include_router(dispatch.router, prefix="/dispatch", tags=["dispatch"])
    app.include_router(earthquakes.router, prefix="/earthquakes", tags=["earthquakes"])
    app.include_router(floods.router, prefix="/floods", tags=["floods"])
    return app


app = create_app()
