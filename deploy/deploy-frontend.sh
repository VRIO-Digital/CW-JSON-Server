#!/usr/bin/env bash
set -euo pipefail

# Rebuilds ContextWeave's frontend production bundle on this box and repoints nginx at it.
#
#   ./deploy-frontend.sh
#
# Run this ON the EC2 instance (cw.vriodigital.com) — it needs `sudo` for the parts root owns
# (the repo checkout and nginx config are both root-owned on this box; see the notes below).
#
# **It never touches `backend/`.** That folder holds live demo data the running mock server
# writes to on every registration, settings change and profiling run (`commitDb`/`commitSettings`
# write straight to `backend/<dataset>/*.json`), and it is routinely left with uncommitted
# changes from actual use. A deploy script that ran a blind `git pull` here could silently
# overwrite that data the moment someone else's commit touched the same files — so this script
# only pulls when the working tree is clean, and otherwise skips the pull and says so, rebuilding
# whatever is already checked out. Pull by hand first if you specifically want newer frontend code
# and are sure nothing in `backend/` would collide.
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

echo "==> Checking the working tree before pulling…"
cd "$REPO_DIR"
if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git status --porcelain=v1 --untracked-files=no)" ]; then
  echo "    Uncommitted changes present (expected: backend/*.json from live demo use)."
  echo "    Skipping 'git pull' so they are never touched — pull by hand first if you want newer code."
else
  echo "==> Working tree is clean — pulling latest…"
  git pull
fi

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
