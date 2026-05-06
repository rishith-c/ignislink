"""Spark Structured Streaming: 1-minute tumbling-window FIRMS detection counts.

Reads ``detections.created`` from Kafka, geohash-5 buckets each detection, and
emits per-cell tumbling-window counts (default 60s window) to Postgres
(``detections_agg_5min``) via a JDBC ``foreachBatch`` sink.

Submit (after ``infra/docker-compose.yml`` is up):

    docker exec -it sentry-spark-master /opt/spark/bin/spark-submit \\
        --master spark://spark-master:7077 \\
        --packages org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.0,org.postgresql:postgresql:42.7.3 \\
        /opt/jobs/aggregations.py

The compose file mounts ``apps/worker/src/spark`` into ``/opt/jobs`` for both
spark-master and spark-worker so the job is visible inside the cluster.
"""

from __future__ import annotations

import os
import sys

# Make the local ``common`` package importable when this file is run by
# spark-submit. We support two layouts:
#   1. Repo layout: src/spark/aggregations.py — common/ lives one dir up.
#   2. Container layout: /opt/jobs/aggregations.py with /opt/jobs/common/.
_HERE = os.path.dirname(os.path.abspath(__file__))
_PARENT = os.path.dirname(_HERE)
for candidate in (_HERE, _PARENT):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

from pyspark.sql import DataFrame, SparkSession  # noqa: E402
from pyspark.sql import functions as F  # noqa: E402
from pyspark.sql.types import (  # noqa: E402
    DoubleType,
    StringType,
    StructField,
    StructType,
    TimestampType,
)

from common.geo import geohash_encode  # noqa: E402  (relative import after sys.path tweak)


# Schema for the JSON detections payload — keep in sync with sources/firms.py.
DETECTION_SCHEMA = StructType(
    [
        StructField("detection_id", StringType(), nullable=False),
        StructField("source", StringType(), nullable=True),
        StructField("satellite", StringType(), nullable=True),
        StructField("instrument", StringType(), nullable=True),
        StructField("latitude", DoubleType(), nullable=False),
        StructField("longitude", DoubleType(), nullable=False),
        StructField("brightness", DoubleType(), nullable=True),
        StructField("frp", DoubleType(), nullable=True),
        StructField("confidence", StringType(), nullable=True),
        StructField("daynight", StringType(), nullable=True),
        StructField("scan", DoubleType(), nullable=True),
        StructField("track", DoubleType(), nullable=True),
        StructField("observed_at", TimestampType(), nullable=False),
        StructField("ingested_at", TimestampType(), nullable=True),
    ]
)


def _kafka_bootstrap() -> str:
    return os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092")


def _topic() -> str:
    return os.getenv("DETECTIONS_TOPIC", "detections.created")


def _checkpoint_dir() -> str:
    return os.getenv("SPARK_CHECKPOINT_DIR", "/tmp/sentry-checkpoints/detections-agg-5min")


def _window_seconds() -> int:
    return int(os.getenv("SPARK_WINDOW_SECONDS", "60"))


def _pg_jdbc_url() -> str:
    # Format: jdbc:postgresql://host:port/db
    return os.getenv("PG_JDBC_URL", "jdbc:postgresql://postgres:5432/sentry")


def _pg_user() -> str:
    return os.getenv("PG_USER", "sentry")


def _pg_password() -> str:
    return os.getenv("PG_PASSWORD", "sentry")


# Geohash UDF — leverage the dependency-free encoder shared with the sources.
geohash5_udf = F.udf(lambda lat, lon: geohash_encode(lat, lon, 5), StringType())


def build_streaming_query(spark: SparkSession) -> "pyspark.sql.streaming.StreamingQuery":  # type: ignore[name-defined]
    """Wire up the read-stream → aggregate → JDBC-foreachBatch pipeline."""
    raw: DataFrame = (
        spark.readStream.format("kafka")
        .option("kafka.bootstrap.servers", _kafka_bootstrap())
        .option("subscribe", _topic())
        .option("startingOffsets", "latest")
        .option("failOnDataLoss", "false")
        .load()
    )

    parsed = (
        raw.select(F.col("value").cast("string").alias("json_value"))
        .select(F.from_json("json_value", DETECTION_SCHEMA).alias("d"))
        .select("d.*")
        .filter(F.col("detection_id").isNotNull())
    )

    bucketed = parsed.withColumn(
        "geohash5", geohash5_udf(F.col("latitude"), F.col("longitude"))
    ).withWatermark("observed_at", "10 minutes")

    window_expr = F.window(F.col("observed_at"), f"{_window_seconds()} seconds")
    aggregated = (
        bucketed.groupBy(window_expr, F.col("geohash5"))
        .agg(
            F.count(F.lit(1)).alias("detection_count"),
            F.avg("frp").alias("avg_frp"),
            F.max("frp").alias("max_frp"),
        )
        .select(
            F.col("window.start").alias("window_start"),
            F.col("window.end").alias("window_end"),
            F.col("geohash5"),
            F.col("detection_count").cast("long"),
            F.col("avg_frp").cast("double"),
            F.col("max_frp").cast("double"),
        )
    )

    def _write_batch(batch_df: DataFrame, batch_id: int) -> None:  # noqa: ARG001
        if batch_df.rdd.isEmpty():
            return
        # Stage rows in a temp table per batch then upsert — simplest pattern
        # that works with Spark JDBC's lack of native ON CONFLICT support.
        staging = "detections_agg_5min_staging"
        (
            batch_df.write.format("jdbc")
            .option("url", _pg_jdbc_url())
            .option("dbtable", staging)
            .option("user", _pg_user())
            .option("password", _pg_password())
            .option("driver", "org.postgresql.Driver")
            .mode("overwrite")
            .save()
        )
        # Merge staging -> target (idempotent on (window_start, geohash5)).
        merge_sql = (
            "INSERT INTO detections_agg_5min "
            "(window_start, window_end, geohash5, detection_count, avg_frp, max_frp) "
            "SELECT window_start, window_end, geohash5, detection_count, avg_frp, max_frp "
            f"FROM {staging} "
            "ON CONFLICT (window_start, geohash5) DO UPDATE SET "
            "  window_end = EXCLUDED.window_end, "
            "  detection_count = EXCLUDED.detection_count, "
            "  avg_frp = EXCLUDED.avg_frp, "
            "  max_frp = EXCLUDED.max_frp;"
        )
        # Use the JDBC driver directly via py4j's reflection to run the merge.
        sc = spark.sparkContext
        gateway = sc._gateway  # type: ignore[attr-defined]
        DriverManager = gateway.jvm.java.sql.DriverManager  # type: ignore[attr-defined]
        conn = DriverManager.getConnection(_pg_jdbc_url(), _pg_user(), _pg_password())
        try:
            stmt = conn.createStatement()
            try:
                stmt.execute(merge_sql)
                stmt.execute(f"DROP TABLE IF EXISTS {staging};")
            finally:
                stmt.close()
        finally:
            conn.close()

    return (
        aggregated.writeStream.outputMode("update")
        .foreachBatch(_write_batch)
        .option("checkpointLocation", _checkpoint_dir())
        .trigger(processingTime=f"{_window_seconds()} seconds")
        .start()
    )


def main() -> None:
    spark = (
        SparkSession.builder.appName("sentry-detections-agg-5min")
        .config("spark.sql.shuffle.partitions", "4")
        .config("spark.sql.session.timeZone", "UTC")
        .getOrCreate()
    )
    spark.sparkContext.setLogLevel("WARN")
    query = build_streaming_query(spark)
    query.awaitTermination()


if __name__ == "__main__":
    main()
