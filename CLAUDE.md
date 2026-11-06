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
  `npx next dev -p 3000` for the dev server, `npx tsc --noEmit` to typecheck.
- `package-lock.json` and `AGENTS.md` (Next dev artifact) are gitignored on
  purpose; `bun.lock` is the committed lockfile.

## PR flow

- Branch per feature off `origin/main`, PR with `gh pr create` (merge order
  matters for stacked branches — note it in the PR body), merge with
  `gh pr merge <n> --merge` (merge commits, matching repo history). CI
  (build-and-push) must be green.
- User-facing copy changes ship alongside their feature; big data-curation
  batches keep their own commits.
