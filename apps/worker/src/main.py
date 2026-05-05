"""Pipeline orchestrator.

Spawns the requested subset of source pollers and Postgres sinks as concurrent
asyncio tasks. Designed to be invoked as a module so relative imports inside
``src/`` resolve cleanly:

    python -m apps.worker --sources firms,quakes,water --sinks postgres
    python -m apps.worker --sources firms
    python -m apps.worker --sinks postgres
"""

from __future__ import annotations

import argparse
import asyncio
import signal
import sys
from collections.abc import Awaitable, Callable

from common.config import get_settings
from common.logging import configure_logging, get_logger
from sinks.postgres import run_postgres_sinks
from sources.firms import run_firms_source
from sources.usgs_quakes import run_quakes_source
from sources.usgs_water import run_water_source

logger = get_logger(__name__)


SOURCES: dict[str, Callable[..., Awaitable[None]]] = {
    "firms": run_firms_source,
    "quakes": run_quakes_source,
    "water": run_water_source,
}

SINKS: dict[str, Callable[..., Awaitable[None]]] = {
    "postgres": run_postgres_sinks,
}


def _parse_csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [v.strip() for v in value.split(",") if v.strip()]


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="apps.worker",
        description="SENTRY data pipeline orchestrator.",
    )
    parser.add_argument(
        "--sources",
        type=str,
        default="",
        help="Comma-separated source names: firms,quakes,water",
    )
    parser.add_argument(
        "--sinks",
        type=str,
        default="",
        help="Comma-separated sink names: postgres",
    )
    parser.add_argument(
        "--log-level",
        type=str,
        default="INFO",
        help="Log level (DEBUG, INFO, WARNING, ERROR).",
    )
    return parser


async def _run(sources: list[str], sinks: list[str]) -> None:
    settings = get_settings()

    invalid_sources = [s for s in sources if s not in SOURCES]
    invalid_sinks = [s for s in sinks if s not in SINKS]
    if invalid_sources or invalid_sinks:
        raise SystemExit(
            f"Unknown sources={invalid_sources} sinks={invalid_sinks}. "
            f"Valid sources: {sorted(SOURCES)} | sinks: {sorted(SINKS)}"
        )

    if not sources and not sinks:
        raise SystemExit("Must specify at least one --sources or --sinks entry.")

    tasks: list[asyncio.Task] = []
    loop = asyncio.get_running_loop()

    stop_event = asyncio.Event()

    def _shutdown(signum: int) -> None:
        logger.info("orchestrator.signal", signum=signum)
        stop_event.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _shutdown, sig)
        except NotImplementedError:
            # Windows / restricted environments — fall back to default handler.
            pass

    for name in sources:
        tasks.append(asyncio.create_task(SOURCES[name](settings), name=f"source:{name}"))
    for name in sinks:
        tasks.append(asyncio.create_task(SINKS[name](settings), name=f"sink:{name}"))

    logger.info(
        "orchestrator.start",
        sources=sources,
        sinks=sinks,
        kafka=settings.kafka_bootstrap,
    )

    stopper = asyncio.create_task(stop_event.wait(), name="stopper")
    done, pending = await asyncio.wait(
        [*tasks, stopper], return_when=asyncio.FIRST_COMPLETED
    )

    for task in pending:
        task.cancel()
    await asyncio.gather(*pending, return_exceptions=True)

    for task in done:
        if task is stopper:
            continue
        if task.cancelled():
            continue
        exc = task.exception()
        if exc is not None:
            logger.error("orchestrator.task_failed", task=task.get_name(), error=str(exc))


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    configure_logging(args.log_level)
    sources = _parse_csv(args.sources)
    sinks = _parse_csv(args.sinks)
    try:
        asyncio.run(_run(sources, sinks))
    except KeyboardInterrupt:
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
