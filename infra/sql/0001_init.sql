-- =============================================================================
-- SENTRY hackathon — initial schema.
--
-- Layout:
--   * Required extensions (postgis, timescaledb, pgcrypto)
--   * Wildfire pipeline tables (detections, predictions, dispatches)
--   * Other-hazard tables (earthquake_events, gauge_observations)
--   * audit_log
--   * Hypertable + spatial/time index setup
--
-- Migration is idempotent so re-running into an existing volume is a no-op.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- detections — raw hotspot observations from FIRMS / VIIRS / GOES / etc.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS detections (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    hotspot     geometry(Point, 4326)            NOT NULL,
    observed_at timestamptz                      NOT NULL,
    sensor      text                             NOT NULL,
    confidence  text                             NOT NULL,
    frp_mw      real,
    locality    jsonb                            NOT NULL DEFAULT '{}'::jsonb,
    provenance  jsonb                            NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz                      NOT NULL DEFAULT now()
);

-- Hypertable partitioned by observed_at for fast time-range scans.
SELECT create_hypertable(
    'detections', 'observed_at',
    chunk_time_interval => interval '7 days',
    if_not_exists => TRUE,
    migrate_data => TRUE
);

CREATE INDEX IF NOT EXISTS detections_hotspot_gix
    ON detections USING GIST (hotspot);
CREATE INDEX IF NOT EXISTS detections_observed_at_idx
    ON detections (observed_at DESC);
CREATE INDEX IF NOT EXISTS detections_sensor_idx
    ON detections (sensor);

-- -----------------------------------------------------------------------------
-- predictions — output of the spread model. Linked to a parent detection.
-- The detection FK is intentionally a soft FK (no constraint) because
-- detections is a hypertable and Timescale recommends avoiding outbound FKs
-- onto chunks for write performance.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS predictions (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    detection_id  uuid                                NOT NULL,
    model_version text                                NOT NULL,
    generated_at  timestamptz                         NOT NULL DEFAULT now(),
    horizon_min   integer                             NOT NULL,
    p50_geom      geometry(MultiPolygon, 4326)        NOT NULL,
    input_hash    text                                NOT NULL,
    inference_ms  integer
);

CREATE INDEX IF NOT EXISTS predictions_detection_id_idx
    ON predictions (detection_id);
CREATE INDEX IF NOT EXISTS predictions_generated_at_idx
    ON predictions (generated_at DESC);
CREATE INDEX IF NOT EXISTS predictions_p50_geom_gix
    ON predictions USING GIST (p50_geom);
CREATE INDEX IF NOT EXISTS predictions_input_hash_idx
    ON predictions (input_hash);

-- -----------------------------------------------------------------------------
-- dispatches — outbound notifications to fire stations / partner agencies.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dispatches (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    detection_id    uuid          NOT NULL,
    dispatched_at   timestamptz   NOT NULL DEFAULT now(),
    station_id      text          NOT NULL,
    channel         text          NOT NULL,
    delivery_state  text          NOT NULL,
    payload         jsonb         NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS dispatches_detection_id_idx
    ON dispatches (detection_id);
CREATE INDEX IF NOT EXISTS dispatches_station_id_idx
    ON dispatches (station_id);
CREATE INDEX IF NOT EXISTS dispatches_dispatched_at_idx
    ON dispatches (dispatched_at DESC);
CREATE INDEX IF NOT EXISTS dispatches_delivery_state_idx
    ON dispatches (delivery_state);

-- -----------------------------------------------------------------------------
-- earthquake_events — USGS feed. Natural primary key (USGS event id).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS earthquake_events (
    id          text                          NOT NULL,
    mag         real,
    place       text,
    occurred_at timestamptz                   NOT NULL,
    location    geometry(Point, 4326),
    depth_km    real,
    raw         jsonb                         NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (id, occurred_at)
);

SELECT create_hypertable(
    'earthquake_events', 'occurred_at',
    chunk_time_interval => interval '30 days',
    if_not_exists => TRUE,
    migrate_data => TRUE
);

CREATE INDEX IF NOT EXISTS earthquake_events_location_gix
    ON earthquake_events USING GIST (location);
CREATE INDEX IF NOT EXISTS earthquake_events_occurred_at_idx
    ON earthquake_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS earthquake_events_mag_idx
    ON earthquake_events (mag DESC);

-- -----------------------------------------------------------------------------
-- gauge_observations — NOAA / USGS stream gauge readings.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gauge_observations (
    gauge_id    text         NOT NULL,
    observed_at timestamptz  NOT NULL,
    stage_ft    real,
    PRIMARY KEY (gauge_id, observed_at)
);

SELECT create_hypertable(
    'gauge_observations', 'observed_at',
    chunk_time_interval => interval '7 days',
    if_not_exists => TRUE,
    migrate_data => TRUE
);

CREATE INDEX IF NOT EXISTS gauge_observations_gauge_id_idx
    ON gauge_observations (gauge_id, observed_at DESC);

-- -----------------------------------------------------------------------------
-- audit_log — append-only journal of mutations across the system.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    id          bigserial PRIMARY KEY,
    actor       text         NOT NULL,
    action      text         NOT NULL,
    target_kind text         NOT NULL,
    target_id   text         NOT NULL,
    before      jsonb,
    after       jsonb,
    at          timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_target_idx
    ON audit_log (target_kind, target_id);
CREATE INDEX IF NOT EXISTS audit_log_at_idx
    ON audit_log (at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx
    ON audit_log (actor);
