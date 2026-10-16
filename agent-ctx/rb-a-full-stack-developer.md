# rb-a — full-stack-developer (lib/config rebrand)

Task ID: rb-a · Round: rebrand (PraisonAI → NEXUS WebGUI) · Scope: src/lib/**, src/app/{layout,error}.tsx, src/app/api/**, manifest, package.json name, README/RESTORE/docs name-level.

## What landed
- `src/lib/migration.ts` (NEW): one-time idempotent localStorage migration. Flag `nexus-migrated-from-praison-v1`; copies `praison-*`→`nexus-*` and `praisonai.*`→`nexus.*` (only when the target key is absent); per-key try/catch; legacy keys kept (rollback); whole body guarded + SSR-safe; self-executes on import. Wired as the FIRST import of `stores.ts` and `run-archive.ts` (runs before any persist hydration / archive read).
- All localStorage keys now `nexus-*` / `nexus.*`: settings, agents, conversations, workflows, ui, relay-health, schedule-skips, free-catalog, stall-timeout-ms, stall-watchdog, tracker-cache, tracker-lastseen, run-archive.v1, run-archive.backfill.v1.
- Custom event `nexus:run-archive-updated`; pack schema `nexus.run-archive-pack.v1`; pack title `# NEXUS WebGUI Run Archive`; export footers/filenames `nexus-run-…`.
- CSRF header `x-nexus-csrf`: client sender (tools-defs.ts) + all 4 server gates (tools/execute, vault, vault/consume, tracker) — atomic, matches rb-b's component senders.
- QA globals `window.__NEXUS_QA__`, `__nexusPerfNotes`; UAs `NEXUS-WebGUI/1.0 (…; local-first agentic workflow platform)`, `PRAISON_UA`→`NEXUS_UA`, no PraisonAI repo URLs; HMAC default secret `'nexus'` (tools-defs.ts + server/tools.ts consistent).
- constants.ts: `APP_NAME`="NEXUS WebGUI", `GITHUB_URL` DELETED, intro flags → `nexus-*`, seed agent "Nexus Assistant".
- vault-merge.ts accepts BOTH `praison-provider-vault` (legacy) and `nexus-provider-vault` kinds on import.
- layout.tsx metadata + THEME_BOOT(`nexus-settings`) + ThemeProvider(`nexus-theme`); error.tsx "NEXUS WebGUI client error"; manifest name/short_name; package.json name `nexus-webgui`.
- README retitled + independence line; RESTORE / AGENT-HANDBOOK / OPERATING_DOCTRINE sed renames; handbook teaches the migration flag.

## Verification
- `bunx tsc --noEmit`: ZERO errors in owned files (only unowned `scripts/qa-agent-io.ts` broke on rb-b's component rename — logged).
- `bunx eslint` on all 37 owned files: clean.
- Residual `rg -i praison` in owned scope: only migration.ts legacy literals/flag (11) + vault-merge.ts legacy kind (3) — all sanctioned. src/app fully clean.

## Handoffs
1. rb-b: remove `GITHUB_URL` imports in `components/nexus/shell.tsx` + `settings-view.tsx` (export deleted).
2. Owner: `scripts/qa-agent-io.ts` stale `components/praison` import (scripts untouched by directive).
3. Owner: RESTORE.md old-org clone URL left as-is (sed-only scope).
4. Ops: dev server stopped listening on :3000 late in the round after successfully compiling these changes — not restarted per directive.

Full details: worklog.md entry "Task ID: rb-a".
