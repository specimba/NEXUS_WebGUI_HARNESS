# Task r26-4 — full-stack-developer — Pipeline depth control + Trend Radar view

## Files changed

**Feature C — Pipeline depth control (quick / standard / deep + verification pass)**
- `src/lib/types.ts` — `PipelineDepth` type; `Workflow.depth?: PipelineDepth`; `WorkflowRunStep.instruction?` (synthetic-pass focus) + `WorkflowRunStep.tools?` (merged tool set for deep passes); `View` union += `"radar"` (shared with Feature D).
- `src/components/praison/workflows/workflow-editor-dialog.tsx` — depth state (hydrate `workflow?.depth ?? "standard"`), 3-button segmented control (aria-pressed, violet accent, one-line descriptions), live "Deep run: N authored steps · + 2 deep-research passes · + verification pass" summary line under the Steps header; persisted on save. New workflows: `addWf(...)` then `updateWf(newId, { depth })` because the store's `add()` materializes only known fields (stores.ts untouched).
- `src/lib/workflow-runner.ts` — new exported `materializeRunSteps(wf, agentsNow)` used ONLY in the fresh-run branch (resume block :268-289 kept byte-identical, so old materialized runs are unaffected). quick = as authored; deep inserts 2 passes cloned from the FIRST step's agent (labels "Deep research pass 2 — verify & broaden" / "… 3 — cross-check sources") with DEEP-RESEARCH appended instruction and tool union `base ∪ {web_search, arxiv_search}` granted only when the base agent has any tools; standard+deep append a synthetic "Verification & synthesis" generate-step (LAST step's agent + VERIFICATION PASS instruction) only when NO `kind:"review"` step exists. `streamStep` reads `runStep.tools ?? agent.tools` (effective tools) and the main loop reads `instruction = def ? def.instruction : step.instruction` — the only two hooks added; REWORK_LIMIT / self-heal / relay retry machinery untouched.
- `src/components/praison/atoms.tsx` — shared `DepthChip` (muted Quick/Standard/Deep chip with Zap/BadgeCheck/Microscope icon + explanatory title).
- `src/components/praison/workflows/workflows-view.tsx` — DepthChip on cards; depth round-trips through export (`exportWorkflows`) and import (`sanitizeWorkflow`).
- `src/components/praison/workflows/workflow-run-panel.tsx` — DepthChip in the panel header next to "Pipeline run".

**Feature D — Trend Radar view**
- Registration (all 6 points): `types.ts` View union, `shell.tsx` NAV_ITEMS (Radar icon, between Workflows and Settings) + VIEW_TITLES ("Trend Radar"), `page.tsx` conditional render + `#/radar` hash route, `command-palette.tsx` NAV entry (⌘5), `use-shortcuts.ts` VIEW_ORDER appended (radar = ⌘5, settings keeps ⌘4).
- `src/components/praison/radar/radar-view.tsx` (new) — tabbed view (shadcn Tabs):
  - **GitHub Stars**: unauthenticated `api.github.com/users/<user>/starred?per_page=100` ×3 sequential pages (early-break, 20s timeout, no token ever), user defaults "specimba", editable input persisted to `praison-radar-user`; explicit "Fetch stars" button on first visit; cache `praison-radar-gh` `{user, fetchedAt, repos}` with "cached Xm ago · Refresh"; repo cards (full_name link, clamped description, language dot map, stars, pushed relative time, ≤4 topic chips); keyword cluster chips All/Agents/Inference/Memory/RAG/Evals/MCP/Local/Media (matched against name+description+topics) + text filter box.
  - **HF Trending**: parallel fetch of models/datasets/spaces `?sort=trendingScore&direction=-1&limit=30`; sub-select segmented control; cards with id link (`/datasets/…`, `/spaces/…` variants), pipeline_tag/library chips, likes+downloads; cache `praison-radar-hf`.
  - **Paper Radar**: calls `GET /api/radar/papers?query&max=12&sort=submittedDate`; default query `cat:cs.AI OR cat:cs.CL OR cat:cs.LG`; paper cards with title/authors/date/clamped abstract + arXiv / alphaXiv / PDF link chips; arXiv query-syntax helper text; cache `praison-radar-arxiv` `{fetchedAt, query, papers}`.
  - Every list: `max-h-[56–62vh] overflow-y-auto` (global custom-scrollbar applies); Skeleton grids per tab, ErrorBox with Retry, EmptyStates with guidance; aria-pressed/aria-checked/aria-label/role=region throughout.
- `src/app/api/radar/papers/route.ts` (new) — runtime nodejs, force-dynamic; query trimmed+≤300 chars, max clamped 1–20, sort allow-listed; 15s `AbortSignal.timeout` fetch of `export.arxiv.org/api/query` with PraisonAgent UA; returns bare JSON array via the shared parser; 502 + `{error}` on failure.
- `src/lib/server/tools.ts` — ONLY added `export` to `parseArxivFeed`, `decodeXml` (+ `export type { ArxivPaper }`); execution logic untouched.

## Verification
- `bunx tsc --noEmit`: **0 errors under src/** (examples//skills/ ignored per instructions).
- `bun run lint`: **clean** (no output).
- `curl localhost:3000/` → **200**; `GET /api/radar/papers?max=2` → **200** with real parsed arXiv papers (e.g. 2609.20822); `?query=cat:cs.CL&sort=relevance` → **200** (param handling verified live).
- dev.log: `✓ Compiled`, all GETs 200 after changes (the single earlier 500 was the intermediate state while page.tsx referenced radar-view before the file existed).
- Depth materialization simulated end-to-end (extracted pure function): verified quick=no injection, undefined→standard semantics, deep=step1+2 passes(with merged tools only when base agent has tools)+verification, review gates suppress the synthetic verification, resume path untouched.

## Decisions & limitations
- Depth persisted for NEW workflows via add+update pair (store `add()` drops unknown fields; stores.ts was off-limits).
- Synthetic passes ride `WorkflowRunStep.instruction/tools` instead of authored defs — resume replays them from the run row, so edits to the workflow between failure and resume cannot corrupt a deep run.
- GitHub/HF calls are browser-side (CORS-safe, keyless); arXiv must go through the server (no CORS headers upstream).
- ⌘4 = Settings, ⌘5 = Radar per spec (sidebar visually lists Radar before Settings — accepted mismatch).
- HF/papers auto-fetch on first tab open (tab click = the explicit trigger); GitHub stars NEVER auto-fetch.
