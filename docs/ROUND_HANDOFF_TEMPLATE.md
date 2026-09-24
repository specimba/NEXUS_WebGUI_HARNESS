# Round Handoff Template

**Task ID:** r41-b · **Date:** 2026-09-24 · **Status:** ACTIVE
**Source:** `zaiGLM53flashWEBGUIforNEXUScreationADVISORY-B.txt` §10 ("Handoff Template"), adapted to this repo.
**Use:** every round ends with (1) the worklog section (`worklog.md` template — Task ID / Agent / Task / Work Log / Stage Summary) and (2) this machine-readable handoff, pasted at the end of the round's worklog Stage Summary or into the round's task record. Fields are fixed; `unknown` is an honest value, omitting a field is not.

---

## 1. Required fields (fill every one)

```text
Round ID: <e.g. r41-a>
Budget used: <tier + wall-clock, e.g. "M · 38 of 45 min"; "not tracked" only if truly unmeasured>
Task owner: <one role + agent name, e.g. "Builder (full-stack-developer)">
Scope completed: <one line per shipped item, no adjectives without proof>
User-visible changes: <what a user of the GUI would actually notice; "none" is a valid answer>
Verification steps: <exact repro: command / URL / UI path / test script per claim>
Verification result: <PASS | PASS-with-caveats | FAIL — caveats and failures named here, never buried>
Open risks: <what could break later; known-flaky lanes, unverified paths>
Blockers: <hard stops, or "none">
Cron state: <result of boot-ensure this session: jobs seen, recreated, disabled-class fallbacks used>
Next recommended action: <the single next move a fresh agent should start with>
```

## 2. Verification levels — pick what the claim requires

| Level | Minimum evidence |
|-------|------------------|
| Code-level | `bunx tsc --noEmit` + `bun run lint` (documented pre-existing errors excepted); unit script for logic that has one |
| Flow-level | live UI/pipeline exercise (agent-browser) with the observed output quoted |
| System-level | cron fire observed, daemon survived a tool-call boundary, relay rotated on a real failure, push verified on origin |
| Durability-level | reload/session-gap survival re-checked (persist key, re-arm, recreated job) |

Anti-theatre recap (see `docs/OPERATING_DOCTRINE.md` §4): no verification by assertion; reproduction comes BEFORE the fix claim; a failed round reported honestly beats a vague success; "decline path unit-proven, not model-observed live" is the correct shape for a caveat.

## 3. Quality bar

A good handoff is: **specific** (names, ids, numbers), **actionable** (the next agent can start from it without re-deriving context), **reproducible** (each verification step is runnable by someone else), **honest about uncertainty** (risks and caveats are first-class fields). A handoff that fails any of the four is returned to the owner — it is not archived.

## 4. Filled example (modeled on the real r40 round)

```text
Round ID: r40
Budget used: L · wall-clock not tracked in r40 (this template makes it a required field from r41 on)
Task owner: Orchestrator/Builder (lead, Z.ai Code orchestrator)
Scope completed: (1) MRTR human gate — tools/call answering input_required now opens a violet
  approval dialog (provenance, numbered requests, live countdown) and retries the SAME request
  with inputResponses; declined/timeout/headless -> honest ok:false for the model to adapt;
  (2) sticky-adoption guard — bake-off verdicts need 2 consecutive agreeing scheduled rounds to
  flip a pipeline's harness; single flips are HELD with reasons, audited amber;
  (3) tool-def audit receipt — every fresh/branched run stamps toolsOffered + mcpToolsDropped,
  surfaced as a "tools N" chip with a full-surface tooltip.
User-visible changes: MCP tools that need input pause interactive turns on an approval dialog
  (autonomous lanes decline gracefully); suites board shows "verdict held" states; run panel
  header shows exactly which tools the model was offered, MCP included.
Verification steps: gold test end-to-end — scripts/mock-mcp-input-server.ts (:8787) registered
  from Settings UI, Discover stateless (protocol 2026-07-28 cached); chat turn forced
  mcp__mrtr-mock__confirm_deploy -> gate opened mid-run -> answered "staging" -> retry with
  inputResponses -> chip "36ms" -> reply "Deployed to staging — mock service healthy";
  ledger stayed {1 ok, 0 fails} across gated + declined rounds; scripts/test-mcp-input.ts
  31/31; scripts/test-mcp-health.ts 14/14; bunx tsc --noEmit + bun run lint clean; console 0
  errors after full reload; 390px scrollWidth == viewport.
Verification result: PASS-with-caveats — deepseek-v4.1 (Vyce lane) hallucinated tool results on
  3 of 5 trigger turns (never made a real call); gate itself proven by the gold turn; failures
  were model instruction-following, not lane rotation or gate logic. Decline path unit-proven,
  not model-observed live. Mock server removed from the registry after QA (DeepWiki stays).
Open risks: some lanes ignore tool-call instructions (prefer keyed, instruction-strong lanes for
  gate tests); MRTR inputs are free-text textareas (type-aware confirm buttons pending);
  per-server "allow input gates" switch absent — headless-only users cannot pre-decline.
Blockers: none
Cron state: boot-ensure not needed — this round WAS the hourly agentTurn heartbeat (job 409322,
  08:21 fire, 5th consecutive 04:21->08:21); in-app automation: 1 bake-off schedule armed
  (hourly). No webDevReview-class jobs registered (class remains budget-gated).
Next recommended action: start r41 advisory pack — browser capability pack (Bright Data remote
  MCP preset + Hyperbrowser REST scrape tool, BYOK) and the advisory repo artifacts; then the
  r40 candidates (MRTR type-aware inputs, per-server allow-gates, agent-vs-agent bake-offs).
```

## 5. Anti-examples (do not do these)

- "Scope completed: improved the pipeline system" — no artifact, no user-visible change, unverifiable.
- "Verification result: OK" — no steps, no level, no numbers.
- "Cron state: fine" — boot-ensure output missing; the next session starts blind.
- Omitting `Open risks` because "it all passed" — every round has residual risk; name it or explain why there is none.
