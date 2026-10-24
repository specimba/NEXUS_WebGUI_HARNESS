# z.ai Cron — Reliable Creation Criteria (r517)

> Distilled from round 517-a forensics (16+ documented registry losses, the
> Owner's `Task content cannot exceed 2000 characters` UI error, and the live
> registry audit that found job 473327 "NEXUS webDevReview patrol (r516-b)"
> disabled after ONE run — "Disabled due to exec limits exceeded").
> **This file is the reconstruction template: every field needed to re-arm
> the patrol lives here verbatim.**

## The rule set (what kills jobs)

| # | Rule | Evidence |
|---|------|----------|
| 1 | **Message ≤ 2000 chars** — the chat UI hard-rejects longer content. Tool/SDK-path creates may be ACCEPTED over 2000 but those jobs are "not consistent due to rules" (silently short-lived). Safe target ≤ ~1600, pure ASCII. | Owner's UI error verbatim; job 473327 carried a 2600+ char message and died after 1 run; the one known long-lived prompt (job 424432) is 1762 chars. |
| 2 | **Payload kind `agentTurn` ONLY.** `webDevReview` is budget-class-gated: r34 saw 30m AND 1h jobs of that class born disabled; 10/10 recorded deaths via `max_rounds_exceeded`; ops/cron.jobs.json `bannedKinds: [webDevReview]`; OPERATING_DOCTRINE §8: "the platform gates the payload class, not the turn content" — identical text under agentTurn is legal. | Job 473327 (webDevReview, 15-min) ran once → auto-disabled. Historical agentTurn patrols (414938/414940/409322/424432) ran for days. |
| 3 | **Cadence ≥ 30 min.** 15-min cadence trips exec limits. Sustainable tiers: 30m / 1h / 6h / 12h, staggered OFF :00/:15/:30/:45. | r494+ 15-min rebuilds evaporated repeatedly; r34 era same. |
| 4 | **Schedule expr MUST be 6-field WITH seconds** (`0 7/30 * * * ?`). 5-field rejected; step forms without a leading seconds field parse as SECONDS (400). Minimum interval 300s. `fixed_rate` = seconds; `one_time` = epoch-millis STRING (or `yyyy-MM-dd HH:mm:ss`) — mandatory for one-shots, forbidden for recurring. | Recorded 400-rejections in worklog forensics. |
| 5 | **tz defaults to Asia/Shanghai** — always pass `Europe/Istanbul` explicitly or fires shift 5h. | Tool contract + doctrine docs. |
| 6 | **Priority is create-only** (1 low / 5 medium / 10 high / 15 very high) — cannot be edited later; recreate instead. | Tool contract. |
| 7 | **Round budget kills recurring jobs** — the message itself must carry a budget + early-exit-is-success + a no-cron-mutation clause (an agent that overruns or recreates crons from inside a turn kills its own scheduler). | "Disabled due to exec limits exceeded" (job 473327). |

## Visibility / persistence doctrine

- **Routing is context-scoped**: jobs carry the session/chat metadata of the
  CREATING context. Jobs created inside the agent workspace route to the
  agent session — invisible in the Owner's chat-side task list ("not seen
  for me") and mortal with that session (the ~16 "purges" = session
  recycles). The Owner's old chat-side jobs persist ("old ones still there
  due to time span control") because they live in the Owner's persistent
  chat. **Sub-agent contexts have NO cron access at all** (proven 517-a).
- **Reliable path**: the Owner creates the patrol from the z.ai chat UI —
  exactly what the r516-b attempt did, minus the three rule violations
  (length / class / cadence).
- Jobs created from THIS main session (which routes into the Owner's chat,
  session web-1661896a…, chat a34f44b2…) are visible to the Owner — that is
  how job 473388 was armed in r517.

## The canonical patrol (armed r517 — job 473388)

- **Title**: `NEXUS webDevReview patrol (r517)`
- **Schedule**: `kind: "cron"`, expr `0 7/30 * * * ?` (fires :07/:37), tz `Europe/Istanbul`
- **Payload kind**: `agentTurn` · **Priority**: 10 (high)
- **Message — 1517 chars, pure ASCII** (paste verbatim to re-arm):

```text
NEXUS WebGUI Harness patrol round. Project /home/z/my-project (Next.js 16 App Router, bun, shadcn/ui, Prisma/SQLite, single-route + hash-nav). Budget <=12 tool rounds; early clean exit = success. NEVER overrun - exceeding the budget kills this recurring job. Do NOT create or modify z.ai cron jobs from inside this turn; the Owner manages the schedule on the chat side.
1) FIRST: read the LAST section of worklog.md and follow its "Next recommended action".
2) QA golden paths with agent-browser on localhost:3000: Settings -> Model Relay (intel ladder + free-reach census), Radar -> Frontier tab scroll, Workflows -> run-panel long-paste into a step. Console must stay 0 errors. Fix anything broken BEFORE new work.
3) Ship ONE real increment: bugs found in QA first; else advance the P1 backlog in docs/strategy/TASKS.md (TASK-101 durable-step semantics, TASK-102 NEXUS_BOT wave). Mandatory every round: styling detail polish AND at least one user-facing feature improvement. Small verifiable increments, no theatre.
4) GATES before commit: bunx tsc --noEmit = 0 errors; bun run lint = 0 errors (33 warnings is the known baseline). Never ship on failed gates.
5) APPEND a new section at the END of worklog.md (never overwrite): Task ID / Agent / Task / Work Log / Stage Summary + Round Handoff with next recommended action.
6) Commit all changes and push BOTH remotes: origin AND fork.
7) If the dev server is down: at most ONE restart via scripts/dev-restart.sh, then continue with serverless work. STOP when done.
```

## Registry history (reconstruction context)

| Era | Jobs | Fate |
|-----|------|------|
| r28–r34 | 402913, 408563, 408717, 408812, 408899 | exec-limit evaporation; r34 webDevReview jobs born disabled |
| stable era | 414938 (30m), 414940 (1h), 409322 (1h @ :21), 424432 (hourly, 1762-char prompt) | ran for DAYS — the working proof (agentTurn, sane cadence) |
| r494+ | 463483 → 464024 → 464960 → 467112 → 467956 → 468000 → 468020 → 468099 → 468574 → 468650 → … → 472456 | 15-min webDevReview rebuilds, purged/rebuilt 16+ times |
| r516-b | 473327 (Owner chat-side attempt, webDevReview, 15-min, >2000 chars) | ran once → "Disabled due to exec limits exceeded" — deleted r517 |
| r517 | **473388** (agentTurn, 30-min :07/:37, 1517 chars) | ARMED — the criteria-compliant patrol |

## Maintenance protocol

1. Any patrol round starts with `cron list` (registry watch) — but NEVER
   mutates crons from inside the turn (rule 7).
2. If the registry is wiped again: the Owner re-creates from the paste block
   above (chat UI → scheduled task → paste → every 30 minutes).
3. Round content stays under 1600 chars: context lives in `worklog.md` (the
   LAST section), not in the cron message — the message is a pointer, not a
   document.
