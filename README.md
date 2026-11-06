# OSRS Quest Pathfinder

OSRS progress planner — two tools in one, sharing one imported character:

- **Quest planner** — track one or more target quests and get the optimal
  prerequisite chain: quest order, skill gaps with training gates, boost flags,
  XP and playtime estimates, quest-XP cascades (visual XP-flow edges), and a
  dedicated page for bulk-setting your quest completions.
- **Boss gear planner** (`/bosses`) — readiness verdicts and budget-tier
  loadouts for **29 bosses**, checked against your imported character, bank and
  worn equipment, with an upgrade advisor for what to buy next.

215 quests · 29 bosses · data: [wvanderp/osrs-db](https://github.com/wvanderp/osrs-db) (MIT) + [OSRS Wiki](https://oldschool.runescape.wiki/)

Fully stateless: no database, no accounts — all player progress lives in each
visitor's browser (with export/import character backups in-app).

---

## Using the app

- **Track multiple targets** — the target picker *adds* quests instead of
  replacing one; selected targets show as removable chips and the planner
  resolves one merged, topologically-ordered prerequisite tree for all of them
  (Quest Cape mixes fine with regular quests). "Barrows Gloves (RfD)" tracks
  the full Recipe for Disaster subquest chain in one click.
- **Completions page** (`/completions`) — search/filter all 215 quests and
  bulk-set or unset what you've already finished (with a live quest-points
  tally). The planner reads the same saved progress; the old reset-everything
  button is gone — unchecking on this page is the deliberate way to do that.
- **Import from RuneLite** — the [Character Export](https://runelite.net/plugin-hub/show/character-export)
  Plugin Hub plugin writes JSON files of your character (skills, quests, bank,
  worn equipment, inventory) as you play. Upload them anywhere the app offers a
  file picker — one upload covers skills, quest completions and the boss
  planner's owned-items pool. Parsed **client-side only**, never uploaded.
  The older [Quest State Exporter](https://runelite.net/plugin-hub/show/quest-state-exporter)
  quest file is still auto-detected on the completions page (**Add** marks its
  FINISHED quests; **Sync** also unchecks everything it says isn't finished).
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
- **Boss gear planner** (`/bosses`) — every boss's required + recommended
  stats, quest gates and combat-style loadouts in budget tiers, checked against
  your imported character. Each item shows equip/quest locks (`Defence 65 → 70`,
  `quest: Underground Pass`), an owned badge (bank **and worn** equipment), its
  GE price, and a cheapest-first shopping list against your imported coin pile.
  Search, a ready / not-yet filter, and a tier filter keep the roster navigable;
  clicking a boss scrolls to its loadouts.
- **Upgrade advisor** — a cross-boss "what should I buy next" view: every
  preset item you don't own is scored (attack + damage bonus, compared against
  your best owned item per slot/style) and grouped into buy-now / save-up /
  earn-in-game / locked, biggest gain first. Reachable from the header.
- **Planned-quest states** — any quest already on your quest plan (a tracked
  target *or* a prerequisite step) shows a green ✓ **planned** next to its name
  on the boss page, instead of **plan it**, and still links back to the plan.
- **Backups (v3)** — backups and per-character exports carry skills, quest
  completions, tracked targets, and the boss planner's imported items across
  devices and account switches; v1/v2 files import unchanged.
- **Regression test suite** — Vitest covers the planning logic and a data-
  integrity suite (quest/skill/item reference validity, F2P-preset cleanliness)
  runs on every PR alongside the Docker build.
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
| Pull request | **CI runs** (regression tests + production build → docker image build, no push) |
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
bun install        # CI/Docker use bun (bun.lock)
bun run dev        # http://localhost:3000
bun run build      # production build (standalone output)
bun test           # regression suite (Vitest) — also works via `npm test`
```

On a machine without bun, `npm install && npx next dev -p 3000` works; keep
`bun.lock` in sync (`bun install`) after adding dependencies, since the Docker
build installs with `--frozen-lockfile`.

## AI disclosure

This project is developed with **substantial AI assistance** — Claude Code
(Anthropic) driving the z.ai chat workflow described above. AI is used for
implementation, documentation, and for drafting the curated content:

- **Boss/quest data is AI-drafted, then human-verified.** Presets, requirement
  facts and notes in `src/data/bosses.json` were assembled by AI and checked
  against the OSRS Wiki before merge; where the underlying cache data (osrs-db)
  was wrong or missing, wiki-verified overrides are tagged per-item in the
  generated `gear.json` for audit.
- **Generated files come from committed scripts.** `src/data/gear.json` is the
  output of `tools/build-gear.ts` over the MIT-licensed osrs-db dataset and the
  Jagex item DB — never hand-edited.
- **PRs are labelled AI-generated** (the Claude Code attribution in their
  descriptions), and every page footer shows the exact build SHA for provenance.

Game-data accuracy is best-effort: the app links every quest, boss and item to
its OSRS Wiki page, so treat in-game numbers as authoritative.
