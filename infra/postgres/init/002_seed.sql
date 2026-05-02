CREATE TABLE IF NOT EXISTS service_boot_marker (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO service_boot_marker (service)
VALUES ('ignislink-stage-0')
ON CONFLICT DO NOTHING;
