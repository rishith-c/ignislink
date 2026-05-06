#!/usr/bin/env bash
# scripts/restart.sh — stop all SENTRY processes and re-launch backend + frontend.
#
# What it stops:
#   * any `next dev` (frontend on :3000)
#   * any `uvicorn` running sentry_max_api (backend on :8000)
#   * any `python -m apps.worker` poller
#   * any `pnpm install / pnpm dlx shadcn` lockholder still around
#
# What it starts:
#   * frontend  : pnpm --filter @sentry-max/web dev               → http://localhost:3000
#   * backend   : uvicorn sentry_max_api.main:app --reload --port 8000
#                 (only if apps/api-py deps are installed; skipped with a
#                 friendly note otherwise)
#
# Logs go to /tmp/sentry-{web,api}.log so HMR / reload errors are inspectable.
#
# Usage:
#   bash scripts/restart.sh           # stop + restart both
#   bash scripts/restart.sh stop      # stop everything, don't restart
#   bash scripts/restart.sh frontend  # restart only the web dev server
#   bash scripts/restart.sh backend   # restart only the FastAPI service
#   bash scripts/restart.sh status    # what's running right now

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_LOG="/tmp/sentry-web.log"
API_LOG="/tmp/sentry-api.log"
WORKER_LOG="/tmp/sentry-worker.log"

# ──────────────── pretty output ────────────────

C_RST=$'\033[0m'; C_DIM=$'\033[2m'; C_RED=$'\033[31m'; C_GRN=$'\033[32m'
C_YEL=$'\033[33m'; C_CYA=$'\033[36m'

step()  { printf "%s▸%s %s\n" "$C_CYA" "$C_RST" "$*"; }
ok()    { printf "  %s✓%s %s\n" "$C_GRN" "$C_RST" "$*"; }
warn()  { printf "  %s⚠%s %s\n" "$C_YEL" "$C_RST" "$*"; }
note()  { printf "  %s%s%s\n" "$C_DIM" "$*" "$C_RST"; }

# ──────────────── stop ────────────────

stop_pattern() {
  local label="$1"; shift
  local pattern="$1"
  local pids
  pids=$(pgrep -f "$pattern" 2>/dev/null || true)
  if [[ -n "$pids" ]]; then
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 1
    # Force-kill any survivors.
    pids=$(pgrep -f "$pattern" 2>/dev/null || true)
    if [[ -n "$pids" ]]; then
      # shellcheck disable=SC2086
      kill -9 $pids 2>/dev/null || true
    fi
    ok "stopped $label"
  else
    note "no $label running"
  fi
}

stop_all() {
  step "stopping running SENTRY processes"
  stop_pattern "frontend (next dev)"   "next dev"
  stop_pattern "backend (uvicorn)"     "uvicorn .*sentry_max_api"
  stop_pattern "worker (apps.worker)"  "python.* -m apps.worker"
  stop_pattern "shadcn dlx"            "pnpm dlx shadcn"
  # Free up port 3000 / 8000 if anything is still bound.
  for port in 3000 8000; do
    local pid
    pid=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1)
    if [[ -n "$pid" ]]; then
      kill -9 "$pid" 2>/dev/null || true
      ok "freed port $port (pid $pid)"
    fi
  done
}

# ──────────────── start ────────────────

start_frontend() {
  step "starting frontend"
  cd "$REPO_ROOT" || exit 1
  : > "$WEB_LOG"
  nohup pnpm --filter @sentry-max/web dev > "$WEB_LOG" 2>&1 &
  disown
  # Wait up to 30s for "Ready in".
  local i
  for i in $(seq 1 30); do
    if grep -qE "Ready in|Error" "$WEB_LOG" 2>/dev/null; then break; fi
    sleep 1
  done
  if grep -q "Ready in" "$WEB_LOG"; then
    local port
    port=$(grep -oE 'localhost:[0-9]+' "$WEB_LOG" | head -1 | cut -d: -f2)
    ok "frontend ready on http://localhost:${port:-3000}  (log: $WEB_LOG)"
  else
    warn "frontend did not signal ready within 30s — tail $WEB_LOG"
  fi
}

start_backend() {
  step "starting backend"
  local api_dir="$REPO_ROOT/apps/api-py"
  if [[ ! -d "$api_dir" ]]; then
    warn "apps/api-py not found — skipping backend"
    return
  fi
  # Check that uvicorn is importable. If it isn't, bail with a clear note —
  # the dispatcher console runs fine without it via the fixture-fallback path.
  if ! python3 -c "import uvicorn, sentry_max_api" 2>/dev/null; then
    if ! python3 -c "import uvicorn" 2>/dev/null; then
      warn "uvicorn not installed in this Python env"
    else
      warn "sentry_max_api package not importable (run: cd apps/api-py && pip install -e . )"
    fi
    note "frontend will use fixture / USGS-direct fallback paths instead"
    return
  fi
  : > "$API_LOG"
  cd "$api_dir" || return
  nohup python3 -m uvicorn sentry_max_api.main:app --reload --port 8000 > "$API_LOG" 2>&1 &
  disown
  cd "$REPO_ROOT" || true
  # Wait up to 20s for /health.
  local i
  for i in $(seq 1 20); do
    if curl -fsS -m 1 http://localhost:8000/health >/dev/null 2>&1; then
      ok "backend ready on http://localhost:8000  (log: $API_LOG)"
      return
    fi
    sleep 1
  done
  warn "backend did not respond on /health within 20s — tail $API_LOG"
}

# ──────────────── status ────────────────

status() {
  step "process status"
  for pat in "next dev" "uvicorn .*sentry_max_api" "python.* -m apps.worker"; do
    local pids
    pids=$(pgrep -f "$pat" 2>/dev/null || true)
    if [[ -n "$pids" ]]; then
      printf "  %s● %s%s  (pid %s)\n" "$C_GRN" "$pat" "$C_RST" "$(echo "$pids" | xargs)"
    else
      printf "  %s○ %s — not running%s\n" "$C_DIM" "$pat" "$C_RST"
    fi
  done
  step "ports"
  for port in 3000 8000; do
    local pid
    pid=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1)
    if [[ -n "$pid" ]]; then
      printf "  %s● :%s%s  (pid %s)\n" "$C_GRN" "$port" "$C_RST" "$pid"
    else
      printf "  %s○ :%s — free%s\n" "$C_DIM" "$port" "$C_RST"
    fi
  done
}

# ──────────────── dispatch ────────────────

cmd="${1:-restart}"
case "$cmd" in
  stop)
    stop_all
    ;;
  status)
    status
    ;;
  frontend|fe|web)
    stop_pattern "frontend (next dev)" "next dev"
    start_frontend
    ;;
  backend|be|api)
    stop_pattern "backend (uvicorn)" "uvicorn .*sentry_max_api"
    start_backend
    ;;
  restart|"")
    stop_all
    start_backend
    start_frontend
    echo
    ok "SENTRY restart complete"
    note "logs: tail -f $WEB_LOG    tail -f $API_LOG"
    ;;
  *)
    cat <<USAGE
usage: $(basename "$0") [restart|stop|status|frontend|backend]

  restart   stop everything, then start backend + frontend (default)
  stop      stop everything, do not restart
  status    show what's running and which ports are bound
  frontend  restart only the web dev server (port 3000)
  backend   restart only the FastAPI service (port 8000)
USAGE
    exit 1
    ;;
esac
