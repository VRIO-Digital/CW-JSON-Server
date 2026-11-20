#!/usr/bin/env bash
set -euo pipefail

# Pulls the latest backend code and restarts the mock server if (and only if) that pull actually
# changed backend source.
#
#   ./deploy-backend.sh          # restart only if backend/*.js changed in the pull
#   ./deploy-backend.sh --force  # restart anyway, even if nothing under backend/ changed
#
# Run this ON the EC2 instance — see deploy-frontend.sh's header for why (sudo, root-owned
# checkout, /home/ubuntu paths that do not exist off this box).
#
# **PM2 is not in the picture.** `ecosystem.config.js` documents the one-instance rule but
# nothing here actually runs under PM2 — `pm2 list` is empty. The mock server is one plain
# `node server.js`, started once and left running, so "deploy" for it means killing that
# process and starting a fresh one from the pulled code — Node does not hot-reload.
#
# **That is also the one real cost of this script, and it is not hidden.** Restarting clears
# every bit of state this process holds only in memory and never writes to a file: registered
# sources, profiling jobs, Graph Studio builds/versions/decisions, publications (what makes
# Ask/Reports/What-if/Audit open at all), OAuth consent sessions, saved What-if scenarios. A
# restart is sometimes exactly what you want — a stale process serving an old shape is the
# pitfall CLAUDE.md calls "editing server.js requires a restart" — but it must never happen as
# a side effect of a pull that did not even touch backend code, which is why this checks before
# acting rather than restarting unconditionally on every run.
#
# **So the default is conservative: restart only when the backend's own `.js` actually moved.**
# A pull that only changed `backend/*.json` (live data) or frontend files restarts nothing — the
# running process already is the code it is running. `--force` is the escape hatch for "nothing
# changed but I want a clean process anyway" (e.g. to clear stuck demo state on purpose).

REPO_DIR="/home/ubuntu/CW-JSON-Server"
BACKEND_DIR="$REPO_DIR/backend"
LOG_FILE="/home/ubuntu/backend.log"
HEALTH_URL="http://127.0.0.1:4000/backend/health"
PATTERN="node .*backend/server\.js"

FORCE=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    *) echo "usage: $0 [--force]" >&2; exit 2 ;;
  esac
done

# shellcheck source=lib-git-pull.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib-git-pull.sh"

echo "==> Checking for real conflicts before pulling…"
cd "$REPO_DIR"
before="$(sudo git rev-parse HEAD)"
safe_pull
after="$(sudo git rev-parse HEAD)"

if [ "$before" = "$after" ] && [ "$FORCE" -eq 0 ]; then
  echo "==> Nothing new was pulled — the running backend already matches this code. Not restarting."
  exit 0
fi

changed_backend_js="$(sudo git diff --name-only "$before" "$after" -- backend 2>/dev/null | grep -E '\.m?js$' || true)"

if [ -z "$changed_backend_js" ] && [ "$FORCE" -eq 0 ]; then
  echo "==> This pull didn't touch any backend .js file — the running process already is the code"
  echo "    it's running. Not restarting (that would clear every registered source, profiling job,"
  echo "    Graph Studio build/publication and saved scenario currently live, for no reason)."
  exit 0
fi

if [ "$FORCE" -eq 1 ] && [ -z "$changed_backend_js" ]; then
  echo "==> --force: restarting even though no backend .js file changed."
else
  echo "==> Backend source changed:"
  printf '%s\n' "$changed_backend_js" | sed 's/^/      /'
fi

echo "==> Restarting clears all in-memory state: registered sources, profiling jobs, Graph Studio"
echo "    builds/versions/decisions and publications, OAuth consent sessions, saved What-if"
echo "    scenarios. None of that is on disk — this is the unavoidable cost, not a bug."

old_pid="$(pgrep -f "$PATTERN" || true)"
if [ -n "$old_pid" ]; then
  echo "==> Stopping the running server (pid $old_pid)…"
  sudo kill -TERM "$old_pid"
  for _ in $(seq 1 10); do
    sudo kill -0 "$old_pid" 2>/dev/null || break
    sleep 1
  done
  if sudo kill -0 "$old_pid" 2>/dev/null; then
    echo "    Still up after 10s — sending SIGKILL."
    sudo kill -KILL "$old_pid" || true
  fi
else
  echo "==> No running backend process found (pattern: $PATTERN) — starting fresh."
fi

echo "==> Starting the backend from the pulled code…"
cd "$BACKEND_DIR"
sudo bash -c "cd '$BACKEND_DIR' && setsid nohup node server.js >> '$LOG_FILE' 2>&1 < /dev/null & disown"

echo "==> Waiting for it to answer…"
ok=0
for _ in $(seq 1 15); do
  sleep 1
  if curl -sf --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
    ok=1
    break
  fi
done

if [ "$ok" -eq 1 ]; then
  echo "==> Backend: OK"
  curl -s "$HEALTH_URL"
  echo
  echo "    Log: $LOG_FILE"
else
  echo "==> Backend: FAILED to answer within 15s — check '$LOG_FILE' and 'pgrep -fa server.js'"
  exit 1
fi

echo "==> Done."
