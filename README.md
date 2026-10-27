# OSRS Quest Pathfinder

OSRS prerequisite planner — track one or more target quests and get the optimal
prerequisite chain: quest order, skill gaps with training gates, boost flags,
XP and playtime estimates, quest-XP coverage (with visual XP-cascade edges),
character import via the OSRS hiscores / Wise Old Man, and a dedicated page for
bulk-setting your quest completions.

215 quests · data: [wvanderp/osrs-db](https://github.com/wvanderp/osrs-db) (MIT) + [OSRS Wiki](https://oldschool.runescape.wiki/)

Fully stateless: no database, no accounts — all player progress lives in each
visitor's browser (with export/import character backups in-app).

---

## Using the app

- **Track multiple targets** — the target picker *adds* quests instead of
  replacing one; selected targets show as removable chips and the planner
  resolves one merged, topologically-ordered prerequisite tree for all of them
  (Quest Cape mixes fine with regular quests).
- **Completions page** (`/completions`) — search/filter all 215 quests and
  bulk-set or unset what you've already finished (with a live quest-points
  tally). The planner reads the same saved progress; the old reset-everything
  button is gone — unchecking on this page is the deliberate way to do that.
- **Import from RuneLite** — on the completions page, upload the JSON written
  by the [Quest State Exporter](https://runelite.net/plugin-hub/show/quest-state-exporter)
  Plugin Hub plugin to set every finished quest in one go (step-by-step setup
  instructions included on the page). **Add** marks the file's FINISHED quests;
  **Sync** also unchecks everything the file says isn't finished (quests the
  plugin doesn't track are left untouched).
- **Full-graph PNG export** — the graph's PNG button downloads the *entire*
  plan, not just the visible viewport; huge graphs (e.g. Quest Cape) are
  scaled down just enough to fit inside browser canvas limits.
- **Build identity in the footer** — every page footer shows the app version
  and the short commit SHA it was built from (matching the `sha-xxxxxxx` GHCR
  image tag), so you can always tell what's actually deployed.
- **Quest-XP cascades** — in the graph view, a thin dotted red edge runs from
  any quest whose XP reward raises a skill down to the next node needing that
  skill. It points at the quest itself when the level-up is enough to complete
  it (labelled e.g. `Herblore 3→9`), or at its training-gate diamond when the
  level-up helps but isn't enough (e.g. `Magic 14` against the `65` gate).
  Assumes you can complete the granting quest (its own requirement is your
  starting level).
- **Backups (v2)** — the Backup dialog and per-character exports now include
  your tracked targets and a total-quest-points figure (1 QP per quest,
  miniquests/activities 0). v1 files import unchanged.
- **"Gated by training"** counts every quest in the path whose skill levels
  need real grinding — including the target quest itself (e.g. Lunar
  Diplomacy's own 65 Magic now shows up).

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
