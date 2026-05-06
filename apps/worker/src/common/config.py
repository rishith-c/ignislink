"""Pipeline configuration sourced from environment variables.

All knobs are immutable (frozen Pydantic settings) and validated at startup so
sources/sinks fail fast on misconfiguration rather than mid-stream.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class PipelineSettings(BaseSettings):
    """Runtime settings for the data pipeline."""

    model_config = SettingsConfigDict(
        env_prefix="",
        env_file=".env",
        extra="ignore",
        frozen=True,
    )

    # ---- Kafka --------------------------------------------------------------
    kafka_bootstrap: str = Field(
        default="localhost:9092",
        validation_alias="KAFKA_BOOTSTRAP_SERVERS",
        description="Comma-separated list of Kafka bootstrap brokers.",
    )
    kafka_client_id: str = Field(default="sentry-worker")

    topic_detections: str = Field(default="detections.created")
    topic_earthquakes: str = Field(default="earthquakes.observed")
    topic_gauges: str = Field(default="gauges.stage")
    topic_detections_agg: str = Field(default="detections.agg.5min")

    # ---- Postgres -----------------------------------------------------------
    pg_dsn: str = Field(
        default="postgresql://sentry:sentry@localhost:5432/sentry",
        validation_alias="PG_DSN",
    )

    # ---- Sources ------------------------------------------------------------
    firms_api_key: str | None = Field(default=None, validation_alias="FIRMS_API_KEY")
    firms_source: str = Field(default="VIIRS_NOAA20_NRT")
    firms_area: str = Field(default="world")
    firms_days: int = Field(default=1, ge=1, le=10)
    firms_poll_seconds: int = Field(default=60, ge=10)

    quakes_url: str = Field(
        default="https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson"
    )
    quakes_poll_seconds: int = Field(default=300, ge=30)

    water_url: str = Field(
        default=(
            "https://waterservices.usgs.gov/nwis/iv/"
            "?format=json&stateCd=ca&parameterCd=00065&siteStatus=active&period=PT1H"
        )
    )
    water_poll_seconds: int = Field(default=900, ge=60)

    # ---- Dedup / fixtures ---------------------------------------------------
    firms_dedup_window_hours: int = Field(default=24, ge=1, le=72)
    firms_dedup_radius_m: float = Field(default=375.0, ge=0.0)

    # ---- Spark --------------------------------------------------------------
    spark_master: str = Field(default="spark://spark-master:7077")
    spark_checkpoint_dir: str = Field(default="/tmp/sentry-spark-checkpoints/detections-agg-5min")
    spark_window_seconds: int = Field(default=60, ge=10)


@lru_cache(maxsize=1)
def get_settings() -> PipelineSettings:
    """Cached accessor — settings are environment-derived and immutable."""
    return PipelineSettings()
