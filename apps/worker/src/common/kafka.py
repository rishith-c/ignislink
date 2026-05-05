"""Thin asyncio wrapper around aiokafka for sources, plus a sync consumer factory.

We deliberately keep this surface tiny — sources call `KafkaJsonProducer.send`,
sinks consume with kafka-python (sync) inside a thread for clean back-pressure
semantics. Both flavours share the same JSON encoding contract.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping
from typing import Any

from aiokafka import AIOKafkaProducer

from .config import PipelineSettings
from .logging import get_logger

logger = get_logger(__name__)


def _encode(value: Mapping[str, Any]) -> bytes:
    return json.dumps(value, separators=(",", ":"), default=str).encode("utf-8")


class KafkaJsonProducer:
    """Async JSON producer that's safe to use as an async context manager."""

    def __init__(self, settings: PipelineSettings, *, client_id_suffix: str = "") -> None:
        self._settings = settings
        self._client_id = (
            f"{settings.kafka_client_id}-{client_id_suffix}"
            if client_id_suffix
            else settings.kafka_client_id
        )
        self._producer: AIOKafkaProducer | None = None

    async def __aenter__(self) -> "KafkaJsonProducer":
        await self.start()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.stop()

    async def start(self) -> None:
        if self._producer is not None:
            return
        self._producer = AIOKafkaProducer(
            bootstrap_servers=self._settings.kafka_bootstrap,
            client_id=self._client_id,
            value_serializer=_encode,
            key_serializer=lambda k: k.encode("utf-8") if isinstance(k, str) else k,
            acks="all",
            enable_idempotence=True,
            linger_ms=50,
            request_timeout_ms=30_000,
        )
        await self._producer.start()
        logger.info("kafka.producer.started", client_id=self._client_id)

    async def stop(self) -> None:
        if self._producer is None:
            return
        try:
            await self._producer.stop()
        finally:
            self._producer = None
            logger.info("kafka.producer.stopped", client_id=self._client_id)

    async def send(
        self, topic: str, value: Mapping[str, Any], *, key: str | None = None
    ) -> None:
        if self._producer is None:
            raise RuntimeError("KafkaJsonProducer.send() called before start()")
        await self._producer.send_and_wait(topic, value=dict(value), key=key)


async def with_retry(
    coro_factory,
    *,
    attempts: int = 5,
    base_delay: float = 1.0,
    max_delay: float = 30.0,
):
    """Exponential-backoff retry around an awaitable factory."""
    last_err: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return await coro_factory()
        except Exception as exc:  # noqa: BLE001 — sources are intentionally generic
            last_err = exc
            delay = min(max_delay, base_delay * (2 ** (attempt - 1)))
            logger.warning(
                "retry.attempt_failed",
                attempt=attempt,
                attempts=attempts,
                delay=delay,
                error=str(exc),
            )
            await asyncio.sleep(delay)
    assert last_err is not None
    raise last_err
