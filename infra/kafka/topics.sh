#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Create the SENTRY topic catalog. Idempotent — `--if-not-exists` makes re-runs
# safe. Invoked automatically by the `kafka-init` service in
# infra/docker-compose.yml after the broker becomes healthy. Can also be run
# by hand against a remote broker:
#
#   KAFKA_BOOTSTRAP=localhost:9092 ./infra/kafka/topics.sh
# -----------------------------------------------------------------------------
set -euo pipefail

BOOTSTRAP="${KAFKA_BOOTSTRAP:-kafka:9092}"
KAFKA_BIN="${KAFKA_BIN:-/opt/bitnami/kafka/bin/kafka-topics.sh}"

if ! command -v "${KAFKA_BIN}" >/dev/null 2>&1 && [ ! -x "${KAFKA_BIN}" ]; then
    # Fall back to PATH lookup when running from a host with kafka tools installed.
    KAFKA_BIN="kafka-topics.sh"
fi

# topic_name partitions retention_ms description
TOPICS=(
    # Hot path: every raw FIRMS hotspot lands here.
    "detections.created     6  604800000   raw-detections"
    # After verification (rules + LLM) the survivors are republished.
    "detections.verified    6  604800000   verified-detections"
    # ML spread predictions ready for downstream consumers.
    "predictions.ready      3  259200000   spread-predictions"
    # Outbound dispatch envelopes (audit + delivery state).
    "dispatches.sent        3  604800000   dispatch-events"
    # USGS earthquake feed.
    "earthquakes.observed   3  2592000000  earthquake-events"
    # NOAA / USGS gauge readings (high volume — wider partitioning).
    "gauges.stage           6  604800000   stream-gauge-readings"
)

echo "[topics.sh] bootstrap=${BOOTSTRAP}"

for entry in "${TOPICS[@]}"; do
    # shellcheck disable=SC2086
    set -- ${entry}
    name="$1"
    partitions="$2"
    retention_ms="$3"

    echo "[topics.sh] ensuring topic ${name} (partitions=${partitions}, retention_ms=${retention_ms})"
    "${KAFKA_BIN}" \
        --bootstrap-server "${BOOTSTRAP}" \
        --create \
        --if-not-exists \
        --topic "${name}" \
        --partitions "${partitions}" \
        --replication-factor 1 \
        --config "retention.ms=${retention_ms}" \
        --config "cleanup.policy=delete"
done

echo "[topics.sh] catalog ready:"
"${KAFKA_BIN}" --bootstrap-server "${BOOTSTRAP}" --list
