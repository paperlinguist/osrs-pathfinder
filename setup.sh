#!/usr/bin/env bash
# ============================================================================
# OSRS Quest Pathfinder — server install / update script (plain `docker run`)
#
# Usage on the server:
#   IMAGE=ghcr.io/YOUR_GITHUB_USERNAME/osrs-pathfinder:latest bash setup.sh
#
# Or one-liner (after the image is public on GHCR):
#   curl -fsSL https://raw.githubusercontent.com/YOUR_GITHUB_USERNAME/osrs-pathfinder/main/setup.sh \
#     | IMAGE=ghcr.io/YOUR_GITHUB_USERNAME/osrs-pathfinder:latest bash
#
# Re-running the same command = pull latest + recreate container (an update).
# Optional env overrides: PORT (host loopback port, default 3001),
#                         NAME (container name, default osrs-pathfinder)
# ============================================================================
set -euo pipefail

IMAGE="${IMAGE:-ghcr.io/YOUR_GITHUB_USERNAME/osrs-pathfinder:latest}"
NAME="${NAME:-osrs-pathfinder}"
PORT="${PORT:-3001}"

if [[ "$IMAGE" == *"YOUR_GITHUB_USERNAME"* ]]; then
  echo "ERROR: IMAGE still contains the placeholder." >&2
  echo "Run with:  IMAGE=ghcr.io/<your-github-username>/osrs-pathfinder:latest bash setup.sh" >&2
  exit 1
fi

command -v docker >/dev/null || { echo "ERROR: docker not installed" >&2; exit 1; }
command -v curl   >/dev/null || { echo "ERROR: curl not installed (apt install curl)" >&2; exit 1; }

echo "==> Pulling $IMAGE"
docker pull "$IMAGE"

echo "==> Removing previous container (if any)"
docker rm -f "$NAME" >/dev/null 2>&1 || true

echo "==> Starting container '$NAME' (loopback 127.0.0.1:${PORT} -> container 3000)"
docker run -d \
  --name "$NAME" \
  --restart unless-stopped \
  -p "127.0.0.1:${PORT}:3000" \
  "$IMAGE"

echo "==> Waiting for the built-in healthcheck to turn healthy"
healthy=""
for _ in $(seq 1 30); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$NAME" 2>/dev/null || echo starting)"
  if [[ "$status" == "healthy" ]]; then healthy=1; break; fi
  sleep 2
done
if [[ -z "$healthy" ]]; then
  echo "WARNING: healthcheck not healthy yet — check: docker logs $NAME" >&2
fi

echo "==> Smoke test"
code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/" || true)"
if [[ "$code" == "200" ]]; then
  echo "    OK: homepage answers HTTP $code"
else
  echo "    ERROR: expected HTTP 200 on loopback, got '$code'" >&2
  echo "    Debug: docker logs $NAME" >&2
  exit 1
fi
api="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/api/player?username=Zezima" || true)"
echo "    /api/player probe: HTTP $api (200 = hiscores reachable)"

cat <<DONE

============================================================
 Installed. Remember the two one-time steps if not yet done:

 1) nginx server block (this repo: nginx/osrs-pathfinder.conf)
      sudo cp nginx/osrs-pathfinder.conf /etc/nginx/sites-available/
      sudo ln -s /etc/nginx/sites-available/osrs-pathfinder.conf /etc/nginx/sites-enabled/
      sudo nginx -t && sudo systemctl reload nginx
      (set proxy_pass to http://127.0.0.1:${PORT} if you changed PORT)

 2) Cloudflare DNS: A record  osrs-pathfinder  ->  your server IP (proxied)

 Update to the latest published build anytime by re-running this script.
============================================================
DONE
