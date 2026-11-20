#!/usr/bin/env bash
set -euo pipefail

# Runs both deploys in the order that matters: frontend first, backend second.
#
#   ./deploy-all.sh          # frontend, then backend (restarts only if backend/*.js changed)
#   ./deploy-all.sh --force  # same, but forces the backend restart regardless
#
# Each script does its own `safe_pull` (see lib-git-pull.sh), so running both back to back is
# not redundant work racing itself — the second pull is simply "already up to date" once the
# first one landed. Frontend first because it is the one with no state to lose; if it fails
# (bad build, nginx config), nothing has touched the backend's live demo state yet.

here="$(dirname "${BASH_SOURCE[0]}")"

echo "########## frontend ##########"
"$here/deploy-frontend.sh"

echo
echo "########## backend ##########"
"$here/deploy-backend.sh" "$@"
