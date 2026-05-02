from fastapi import FastAPI

from ignislink_api import __version__
from ignislink_api.observability import configure_observability
from ignislink_api.routes import detections, health


def create_app() -> FastAPI:
    configure_observability()
    app = FastAPI(
        title="IgnisLink Internal API",
        version=__version__,
        docs_url="/docs",
        redoc_url=None,
    )
    app.include_router(health.router)
    app.include_router(detections.router, prefix="/detections", tags=["detections"])
    return app


app = create_app()
