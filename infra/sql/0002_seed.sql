-- =============================================================================
-- SENTRY hackathon — fixture seed.
--
-- Mirrors apps/web/src/lib/fixtures.ts (IG-2K91, IG-7HQ4, IG-3MX2, IG-5KP8,
-- IG-8LR3, IG-9NB7). Inserts deterministic UUIDs so dev tooling can join
-- against the same ids each boot. Idempotent via ON CONFLICT clauses.
--
-- observed_at is anchored relative to a fixed timestamp (2026-05-02T00:00:00Z)
-- so the demo is reproducible — adjust if you want "now()" semantics.
-- =============================================================================

DO $$
DECLARE
    base_ts constant timestamptz := timestamptz '2026-05-02 00:00:00+00';

    -- Stable detection UUIDs. Format: ig-2026-05-02-XXX in dashed-uuid form.
    det_2k91 constant uuid := '11111111-1111-4111-8111-000000000001';
    det_7hq4 constant uuid := '11111111-1111-4111-8111-000000000002';
    det_3mx2 constant uuid := '11111111-1111-4111-8111-000000000003';
    det_5kp8 constant uuid := '11111111-1111-4111-8111-000000000004';
    det_8lr3 constant uuid := '11111111-1111-4111-8111-000000000005';
    det_9nb7 constant uuid := '11111111-1111-4111-8111-000000000006';
BEGIN
    -- ---------------------------------------------------------------------
    -- detections
    -- ---------------------------------------------------------------------
    INSERT INTO detections (id, hotspot, observed_at, sensor, confidence, frp_mw, locality, provenance)
    VALUES
        (det_2k91,
         ST_SetSRID(ST_MakePoint(-120.4148, 38.6924), 4326),
         base_ts - interval '7 minutes',
         'VIIRS',
         'high',
         412.0,
         jsonb_build_object('shortId', 'IG-2K91', 'county', 'El Dorado', 'state', 'CA', 'neighborhood', 'Pollock Pines'),
         jsonb_build_object('source', 'NASA FIRMS', 'brightTi4', 367.2)),

        (det_7hq4,
         ST_SetSRID(ST_MakePoint(-120.6917, 35.7621), 4326),
         base_ts - interval '23 minutes',
         'VIIRS',
         'nominal',
         87.4,
         jsonb_build_object('shortId', 'IG-7HQ4', 'county', 'Monterey', 'state', 'CA', 'neighborhood', 'Parkfield'),
         jsonb_build_object('source', 'NASA FIRMS', 'brightTi4', 341.8)),

        (det_3mx2,
         ST_SetSRID(ST_MakePoint(-123.0868, 44.0521), 4326),
         base_ts - interval '41 minutes',
         'VIIRS',
         'high',
         612.0,
         jsonb_build_object('shortId', 'IG-3MX2', 'county', 'Lane', 'state', 'OR', 'neighborhood', 'Eugene foothills'),
         jsonb_build_object('source', 'NASA FIRMS', 'brightTi4', 372.1)),

        (det_5kp8,
         ST_SetSRID(ST_MakePoint(-117.1611, 32.7157), 4326),
         base_ts - interval '89 minutes',
         'VIIRS',
         'low',
         12.1,
         jsonb_build_object('shortId', 'IG-5KP8', 'county', 'San Diego', 'state', 'CA', 'neighborhood', 'Otay Mesa'),
         jsonb_build_object('source', 'NASA FIRMS', 'brightTi4', 318.4, 'flag', 'industrial-flare')),

        (det_8lr3,
         ST_SetSRID(ST_MakePoint(-119.8483, 39.5501), 4326),
         base_ts - interval '12 minutes',
         'VIIRS',
         'high',
         287.3,
         jsonb_build_object('shortId', 'IG-8LR3', 'county', 'Washoe', 'state', 'NV', 'neighborhood', 'Peavine Mountain'),
         jsonb_build_object('source', 'NASA FIRMS', 'brightTi4', 358.9)),

        (det_9nb7,
         ST_SetSRID(ST_MakePoint(-118.5658, 36.4906), 4326),
         base_ts - interval '54 minutes',
         'VIIRS',
         'nominal',
         64.7,
         jsonb_build_object('shortId', 'IG-9NB7', 'county', 'Tulare', 'state', 'CA', 'neighborhood', 'Sequoia NF — registered burn'),
         jsonb_build_object('source', 'NASA FIRMS', 'brightTi4', 339.2, 'flag', 'prescribed-burn'))
    ON CONFLICT (id) DO NOTHING;

    -- ---------------------------------------------------------------------
    -- predictions — t+60 / t+360 / t+1440 cones around each active detection.
    -- Geometry is a small buffered cone approximated by buffering the hotspot.
    -- ---------------------------------------------------------------------
    INSERT INTO predictions (id, detection_id, model_version, generated_at, horizon_min, p50_geom, input_hash, inference_ms)
    SELECT
        gen_random_uuid(),
        d.id,
        'spread-v0.1.0',
        base_ts - interval '5 minutes',
        h.horizon,
        ST_Multi(ST_Buffer(d.hotspot::geography, h.radius_m)::geometry)::geometry(MultiPolygon, 4326),
        encode(digest(d.id::text || ':' || h.horizon::text, 'sha256'), 'hex'),
        45 + (h.horizon / 60)
    FROM detections d
    CROSS JOIN (VALUES (60, 600), (360, 1800), (1440, 5400)) AS h(horizon, radius_m)
    WHERE d.id IN (det_2k91, det_3mx2, det_8lr3)
    ON CONFLICT DO NOTHING;

    -- ---------------------------------------------------------------------
    -- dispatches — one delivered + one acknowledged per active incident.
    -- ---------------------------------------------------------------------
    INSERT INTO dispatches (id, detection_id, dispatched_at, station_id, channel, delivery_state, payload)
    VALUES
        (gen_random_uuid(), det_2k91, base_ts - interval '6 minutes',
         'stn_eldorado_3', 'webhook', 'delivered',
         jsonb_build_object('etaMinutes', 6, 'distanceKm', 4.1, 'agency', 'El Dorado Cnty FD')),
        (gen_random_uuid(), det_2k91, base_ts - interval '5 minutes',
         'stn_eldorado_5', 'webhook', 'acknowledged',
         jsonb_build_object('etaMinutes', 11, 'distanceKm', 9.4, 'agency', 'Cal Fire AEU')),
        (gen_random_uuid(), det_3mx2, base_ts - interval '38 minutes',
         'stn_lane_2', 'webhook', 'acknowledged',
         jsonb_build_object('etaMinutes', 8, 'distanceKm', 6.7, 'agency', 'Eugene-Springfield FR')),
        (gen_random_uuid(), det_8lr3, base_ts - interval '10 minutes',
         'stn_washoe_4', 'webhook', 'delivered',
         jsonb_build_object('etaMinutes', 9, 'distanceKm', 7.8, 'agency', 'Reno FD'))
    ON CONFLICT DO NOTHING;
