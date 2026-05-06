-- Convert the high-volume time-series tables into TimescaleDB hypertables.
-- Idempotent — relies on ``if_not_exists`` semantics.

SELECT create_hypertable(
    'detections', 'observed_at',
    chunk_time_interval => interval '1 day',
    if_not_exists => TRUE
);

SELECT create_hypertable(
    'earthquake_events', 'observed_at',
    chunk_time_interval => interval '7 days',
    if_not_exists => TRUE
);

SELECT create_hypertable(
    'gauge_observations', 'observed_at',
    chunk_time_interval => interval '1 day',
    if_not_exists => TRUE
);
