# IgnisLink Runbook

> **Status:** placeholder. Filled in per service as Stages 1–5 land. Codex
> owns the operations section (`apps/api-py`, `apps/api-node`, `apps/worker`,
> infrastructure); claude owns the frontend + ML-pipeline sections.

## Severity definitions

| Sev | Criteria | Response time |
| --- | --- | --- |
| Sev-1 | Detection → console latency > 5 min OR a dispatch payload was sent that should have been suppressed | Page on-call immediately |
| Sev-2 | A single integration is degraded (FIRMS / HRRR / Mapbox) but the system still produces dispatchable incidents from another path | 30 min |
| Sev-3 | UI degradation, non-blocking warnings, slow-but-correct behavior | Next business day |

## Incident response

1. **Acknowledge** in the incident channel; capture the alert payload.
2. **Triage** using the Grafana dashboard (TBD URL — Codex §10.2).
3. **Mitigate first, root-cause second.** If the FIRMS poller is misbehaving,
   mute the affected region in Admin → Mute Regions. If the prediction
   service is down, the console gracefully degrades — verify the fallback is
   active before doing anything riskier.
4. **Communicate.** Update partners via the status page (TBD); update
   dispatchers in their console via a banner.
5. **Post-mortem** within 5 business days. Use the template in
   `docs/post-mortems/_template.md` (TBD).

## Known operational surfaces

### Frontend (`apps/web`) — claude

- **Dispatcher Console offline.** Static-tile fallback should still render the
  map; if not, check Sentry + the Mapbox token. Restart Vercel deploy.
- **Console event-to-render > 90 s p95.** Check the Socket.IO bridge metrics
  (Codex §10) and the Redis pub/sub backlog. If the bridge is backed up,
  bounce the WS server; events replay from the last 30 s.

### ML serving (`POST /predict/spread`) — claude (model) + codex (route)

- **5xx error spike.** Check ONNX runtime version against the deployed model
  binary. If mismatched, rollback to the prior model version (Admin → Model
  Versions → Revert).
- **p95 inference > 800 ms.** Check that requests are hitting the int8
  ONNX export, not the float32 dev model. Check input raster size (should be
  256 × 256).
- **HRRR unavailable.** Predictions auto-fall-back to Open-Meteo and tag
  `context_source: "open-meteo"` in the response. Verify the fallback path
  is active in the dashboard.

### FIRMS ingestion (`apps/worker`) — codex

- _Owned by Codex; entries land in their PR_

### Verification (`apps/worker`) — codex

- _Owned by Codex_

### Routing & dispatch (`apps/api-py`) — codex

- _Owned by Codex_

## On-call rotation

TBD. Initially: developer on-call from each agent (claude / codex). Real
roster lands when production goes live.
