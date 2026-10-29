# Pushing `feature/quest-tracking` to github.com/paperlinguist/osrs-pathfinder

Two ways to get the branch onto GitHub. **Option A keeps the 16 clean commits**
(recommended, ~1 minute). Option B squashes everything into one commit from
the tarball. Both end with the same branch on GitHub.

---

## Option A — git bundle (preserves commit history)

The `.bundle` file is a portable pack of the 16 feature commits on top of
`main` (7fa46ad). Your clone already has that base, so:

```bash
git clone https://github.com/paperlinguist/osrs-pathfinder.git
cd osrs-pathfinder

git fetch /path/to/osrs-pathfinder-quest-tracking.bundle \
  feature/quest-tracking:feature/quest-tracking

git push origin feature/quest-tracking
```

(If you already have a clone: skip the `git clone`, just run the
`git fetch` + `git push` inside it.)

---

## Option B — tarball (single squashed commit)

```bash
git clone https://github.com/paperlinguist/osrs-pathfinder.git
cd osrs-pathfinder
git checkout -b feature/quest-tracking

# extract over the checkout (tar has an osrs-pathfinder/ prefix):
tar -xzf /path/to/osrs-pathfinder-feature-quest-tracking.tar.gz \
  --strip-components=1 -C .

# the branch deletes the stale z.ai logo — make that stick:
git rm -f public/logo.svg 2>/dev/null || rm -f public/logo.svg

git add -A
git commit -m "Quest tracking v0.4.0: completions page, RuneLite import, multi-target XP cascades, merged skill gates, full-graph PNG export, version footer"
git push -u origin feature/quest-tracking
```

---

## Open the PR

https://github.com/paperlinguist/osrs-pathfinder/compare/main...feature/quest-tracking

Ready-to-paste:

**Title:**
```
Quest tracking v0.4.0: completions page, RuneLite import, multi-target XP cascades, merged skill gates, full-graph export
```

**Body:**
```markdown
## What's in this PR

**Quest planning**
- Track multiple target quests at once; plans cascade XP requirements through prereqs
- "Gated by training" counts now include skills behind the final quest in a chain
  (e.g. Lunar Diplomacy's training gates were previously not counted)
- Dotted red XP-cascade edges run from quests to the skill gates they unlock;
  endpoints attach along the diamond's upper edges / top vertex, with an 18px
  minimum attachment length from the tip (interior arrowheads no longer crowd
  the diamond vertex in heavy configurations) and spread widened to 36px
- **One training diamond per skill across the whole board**: tracking a quest at
  Crafting 49 and another at 61 now shows a single "Crafting 61" diamond instead
  of two separate blocks — edge labels show the level each quest needs ("49" /
  "61"), the diamond lists lower tiers in-node, and the tooltip breaks the grind
  down per tier (level, quest, deficit, XP) with a combined total. XP cascades
  converge on the shared diamond, and the training-summary badge totals the
  whole skill (e.g. "Crafting 61 — train 50 lvls (~395,037 XP)")

**Character completions page (`/completions`)**
- Dedicated page to bulk set/unset quest completions per character
- Quest completion + total quest points saved in the character backup
  (backup format v2, auto-migrates v1)
- Removed "Reset all completion tracking" button
- **Character ↔ completions lifecycle**: closing a character flushes the whole
  session (skills, targets, completions — the completions page goes blank),
  loading a character reloads its completions, live progress auto-syncs into
  the active slot, and the character **export** now contains real completions
  (previously it dumped stale/empty data). New "Close" button beside "Save current"

**RuneLite import**
- Import Quest State Exporter JSON with merge or sync apply, plus a preview
  (RSN, export time, finished / in-progress counts, quest points, unmatched warnings)
- Step-by-step plugin install instructions and where the JSON lives on disk
  (Plugin Hub -> "Quest State Exporter"; writes `~/.runelite/quest-state-exporter/<RSN>.json`)
- Parser maps plugin enum ids 1:1 to app quests (verified 214/214 against a real export)

**Export / branding / ops**
- PNG export frames the ENTIRE graph (not just the viewport), scaled to canvas limits
- Favicon is the quest-point medallion matching the header tile (icon.png + apple-icon.png);
  z.ai logo removed
- Footer shows app version + deployed build SHA (`v0.4.0 · build <sha>`), baked via
  Docker build-args so GHCR images are identifiable
- Version bumped to v0.4.0 for this release (package.json + footer stay in lockstep)

## Notes
- Merge is gated by the branch ruleset: the `build-and-push` check must pass before merge.
  This PR also fixes that check: the workflow now triggers on `pull_request` (it previously
  never ran on PRs), pins the Buildx builder explicitly, and uses registry inline cache —
  the `type=gha` cache export started failing ("Cache export is not supported for the
  docker driver") after a GitHub runner image update
- Removes the redundant `ci.yml` PR workflow — its docker step still used `type=gha`
  cache without a Buildx setup (that was the failing run), and `docker-publish.yml`
  now provides the same PR validation plus the required `build-and-push` check
- After merge: `bash setup.sh` on the server pulls the new image and recreates the
  container; the footer SHA should match the merge commit

## Testing
- `bun run build` clean; smoke-tested `/` and `/completions` (footer, RuneLite
  instructions, favicon all render)
- Import verified against a real Quest State Exporter file
- Merged-gate behavior verified end-to-end in a browser: Crafting 49 + 61
  targets render one diamond with tier labels, converging XP cascade, and
  merged training totals
- Graph layout follows the layered-layout standards (ELK layered / dagre /
  graphviz dot) for spacing; routed corridors kept 34px apart so edge labels
  no longer collide, and labels fade out below 0.5 zoom (semantic zoom) so
  fit-out views of large plans stay readable
- Fixed duplicate gate edges when a tracked target is also another target's
  prerequisite (RFD requires Desert Treasure I): the quest was fed into its
  skill gates twice, rendering doubled dashed edges + duplicate React keys
- Fixed a crash on legacy character saves: players saved before the `xp` field
  existed (or hand-edited saves) threw `Cannot read properties of undefined
  (reading 'Herblore')` on load. All player JSON from localStorage, character
  slots and backup files is now normalized before use (levels/xp guaranteed
  to be objects with numeric values)
```

---

## After merge — deploy the new version

```bash
IMAGE=ghcr.io/paperlinguist/osrs-pathfinder:latest bash setup.sh
```

The footer on the site will read `v0.4.0 · build <short-sha>` so you can always
confirm what's deployed (the SHA matches the GHCR `sha-*` image tag).
