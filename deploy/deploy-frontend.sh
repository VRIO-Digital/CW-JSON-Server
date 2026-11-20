#!/usr/bin/env bash
set -euo pipefail

# Rebuilds ContextWeave's frontend production bundle on this box and repoints nginx at it.
#
#   ./deploy-frontend.sh
#
# Run this ON the EC2 instance (cw.vriodigital.com) — it needs `sudo` for the parts root owns
# (the repo checkout and nginx config are both root-owned on this box; see the notes below).
#
# **It never risks `backend/`, but it is not afraid of a clean pull either.** That folder holds
# live demo data the running mock server writes to on every registration, settings change and
# profiling run (`commitDb`/`commitSettings` write straight to `backend/<dataset>/*.json`), so it
# is routinely left with uncommitted changes from actual use — on this box, *always*, which is
# the thing the first version of this script got wrong. It treated "the tree is dirty" as "do not
# pull", and since something in `backend/` is dirty here every single time, that was a permanent
# skip in practice: it silently never pulled anything again after the one time it was written,
# which is the opposite of what a deploy script is for. So it asks the real question instead —
# **would the incoming commits touch any file that is dirty right now?** — by fetching, diffing
# the two file lists, and pulling only when they do not overlap. A genuine collision (someone's
# commit landing on the same `backend/*.json` the live server just wrote) is still refused, named,
# and left for a human to resolve by hand.
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

# The checkout is root-owned (same reason `npm run build` below needs sudo), so every git
# command here does too — `git fetch` otherwise fails on `.git/FETCH_HEAD: Permission denied`
# while looking like a network problem.
git_branch() { sudo git rev-parse --abbrev-ref HEAD; }

echo "==> Checking for real conflicts before pulling…"
cd "$REPO_DIR"
sudo git fetch origin --quiet

branch="$(git_branch)"
remote_ref="origin/$branch"

incoming_files="$(sudo git diff --name-only HEAD "$remote_ref" -- 2>/dev/null || true)"
dirty_files="$(sudo git status --porcelain=v1 --untracked-files=no | cut -c4- || true)"

if [ -z "$incoming_files" ]; then
  echo "    Already up to date with $remote_ref — nothing to pull."
elif [ -z "$dirty_files" ]; then
  echo "==> Working tree is clean — fast-forwarding to $remote_ref…"
  sudo git merge --ff-only "$remote_ref"
else
  overlap="$(comm -12 <(printf '%s\n' "$incoming_files" | sort) <(printf '%s\n' "$dirty_files" | sort))"
  if [ -z "$overlap" ]; then
    echo "==> Incoming commits don't touch any currently-dirty file — fast-forwarding to $remote_ref…"
    echo "    (left alone, dirty from live use):"
    printf '%s\n' "$dirty_files" | sed 's/^/      /'
    sudo git merge --ff-only "$remote_ref"
  else
    echo "    Incoming commits touch file(s) that are dirty right now — refusing to pull:"
    printf '%s\n' "$overlap" | sed 's/^/      /'
    echo "    Resolve by hand (commit, stash, or discard the local change) and re-run."
  fi
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
