-- Detection aggregations populated by the Spark Structured Streaming job in
-- ``apps/worker/src/spark/aggregations.py``.
--
-- One row per (window_start, geohash5) cell. Window length is configurable on
-- the Spark side (defaults to 60 s) but the table schema is window-agnostic
-- so we can extend it to additional cadences later without a migration.

CREATE TABLE IF NOT EXISTS detections_agg_5min (
    window_start     timestamptz       NOT NULL,
    window_end       timestamptz       NOT NULL,
    geohash5         text              NOT NULL,
    detection_count  bigint            NOT NULL,
    avg_frp          double precision,
    max_frp          double precision,
    PRIMARY KEY (window_start, geohash5)
);

CREATE INDEX IF NOT EXISTS idx_detections_agg_5min_window_start
    ON detections_agg_5min (window_start DESC);
CREATE INDEX IF NOT EXISTS idx_detections_agg_5min_geohash5
    ON detections_agg_5min (geohash5, window_start DESC);

SELECT create_hypertable(
    'detections_agg_5min', 'window_start',
    chunk_time_interval => interval '1 day',
    if_not_exists => TRUE
);
