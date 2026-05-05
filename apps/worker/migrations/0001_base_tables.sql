-- Base tables for the SENTRY data pipeline.
-- Idempotent — safe to run repeatedly. Apply with:
--   psql "$PG_DSN" -f apps/worker/migrations/0001_base_tables.sql

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ---------------------------------------------------------------------------
-- FIRMS active-fire detections (one row per VIIRS / MODIS pixel observation).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS detections (
    detection_id   text        PRIMARY KEY,
    source         text        NOT NULL DEFAULT 'firms',
    satellite      text,
    instrument     text,
    latitude       double precision NOT NULL,
    longitude      double precision NOT NULL,
    brightness     double precision,
    frp            double precision,
    confidence     text,
    daynight       text,
    scan           double precision,
    track          double precision,
    observed_at    timestamptz NOT NULL,
    ingested_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_detections_observed_at
    ON detections (observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_detections_lat_lon
    ON detections (latitude, longitude);

-- ---------------------------------------------------------------------------
-- USGS earthquake events.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS earthquake_events (
    event_id        text PRIMARY KEY,
    source          text NOT NULL DEFAULT 'usgs',
    magnitude       double precision,
    magnitude_type  text,
    place           text,
    latitude        double precision NOT NULL,
    longitude       double precision NOT NULL,
    depth_km        double precision,
    felt            integer,
    tsunami         boolean NOT NULL DEFAULT false,
    alert           text,
    status          text,
    url             text,
    observed_at     timestamptz NOT NULL,
    ingested_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quakes_observed_at
    ON earthquake_events (observed_at DESC);

-- ---------------------------------------------------------------------------
-- USGS NWIS instantaneous gauge observations.
-- Composite primary key gives us idempotency without surrogate IDs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gauge_observations (
    site_code    text             NOT NULL,
    site_name    text,
    param_code   text,
    unit         text,
    value        double precision NOT NULL,
    latitude     double precision,
    longitude    double precision,
    observed_at  timestamptz      NOT NULL,
    ingested_at  timestamptz      NOT NULL DEFAULT now(),
    PRIMARY KEY (site_code, observed_at)
);

CREATE INDEX IF NOT EXISTS idx_gauges_site
    ON gauge_observations (site_code, observed_at DESC);
