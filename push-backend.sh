#!/bin/bash
#
# push-backend.sh - commit and push only the mock server and its S3 backend.
#
# The frontend (src/, index.html, vite.config.ts, the tsconfigs) is left alone:
# nothing outside BACKEND_PATHS is staged, so a half-finished page cannot ride
# along with a server fix.
#
#   ./push-backend.sh                       # commit staged backend changes, push
#   ./push-backend.sh "fix sigv4 signing"   # with your own commit message
#   ./push-backend.sh -n                    # dry run: show what would go, change nothing
#   ./push-backend.sh -s "msg"              # skip verify:sigv4 / verify:export
#
set -euo pipefail

cd "$(dirname "$0")"

# The mock server, the S3 storage layer, and the scripts that talk to or verify
# the bucket. db.json / settings.json are gitignored on purpose - they are the
# tenant's data and travel by `npm run db:push`, not by git.
BACKEND_PATHS=(
  mock-server/server.mjs
  mock-server/store.mjs
  mock-server/reportExport.mjs
  scripts/s3-sync.mjs
  scripts/verify-sigv4.mjs
  scripts/verify-report-export.mjs
  ecosystem.config.js
  health-check.sh
  push-backend.sh
)

DRY_RUN=0
SKIP_CHECKS=0
while getopts ":ns" opt; do
  case "$opt" in
    n) DRY_RUN=1 ;;
    s) SKIP_CHECKS=1 ;;
    *) echo "usage: $0 [-n] [-s] [commit message]" >&2; exit 2 ;;
  esac
done
shift $((OPTIND - 1))

MESSAGE="${1:-}"

die() { echo "error: $*" >&2; exit 1; }

git rev-parse --git-dir >/dev/null 2>&1 || die "not a git repository"

BRANCH=$(git rev-parse --abbrev-ref HEAD)
[ "$BRANCH" = "HEAD" ] && die "detached HEAD - check out a branch first"
if [ "$BRANCH" = "main" ]; then
  die "on main. Branch first: git switch -c feature/<name>"
fi

# Anything already staged that is not backend gets in the way of a clean commit,
# so say which files rather than committing them by accident.
STAGED_OTHER=$(git diff --cached --name-only | grep -vxF -f <(printf '%s\n' "${BACKEND_PATHS[@]}") || true)
if [ -n "$STAGED_OTHER" ]; then
  echo "These non-backend files are already staged:" >&2
  echo "$STAGED_OTHER" | sed 's/^/  /' >&2
  die "unstage them (git restore --staged <file>) and run again"
fi

# Stage the backend paths that exist and actually changed.
for path in "${BACKEND_PATHS[@]}"; do
  [ -e "$path" ] && git add -- "$path"
done

CHANGED=$(git diff --cached --name-only)
if [ -z "$CHANGED" ]; then
  echo "No backend changes to push. Nothing staged."
  exit 0
fi

echo "Backend files to push:"
echo "$CHANGED" | sed 's/^/  /'
echo

# A credential in a diff is what GitHub push protection rejects, and a rejected
# push after a commit means rewriting history. Catch it here instead.
DIFF=$(git diff --cached)
if printf '%s' "$DIFF" | grep -Eq 'AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}'; then
  die "an AWS access key id is in the staged diff. Remove it - keys belong in mock-server/.env.local"
fi
if printf '%s' "$DIFF" | grep -Eq 'AWS_SECRET_ACCESS_KEY[[:space:]]*=[[:space:]]*[A-Za-z0-9/+=]{40}'; then
  die "an AWS secret access key is in the staged diff. Remove it - keys belong in mock-server/.env.local"
fi
if printf '%s' "$DIFF" | grep -Eq 'OPENAI_API_KEY[[:space:]]*=[[:space:]]*[A-Za-z0-9_-]{12}'; then
  die "an OpenAI API key is in the staged diff. Remove it - keys belong in mock-server/.env.local"
fi
if printf '%s\n' "$CHANGED" | grep -Eq '(^|/)\.env'; then
  die "an .env file is staged. Those hold credentials and are gitignored for that reason"
fi

# The two offline verifications that cover this exact surface: the S3 signature
# against AWS's published vector, and the report renderers. No bucket, no network.
if [ "$SKIP_CHECKS" -eq 0 ]; then
  echo "Running verify:sigv4 and verify:export..."
  npm run --silent verify:sigv4 || die "verify:sigv4 failed - the S3 signing is wrong, fix it before pushing"
  npm run --silent verify:export || die "verify:export failed - the report renderers are wrong, fix it before pushing"
  echo
else
  echo "Skipping verify:sigv4 / verify:export (-s)."
  echo
fi

if [ -z "$MESSAGE" ]; then
  COUNT=$(printf '%s\n' "$CHANGED" | wc -l | tr -d ' ')
  MESSAGE="Update mock server and S3 backend ($COUNT file(s))"
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo "Dry run. Would commit to '$BRANCH' with:"
  echo "  $MESSAGE"
  echo "then: git push origin $BRANCH"
  echo
  echo "Staged changes are left staged. Unstage with: git reset"
  exit 0
fi

git commit -q -m "$MESSAGE"
echo "Committed: $(git log --oneline -1)"

git push origin "$BRANCH"
echo
echo "Pushed $BRANCH. The mock server's data (db.json, settings.json) is not in git -"
echo "upload it separately with: npm run db:push"
