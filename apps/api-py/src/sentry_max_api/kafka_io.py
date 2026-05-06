"""Kafka producer + consumer wrapper.

Named ``kafka_io`` (not ``kafka``) to avoid colliding with the third-party
``kafka`` package name on import paths.

The producer is fail-soft: in dev/local without Kafka the route layer
still works — ``KafkaPublisher.publish`` just logs the event and returns.
This is intentional for hackathon-mode demos.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any

import structlog

try:
    from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
except ImportError:  # pragma: no cover - aiokafka is a hard dep, but be safe
    AIOKafkaProducer = None  # type: ignore[assignment]
    AIOKafkaConsumer = None  # type: ignore[assignment]


_log: structlog.BoundLogger = structlog.get_logger(__name__)


class KafkaPublisher:
    """Lazy-started producer with a graceful no-op fallback."""

    def __init__(self, bootstrap: str | None) -> None:
        self._bootstrap = bootstrap
        self._producer: Any | None = None
        self._lock = asyncio.Lock()
        self._connected = False

    async def start(self) -> None:
        if not self._bootstrap or AIOKafkaProducer is None:
            _log.info("kafka.disabled", reason="no_bootstrap_or_lib")
            return
        async with self._lock:
            if self._producer is not None:
                return
            try:
                producer = AIOKafkaProducer(
                    bootstrap_servers=self._bootstrap,
                    value_serializer=lambda v: json.dumps(v, default=str).encode(),
                    request_timeout_ms=5000,
                )
                await producer.start()
                self._producer = producer
                self._connected = True
                _log.info("kafka.started", bootstrap=self._bootstrap)
            except Exception as exc:  # pragma: no cover - depends on env
                _log.warning(
                    "kafka.start_failed",
                    error=exc.__class__.__name__,
                    detail=str(exc),
                )
                self._producer = None

    async def stop(self) -> None:
        if self._producer is None:
            return
        try:
            await self._producer.stop()
        finally:
            self._producer = None
            self._connected = False

    async def publish(self, topic: str, value: dict[str, Any]) -> None:
        if self._producer is None:
            _log.info("kafka.publish.noop", topic=topic, value_keys=list(value))
            return
        try:
            await self._producer.send_and_wait(topic, value)
            _log.info("kafka.published", topic=topic)
        except Exception as exc:  # pragma: no cover - runtime dependent
            _log.warning(
                "kafka.publish_failed", topic=topic, error=exc.__class__.__name__
            )

    @property
    def connected(self) -> bool:
        return self._connected


def make_consumer(
    bootstrap: str, topics: list[str], group_id: str
) -> Any:  # pragma: no cover - thin factory
    if AIOKafkaConsumer is None:
        raise RuntimeError("aiokafka is not installed")
    return AIOKafkaConsumer(
        *topics,
        bootstrap_servers=bootstrap,
        group_id=group_id,
        value_deserializer=lambda v: json.loads(v.decode()) if v else None,
        auto_offset_reset="latest",
    )


HandlerFn = Callable[[dict[str, Any]], Awaitable[None]]


async def consume_loop(consumer: Any, handler: HandlerFn) -> None:  # pragma: no cover
    """Long-running consumer loop, handed off to a background task."""

    try:
        async for msg in consumer:
            try:
                await handler(msg.value)
            except Exception as exc:
                logging.exception("kafka.handler_failed: %s", exc)
    finally:
        await consumer.stop()
