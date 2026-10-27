#!/usr/bin/env bash
# ============================================================================
# auto-update.cron.sh — server-side optional auto-deploy.
# Recreates the container ONLY when a newer image was published to GHCR.
#
# Install on the server:
#   1) edit IMG below (or export IMG in the crontab line)
#   2) crontab -e  ->  17 * * * * /opt/osrs-pathfinder/tools/auto-update.cron.sh >> /var/log/osrs-pathfinder-update.log 2>&1
#
# Note: each update recreates the container (a few seconds of downtime) —
# fine for a personal tool; remove the cron if you prefer manual setup.sh runs.
# ============================================================================
set -euo pipefail

IMG="${IMG:-ghcr.io/YOUR_GITHUB_USERNAME/osrs-pathfinder:latest}"
NAME="${NAME:-osrs-pathfinder}"
SETUP_DIR="${SETUP_DIR:-/opt/osrs-pathfinder}"   # directory containing setup.sh

OLD="$(docker inspect -f '{{.Image}}' "$NAME" 2>/dev/null || echo none)"
docker pull -q "$IMG" >/dev/null
NEW="$(docker inspect -f '{{.Id}}' "$IMG")"

if [[ "$OLD" != "$NEW" ]]; then
  echo "$(date '+%F %T') new image detected -> recreating container"
  IMAGE="$IMG" NAME="$NAME" bash "$SETUP_DIR/setup.sh"
else
  echo "$(date '+%F %T') already up to date"
fi
