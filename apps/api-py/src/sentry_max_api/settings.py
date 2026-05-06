"""Service settings — env-driven, cached at process start.

Defaults are tuned for the local docker-compose stack at
``infra/docker-compose.yml`` (sentry/sentry/sentry). The cache lives on
``get_settings``; tests that mutate env should call ``get_settings.cache_clear()``.
"""

from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


# Resolve the ml/models directory relative to the repo root so the API can
# always find the bundled ONNX artifact regardless of working directory.
_REPO_ROOT = Path(__file__).resolve().parents[4]
_DEFAULT_ONNX_PATH = _REPO_ROOT / "ml" / "models" / "fire-spread-prod-candidate-bounded.onnx"


class Settings(BaseSettings):
    service_name: str = "sentry-max-api-py"

    environment: str = Field(
        default="local",
        validation_alias=AliasChoices("ENVIRONMENT", "IGNISLINK_ENVIRONMENT"),
    )

    # ---- core stores ----
    # Defaults intentionally None: when DATABASE_URL/REDIS_URL/KAFKA_BOOTSTRAP
    # are unset the readiness probe surfaces "degraded" rather than the API
    # blowing up at startup. The docker-compose service block injects the
    # correct URLs for the live stack (sentry/sentry/sentry on the
    # ``sentry-net`` network).
    database_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices("DATABASE_URL", "IGNISLINK_DATABASE_URL"),
    )
    redis_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices("REDIS_URL", "IGNISLINK_REDIS_URL"),
    )
    kafka_bootstrap: str | None = Field(
        default=None,
        validation_alias=AliasChoices("KAFKA_BOOTSTRAP", "IGNISLINK_KAFKA_BOOTSTRAP"),
    )

    # ---- ML model artifacts ----
    onnx_model_path: str = Field(
        default=str(_DEFAULT_ONNX_PATH),
        validation_alias=AliasChoices("ONNX_MODEL_PATH", "IGNISLINK_ONNX_MODEL_PATH"),
    )
    model_version: str = Field(
        default="fire-spread-prod-candidate-bounded",
        validation_alias=AliasChoices("MODEL_VERSION", "IGNISLINK_MODEL_VERSION"),
    )

    # ---- runtime knobs ----
    require_dependencies: bool = Field(
        default=False,
        validation_alias=AliasChoices(
            "REQUIRE_DEPENDENCIES", "IGNISLINK_REQUIRE_DEPENDENCIES"
        ),
    )
    predict_cache_ttl_seconds: int = Field(
        default=900,
        validation_alias=AliasChoices(
            "PREDICT_CACHE_TTL_SECONDS", "IGNISLINK_PREDICT_CACHE_TTL_SECONDS"
        ),
    )

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
