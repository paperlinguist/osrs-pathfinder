#!/usr/bin/env bash
# ============================================================================
# zai-make-pr.sh — run at the END of a z.ai chat session to publish changes.
#
#   bash tools/zai-make-pr.sh "feat: describe your change"
#
# Two modes:
#   Default : creates branch + pr-zai-*.bundle + push-pr-commands.sh
#             -> run push-pr-commands.sh on any machine with GitHub creds.
#   GH_TOKEN: if the GH_TOKEN env var is set (fine-grained PAT, short expiry,
#             contents:write + pull-requests:write), the script pushes and
#             opens the PR directly from this session.
#
# Never committed: node_modules, download/, upload/, worklog.md and other
# workspace-only dirs.
# ============================================================================
set -euo pipefail

TARGET="${TARGET:-/home/z/my-project}"
MSG="${1:-Changes from z.ai session $(date +%F)}"

cd "$TARGET"
command -v git >/dev/null || { echo "ERROR: git not found" >&2; exit 1; }
git remote get-url origin >/dev/null 2>&1 || {
  echo "ERROR: no origin remote. Run tools/zai-restore.sh first." >&2; exit 1;
}

# Stage everything except workspace-only paths
# (node_modules/.next/logs are handled by .gitignore — do NOT list ignored
#  paths here: an explicit ':!ignored' pathspec makes `git add` error out.)
if git diff --quiet HEAD 2>/dev/null && git diff --cached --quiet 2>/dev/null && [[ -z "$(git ls-files --others --exclude-standard | head -1)" ]]; then
  echo "No changes to commit — workspace matches HEAD."
  exit 0
fi

# Create the PR branch FIRST so the commit never lands on local main
SLUG="$(printf '%s' "$MSG" | tr -c 'a-zA-Z0-9' '-' | tr -s '-' | sed 's/^-*//;s/-*$//' | cut -c1-24)"
BRANCH="zai/$(date +%Y%m%d)-${SLUG:-session}"
git checkout -q -B "$BRANCH"
echo "==> On branch $BRANCH"

EXCLUDES=(download upload skills scripts tool-results tests examples .zscripts db prisma worklog.md .env)
ADD_SPECS=(.)
for e in "${EXCLUDES[@]}"; do ADD_SPECS+=(":!$e"); done
git add -A "${ADD_SPECS[@]}"

if git diff --cached --quiet; then
  git checkout -q main 2>/dev/null || true
  echo "No repo changes to commit (only workspace-only files differ)."
  exit 0
fi
git commit -q -m "$MSG"
echo "==> Committed ($(git rev-parse --short HEAD))"

REPO_URL="$(git remote get-url origin)"
REPO_PATH="${REPO_URL#*github.com[:/]}"
REPO_PATH="${REPO_PATH%.git}"

if [[ -n "${GH_TOKEN:-}" ]]; then
  echo "==> GH_TOKEN present — pushing and opening the PR from this session"
  git push -q "https://x-access-token:${GH_TOKEN}@github.com/${REPO_PATH}.git" "$BRANCH"
  SAFE_TITLE="${MSG//\"/\\\"}"
  RESP="$(curl -s -X POST \
    -H "Authorization: Bearer ${GH_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${REPO_PATH}/pulls" \
    -d "{\"title\":\"${SAFE_TITLE}\",\"head\":\"${BRANCH}\",\"base\":\"main\",\"body\":\"Changes made and verified in a z.ai session.\"}")"
  PR_URL="$(printf '%s' "$RESP" | grep -o '"html_url": *"[^"]*pull/[0-9][^"]*"' | head -1 | cut -d'"' -f4)"
  echo "==> PR opened: ${PR_URL:-<see https://github.com/${REPO_PATH}/pulls>}"
  echo "    Merge it, then re-run setup.sh on the server to deploy."
else
  BUNDLE="pr-$(echo "$BRANCH" | tr '/' '-').bundle"
  git bundle create "$BUNDLE" "$BRANCH"
  cat > push-pr-commands.sh <<EOF
#!/usr/bin/env bash
# Run on any machine with push access to ${REPO_PATH} (server or laptop),
# from the directory containing $BUNDLE:
set -euo pipefail
cd "\$(dirname "\$0")"
git clone --quiet "https://github.com/${REPO_PATH}.git" /tmp/osrs-pr-push 2>/dev/null || true
cd /tmp/osrs-pr-push && git fetch origin --quiet && git checkout -q main && git pull -q
git fetch --quiet "$(printf '%s' "${BUNDLE}")" "${BRANCH}:${BRANCH}"
git push -q origin "${BRANCH}"
echo "Branch pushed. Open the PR at:"
echo "  https://github.com/${REPO_PATH}/compare/main...${BRANCH}"
EOF
  chmod +x push-pr-commands.sh
  echo "==> Created: $BUNDLE + push-pr-commands.sh"
  echo "    1) Download both files from this session"
  echo "    2) Put them in one folder on a machine with GitHub credentials"
  echo "    3) bash push-pr-commands.sh   → then open the printed compare URL"
fi
