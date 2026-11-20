#!/usr/bin/env bash
# Shared by deploy-frontend.sh and deploy-backend.sh — one definition of "is it safe to pull".
#
# Not meant to be run on its own: `source` it, `cd` into the repo first, then call `safe_pull`.
#
# **The question it asks, and why it is not "is the tree dirty".** `backend/*.json` on this box
# is always dirty — it's live demo data the running server writes to on every registration,
# settings change and profiling run — so a rule that skips pulling on any dirty file is a
# permanent skip here, which is the bug the first version of deploy-frontend.sh had. The real
# question is narrower: **would the incoming commits touch any file that is dirty right now?**
# Fetch, diff the two file lists, and pull only when they don't overlap. A genuine collision
# (someone's commit landing on the same `backend/*.json` the live server just wrote) is still
# refused, named, and left for a human to resolve by hand.
#
# **Every git call goes through sudo**, because the checkout is root-owned — `git fetch`
# otherwise fails on `.git/FETCH_HEAD: Permission denied`, which looks like a network problem
# and is not one.

git_branch() { sudo git rev-parse --abbrev-ref HEAD; }

# Returns 0 and leaves HEAD fast-forwarded (or unchanged, if already current) when it is safe
# to proceed; returns 1 and changes nothing when the incoming commits collide with a dirty file.
safe_pull() {
  sudo git fetch origin --quiet

  local branch remote_ref incoming_files dirty_files overlap
  branch="$(git_branch)"
  remote_ref="origin/$branch"

  incoming_files="$(sudo git diff --name-only HEAD "$remote_ref" -- 2>/dev/null || true)"
  dirty_files="$(sudo git status --porcelain=v1 --untracked-files=no | cut -c4- || true)"

  if [ -z "$incoming_files" ]; then
    echo "    Already up to date with $remote_ref — nothing to pull."
    return 0
  fi

  if [ -z "$dirty_files" ]; then
    echo "==> Working tree is clean — fast-forwarding to $remote_ref…"
    sudo git merge --ff-only "$remote_ref"
    return 0
  fi

  overlap="$(comm -12 <(printf '%s\n' "$incoming_files" | sort) <(printf '%s\n' "$dirty_files" | sort))"
  if [ -z "$overlap" ]; then
    echo "==> Incoming commits don't touch any currently-dirty file — fast-forwarding to $remote_ref…"
    echo "    (left alone, dirty from live use):"
    printf '%s\n' "$dirty_files" | sed 's/^/      /'
    sudo git merge --ff-only "$remote_ref"
    return 0
  fi

  echo "    Incoming commits touch file(s) that are dirty right now — refusing to pull:"
  printf '%s\n' "$overlap" | sed 's/^/      /'
  echo "    Resolve by hand (commit, stash, or discard the local change) and re-run."
  return 1
}
