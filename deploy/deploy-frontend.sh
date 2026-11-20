#!/usr/bin/env bash
set -euo pipefail

# Rebuilds ContextWeave's frontend production bundle on this box and repoints nginx at it.
#
#   ./deploy-frontend.sh
#
# Run this ON the EC2 instance (cw.vriodigital.com) — it needs `sudo` for the parts root owns
# (the repo checkout and nginx config are both root-owned on this box; see the notes below).
#
# **It never risks `backend/`, but it is not afraid of a clean pull either.** The pull logic is
# `lib-git-pull.sh`'s `safe_pull` — shared with `deploy-backend.sh` so the rule lives in one
# place — see that file for why "is the tree dirty" is the wrong question on this box.
#
# **What each step fixes, because each one bit us once setting this up:**
#   - The repo and `node_modules` are root-owned (an earlier manual setup), so `npm run build`
#     needs `sudo` or it fails on `EACCES` writing `tsconfig.*.tsbuildinfo`.
#   - `/home/ubuntu` itself was `750` — nginx's worker user (`www-data`) could not even traverse
#     into it to reach `frontend/dist`, regardless of the (correct, world-readable) permissions
#     on every directory beneath it. `chmod o+x` grants traverse-only access, not listing or
#     reading — `www-data` still cannot `ls` the home directory, only reach a path it already
#     knows, which is all nginx needs.
#   - A stray backup copy of the nginx site config left inside `sites-enabled/` was *also* being
#     loaded, each one declaring the same `server_name` — nginx just warns and ignores the
#     second, which reads as nothing being wrong until you look for the warning. Keep backups
#     outside `sites-enabled/`.
#
# Idempotent: re-running it when nothing has changed just rebuilds the same bundle and reloads
# nginx, which is harmless.

REPO_DIR="/home/ubuntu/CW-JSON-Server"
FRONTEND_DIR="$REPO_DIR/frontend"
NGINX_SITE="/etc/nginx/sites-enabled/default"
SITE_URL="https://cw.vriodigital.com"

# shellcheck source=lib-git-pull.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib-git-pull.sh"

echo "==> Checking for real conflicts before pulling…"
cd "$REPO_DIR"
safe_pull

echo "==> Building the frontend production bundle (this needs sudo: the checkout is root-owned)…"
cd "$FRONTEND_DIR"
sudo npm run build

echo "==> Verifying the build actually landed…"
test -f "$FRONTEND_DIR/dist/index.html" || { echo "    dist/index.html is missing — build failed, not touching nginx."; exit 1; }

echo "==> Making sure nginx's worker user can reach it…"
sudo chmod o+x /home/ubuntu

echo "==> Checking sites-enabled/ for a stray config that would conflict…"
extra=$(find /etc/nginx/sites-enabled -maxdepth 1 -type f ! -name "$(basename "$NGINX_SITE")" 2>/dev/null || true)
if [ -n "$extra" ]; then
  echo "    Found extra file(s) in sites-enabled/ besides $(basename "$NGINX_SITE") — nginx will warn and"
  echo "    silently ignore whichever one it loads second if they declare the same server_name:"
  echo "$extra" | sed 's/^/      /'
  echo "    Move anything that is not the live site out of sites-enabled/ before continuing."
fi

echo "==> Testing the nginx config…"
sudo nginx -t

echo "==> Reloading nginx…"
sudo systemctl reload nginx

echo "==> Smoke test…"
sleep 1
curl -sf -o /dev/null "$SITE_URL/" && echo "    frontend: OK" || echo "    frontend: FAILED — check 'sudo tail -f /var/log/nginx/error.log'"
curl -sf -o /dev/null "$SITE_URL/backend/health" && echo "    backend:  OK" || echo "    backend:  FAILED (unrelated to this script — this process was not touched)"

echo "==> Done."
