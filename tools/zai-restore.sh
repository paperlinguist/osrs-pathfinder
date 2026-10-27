#!/usr/bin/env bash
# ============================================================================
# zai-restore.sh — run at the START of a z.ai chat session.
# Makes the workspace match the latest `main` on GitHub (source of truth).
#
#   bash tools/zai-restore.sh https://github.com/YOUR_USERNAME/osrs-pathfinder.git
#
# - Works on a fresh workspace (no .git yet) OR a stale one (old history).
# - Preserves untracked workspace dirs (download/, upload/, worklog.md, ...).
# - Runs `bun install` afterwards so dev/build work immediately.
# ============================================================================
set -euo pipefail

REPO_URL="${1:-${REPO_URL:-}}"
TARGET="${2:-/home/z/my-project}"

if [[ -z "$REPO_URL" ]]; then
  echo "usage: $0 <github-repo-url> [target-dir=/home/z/my-project]" >&2
  exit 1
fi

cd "$TARGET"

# Wire up (or re-point) the git remote without touching untracked files
if [[ ! -d .git ]]; then
  git init -q
  echo "==> Initialized fresh git repo in $TARGET"
fi
git remote remove origin 2>/dev/null || true
git remote add origin "$REPO_URL"

echo "==> Fetching origin/main from $REPO_URL"
git fetch -q --depth 50 origin main
git checkout -q -f -B main FETCH_HEAD
echo "==> Workspace now at main ($(git rev-parse --short HEAD))"

# Reconcile dependencies
if command -v bun >/dev/null 2>&1; then
  echo "==> bun install"
  bun install
else
  echo "NOTE: bun not found in this environment — run 'bun install' before dev/build." >&2
fi

echo "==> Done. Untracked dirs (download/, upload/, worklog.md, ...) were preserved."