END $$;

-- ----------------------------------------------------------------------------
-- earthquake_events — recent California-relevant USGS samples.
-- ----------------------------------------------------------------------------
INSERT INTO earthquake_events (id, mag, place, occurred_at, location, depth_km, raw)
VALUES
    ('us7000nca1', 4.3, '12km NE of Ridgecrest, CA',
     timestamptz '2026-05-01 22:14:00+00',
     ST_SetSRID(ST_MakePoint(-117.5253, 35.7224), 4326),
     8.4,
     jsonb_build_object('source', 'USGS', 'felt', 17, 'tsunami', 0)),
    ('us7000ncb2', 3.1, '5km SSW of Parkfield, CA',
     timestamptz '2026-05-01 23:02:00+00',
     ST_SetSRID(ST_MakePoint(-120.4543, 35.8014), 4326),
     5.7,
     jsonb_build_object('source', 'USGS', 'felt', 4, 'tsunami', 0)),
    ('us7000ncc3', 2.8, '8km W of Coalinga, CA',
     timestamptz '2026-05-02 00:48:00+00',
     ST_SetSRID(ST_MakePoint(-120.4682, 36.1397), 4326),
     11.2,
     jsonb_build_object('source', 'USGS', 'felt', 0, 'tsunami', 0))
ON CONFLICT (id, occurred_at) DO NOTHING;

-- ----------------------------------------------------------------------------
-- gauge_observations — synthetic stage readings for two California gauges
-- (San Joaquin @ Vernalis, Sacramento @ Freeport) covering the last hour.
-- ----------------------------------------------------------------------------
INSERT INTO gauge_observations (gauge_id, observed_at, stage_ft)
SELECT
    g.gauge_id,
    timestamptz '2026-05-02 00:00:00+00' - (offset_min * interval '5 minutes'),
    g.base_stage + (random() * 0.4 - 0.2)::real
FROM (
    VALUES
        ('NWIS-11303500', 12.4::real),  -- San Joaquin R @ Vernalis
        ('NWIS-11447650', 14.1::real)   -- Sacramento R @ Freeport
) AS g(gauge_id, base_stage)
CROSS JOIN generate_series(0, 11) AS offset_min
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- audit_log — record the seed itself.
-- ----------------------------------------------------------------------------
INSERT INTO audit_log (actor, action, target_kind, target_id, before, after)
VALUES ('system:seed', 'fixture-seed-applied', 'database', 'sentry',
        NULL,
        jsonb_build_object('detections', 6, 'predictions_per_active', 3, 'dispatches', 4,
                           'earthquakes', 3, 'gauges', 2));
