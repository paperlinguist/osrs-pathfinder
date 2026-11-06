# CLAUDE.md

Notes for Claude Code sessions working in this repo.

## Version bumps — every feature PR

Every user-facing feature PR bumps the app version, **in the same PR as the feature**:

- `src/lib/version.ts` → `APP_VERSION`
- `package.json` → `version`

Keep them in sync (the comment in `version.ts` says the same). Scheme:
- **Minor** (`0.6.0 → 0.7.0`) for a feature wave / new page / new planner capability
- **Patch** (`0.7.0 → 0.7.1`) for fixes and small tweaks when it matters

The footer on every page shows `v{APP_VERSION} · {APP_BUILD}` — that's how users
tell what's deployed, so a merged feature without a bump is a regression of the
build-identity feature. Commit style used in the past: `chore: bump app version
to vX.Y.Z` (optionally append `(vX.Y.Z)` to the feature commit title instead).

## Boss planner data pipeline

- `src/data/bosses.json` is **hand-curated** (presets, requirements, notes).
  Verify requirement claims against the OSRS Wiki before adding them
  (`https://oldschool.runescape.wiki/api.php?action=parse&page=<Name>&prop=wikitext&format=json`).
- Item stats/requirements/prices are **generated**: after changing preset item
  lists, run `node tools/build-gear.ts` to regenerate `src/data/gear.json`.
  It needs the osrs-db downloads in `.data-cache/` (gitignored — see the script
  header for sources) and caches GE prices in `.data-cache/prices.json`.
- osrs-db's cache requirements occasionally lie or go missing — wiki-verified
  overrides live in `REQ_OVERRIDES` inside `tools/build-gear.ts`; each override
  is tagged in the generated data for audit. Add one there, never by editing
  `gear.json` by hand.
- Quest keys referenced by bosses (`requirements.quests`, item `reqQuests`)
  must match `src/data/quests.json` keys exactly — the build script fails
  loudly on unknown preset items; quest keys are checked at render time only.

## Local development

- `bun` is the CI package manager, but this Windows machine uses npm —
  `npx next dev -p 3000` for the dev server, `npx tsc --noEmit` to typecheck,
  `npm test` / `npx vitest run` for the test suite.
- `package-lock.json` and `AGENTS.md` (Next dev artifact) are gitignored on
  purpose; `bun.lock` is the committed lockfile. After adding a dependency via
  npm, run `npx --yes bun install` to sync `bun.lock` — the Docker build uses
  `bun install --frozen-lockfile` and CI will fail otherwise.

## README & docs maintenance

Keep `README.md` in lockstep with the code — it's the public description of
what the app does. Update it in the same PR as the change:

- **Boss batch** → bump the "· X bosses" count on the intro line, and add a
  feature bullet only if a *capability* changed (e.g. a new filter), not for
  each boss.
- **New page / feature / import-flow change** → add/adjust a bullet under
  "Using the app", and refresh the intro paragraph if it changes what the app
  fundamentally is (e.g. "two tools in one").
- **Quest dataset regeneration** → update the "· X quests" count if it moved.
- **CI / release workflow change** → update the "How releases work" table.
- **New/changed scripts** → update "Local development" commands.
- **AI-disclosure section** → keep it accurate if the provenance story changes
  (e.g. a new data source).

Rule of thumb: if a user reading the README would be misled about a shipped
feature, the README is out of date and should go in that same PR.

## PR flow

- Branch per feature off `origin/main`, PR with `gh pr create` (merge order
  matters for stacked branches — note it in the PR body), merge with
  `gh pr merge <n> --merge` (merge commits, matching repo history). CI
  (build-and-push) must be green.
- User-facing copy changes ship alongside their feature; big data-curation
  batches keep their own commits.
