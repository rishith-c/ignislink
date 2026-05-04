from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    service_name: str = "ignislink-api-py"
    environment: str = Field(default="local", validation_alias=AliasChoices("ENVIRONMENT", "IGNISLINK_ENVIRONMENT"))
    database_url: str | None = Field(default=None, validation_alias=AliasChoices("DATABASE_URL", "IGNISLINK_DATABASE_URL"))
    redis_url: str | None = Field(default=None, validation_alias=AliasChoices("REDIS_URL", "IGNISLINK_REDIS_URL"))
    require_dependencies: bool = Field(default=False, validation_alias=AliasChoices("REQUIRE_DEPENDENCIES", "IGNISLINK_REQUIRE_DEPENDENCIES"))

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
