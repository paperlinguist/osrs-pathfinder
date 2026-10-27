# OSRS Quest Pathfinder

OSRS prerequisite planner — pick any quest (or classic endgame goal) and get the
optimal prerequisite chain: quest order, skill gaps with training gates, boost
flags, XP and playtime estimates, quest-XP coverage, and character import via
the OSRS hiscores / Wise Old Man.

215 quests · data: [wvanderp/osrs-db](https://github.com/wvanderp/osrs-db) (MIT) + [OSRS Wiki](https://oldschool.runescape.wiki/)

Fully stateless: no database, no accounts — all player progress lives in each
visitor's browser (with export/import character backups in-app).

---

## Self-host (plain `docker run`)

Images are published to GHCR by GitHub Actions on every push to `main`
(tags: `latest`, `sha-<hash>`, and semver on `v*` releases).

### 1. Install / update on your server (one command)

```bash
curl -fsSL https://raw.githubusercontent.com/YOUR_GITHUB_USERNAME/osrs-pathfinder/main/setup.sh \
  | IMAGE=ghcr.io/YOUR_GITHUB_USERNAME/osrs-pathfinder:latest bash
```

Or clone first if you prefer:

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/osrs-pathfinder.git
cd osrs-pathfinder
IMAGE=ghcr.io/YOUR_GITHUB_USERNAME/osrs-pathfinder:latest bash setup.sh
```

The script: pulls the image → recreates the container (`--restart unless-stopped`,
loopback-only `127.0.0.1:3001`) → waits for the built-in healthcheck → smoke-tests
homepage + API. **Re-running it later = update to the latest build.**

`PORT=3015` / `NAME=anything` env vars override defaults.

### 2. One-time nginx + Cloudflare

- `nginx/osrs-pathfinder.conf` — ready server block for `osrs-pathfinder.abifin.org`
  (Cloudflare real-IP notes included; commented 443 block for origin-cert / Full-strict TLS).
- Cloudflare DNS: `A` record `osrs-pathfinder` → your server IP, proxied.

### 3. Verify

```bash
docker ps                       # osrs-pathfinder … Up (healthy)
docker logs osrs-pathfinder     # no errors
```

Then open `https://osrs-pathfinder.abifin.org`, import a username, pick a goal.

---

## How releases work

| Event | Result |
|---|---|
| Push to `main` | GH Actions builds image → `ghcr.io/<owner>/osrs-pathfinder:latest` + `:sha-<hash>` |
| Tag `v1.2.3` | also published as `:1.2.3` and `:1.2` |
| Pull request | **CI runs** (bun install → production build → docker image build, no push) |
| Server re-run of `setup.sh` | pulls `latest`, recreates container (zero-downtime-ish; seconds) |

**First publish only:** open the repo → *Packages* → the new `osrs-pathfinder`
package → *Package settings* → change visibility to **Public** (GHCR creates
packages private by default). After that, `docker pull` needs no login.

---

## Editing from z.ai chats — the PR-based CI/CD loop

GitHub is the **single source of truth**; z.ai chat sessions act as your IDE.
No more .tar backup shuffling between chats:

```
z.ai chat session ──tools/zai-make-pr.sh──▶ GitHub PR ──CI──▶ merge ──publish workflow──▶ GHCR :latest ──setup.sh──▶ server
```

**1. Start of a session** — ask the assistant to restore latest main:

```bash
bash tools/zai-restore.sh https://github.com/YOUR_USERNAME/osrs-pathfinder.git
```
Checks out latest `main` into the workspace (fresh *or* stale workspaces both work,
untracked stuff like `download/` is preserved) and runs `bun install`.

**2. During the session** — edit, run the dev server, verify, iterate as usual.

**3. End of a session** — package the changes as a PR:

```bash
bash tools/zai-make-pr.sh "feat: add hardcore ironman filter"
```
- Default mode: produces `pr-zai-*.bundle` + `push-pr-commands.sh`. Move both to any
  machine with GitHub credentials (your server is fine) and run `bash push-pr-commands.sh`
  → branch pushed, compare URL printed, click to open the PR.
- Power mode: `GH_TOKEN=<fine-grained PAT>` in front of the same command pushes the
  branch and opens the PR directly from the session. Use a **short-expiry,
  minimal-scope** token (Contents: read/write + Pull requests: read/write) and never
  commit it.

**4. CI on every PR** — `.github/workflows/ci.yml` validates the build end-to-end:
dependencies → production build → docker image build (no push). Merge with confidence.

**5. Merge to `main`** — `docker-publish.yml` publishes `:latest` (plus sha tag)
to GHCR automatically.

**6. Deploy** — either re-run `setup.sh` on the server, or install the optional
auto-updater (checks hourly, recreates the container only when a new image exists):

```bash
# on the server, after cloning the repo to /opt/osrs-pathfinder
crontab -e
17 * * * * IMG=ghcr.io/YOUR_USERNAME/osrs-pathfinder:latest bash /opt/osrs-pathfinder/tools/auto-update.cron.sh >> /var/log/osrs-pathfinder-update.log 2>&1
```

**Branch protection (recommended):** Settings → Branches → Add branch rule for
`main` → *Require a pull request before merging* + *Require status checks* →
select **Build & validate**. Now nothing reaches the published image unreviewed/unbuilt.

## Build the image yourself (optional)

```bash
docker build -t osrs-pathfinder:local .
docker run -d --name osrs-pathfinder -p 127.0.0.1:3001:3000 --restart unless-stopped osrs-pathfinder:local
```

## Local development

```bash
bun install
bun run dev        # http://localhost:3000
bun run build      # production build (standalone output)
```
