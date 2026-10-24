# AGENT.md — NEXUS WebGUI Harness charter

> Read this BEFORE acting on the platform. This file is the instruction layer
> the Owner demanded: "we need proper instruction and agent.md tasks.md
> worklogs.md etc — a strategical system for proper disciplined continuous
> work." Everything here is doctrine, not suggestion.

## 1. What this platform is

NEXUS WebGUI Harness — `/home/z/my-project`, a Next.js 16 single-route app
(hash navigation), Prisma + SQLite, local-first BYOK. **We own it completely**:
files, git (origin + fork), database, schedules. Unlike the z.ai managed
environment (where the Owner cannot modify system code), here every agent
touchpoint is ours to shape.

Companion docs: [`TASKS.md`](./TASKS.md) · [`WORKLOGS.md`](./WORKLOGS.md) ·
`/home/z/my-project/worklog.md` (the 12k-line round log) ·
`/home/z/my-project/docs/repo-sweep-report-2410.md` (54-repo curation research).

## 2. The capability elevation cycle (the meta-agentic system)

The Owner's doctrine, encoded. Read it twice. This is why the system exists.

```
   ┌──────────────────────────────────────────────────────────────┐
   │  1. RESEARCH   in-app workers (AIE · radar · workflow agents)│
   │                + z.ai chat sessions sweep topics, repos,     │
   │                experiments, own logs.                        │
   │        ↓                                                     │
   │  2. DISTILL    the CHAT-SIDE ARCHITECT (the z.ai coding      │
   │                agent) reads verdicts/findings/stalls and     │
   │                writes concrete StrategyItem rows + TASKS.md  │
   │                entries: nextAction + acceptance criteria.    │
   │        ↓                                                     │
   │  3. IMPLEMENT  the architect edits platform code in dev      │
   │                rounds (r-numbers), gated tsc/lint/QA,        │
   │                pushed to BOTH remotes.                       │
   │        ↓                                                     │
   │  4. OPERATE    platform-internal loops run the improved      │
   │                platform autonomously: AIE 10-min cycles,     │
   │                radar hourly, workflow schedules — tab-closed,│
   │                vault-free, purge-proof.                      │
   │        ↓                                                     │
   │  5. LEARN      outcomes land in the digest + research verdicts│
   │                + evolution ledger → the next proposal batch  │
   │                is smarter. Loop → 1.                         │
   └──────────────────────────────────────────────────────────────┘
```

**Why workers can't implement:** an in-app workflow agent runs THROUGH the
platform's API. It cannot pause, restart, or edit the serving code without
cutting its own connection mid-flight. Therefore its deep-dive knowledge is
*distillation fuel* — the architect converts it into platform changes. That
division is not a limitation; it is the safety property that keeps research
from mutating live infrastructure.

## 3. Division of labor

| Role | Who | May do | Must never do |
|---|---|---|---|
| **Owner** | the human | decide priorities, rotate secrets, create z.ai crons, paste keys | — |
| **Chat-side architect** | the z.ai coding agent (me) | distill findings into tasks, implement code, run dev rounds, push git | push secrets, skip gates, claim unverified success |
| **In-app workers** | AIE · radar · workflow agents | research, score, propose, advance strategy items (data-only) | mutate workflows, dial LLMs implicitly, edit code |
| **AIE engine** | `src/lib/server/autonomy.ts` | drain research queue FIFO, advance TASK items, log cycles/reports | exceed 2 repos/cycle, re-fetch researched rows |

## 4. The strategic system (r515-c)

Runtime half (queryable, machine-read):
- **`StrategyItem`** table — `TASK-<n>` rows with `nextAction`, `acceptance`,
  `status`, `priority`, `advancedCount`. The AIE advances open items every
  cycle (data-only move); `GET /api/strategy` returns the full context pack.
- **Digest stream** — rolling 40-entry distilled-findings feed
  (`PlatformSetting: strategy.digest`), appended by the engine, sync, and the
  architect. The briefing carries the newest entries.
- **`GET /api/briefing`** — markdown environment brief. ANY scheduled agent
  reads this before acting. It carries: doctrine summary, platform standing,
  top strategic items, owner actions pending, and a paste-ready z.ai cron task.

Git half (versioned, human-read):
- `docs/strategy/AGENT.md` — this file.
- `docs/strategy/TASKS.md` — the versioned mirror of the backlog; the
  architect updates statuses each round (the DB is the runtime source of truth).
- `docs/strategy/WORKLOGS.md` — the log discipline pointer.

## 5. Cron doctrine (3 layers — read before scheduling anything)

The Owner's directive: "crons should be more in z.ai chat side and I can
manually create them; your sided creations are gated or deleted." Witnessed:
jobs 472456/473048 both ended **"Disabled due to exec limits exceeded"** after
~2 runs, and the registry was purged 7× before that.

1. **Owner-created z.ai crons** — the resilient control plane. The Owner
   creates them manually (scheduler UI → task title + cadence + task text).
   Feed them the paste-ready block from `/api/briefing` or the Strategy card.
2. **Platform-internal loops** — purge-proof execution: AIE 10-min cycles
   (`startAutonomyEngine` in instrumentation), capability radar hourly,
   workflow schedules (browser lane BYOK, server lane vault-keyed). These
   cannot be purged by anything external.
3. **Chat-side auto-crons** — best-effort bonus only. The architect may keep
   ONE 15-min webDevReview job alive but must treat it as disposable and never
   as a dependency.

## 6. Safety doctrine (unchanged, now written down)

- Never mutate workflows from server code; seeds stay owner-copy.
- No implicit LLM dials: every dial is an owner-visible lane decision; the AIE
  has exactly one optional no-key enricher with a 6s timeout, fail-open.
- Secrets are server-only (`PlatformSetting`/vault), masked last-4 in any
  response, never logged, never in git. `scripts/secret-scan.sh` is fail-closed
  at push time.
- CSRF double-gate on every state-changing route (`x-nexus-csrf: 1`).
- Honest failures: typed error classes, no silent fallbacks, no vanity metrics.
- Research rows are the cache: researched queue rows are never re-fetched.
- Every round: `tsc --noEmit` 0 errors, `bun run lint` at baseline, browser QA
  via agent-browser, push **both** remotes, append `worklog.md`.

## 7. Round discipline (for dev-round sessions)

1. `cron list` first (purge watch) — rebuild only the one mandated job.
2. Read `worklog.md` tail (last 2-3 rounds) + `GET /api/briefing`.
3. Pick the top open `TASK-*` (priority, then age) — or fix what QA found.
4. Implement → gate → QA (screenshots to `upload/qa-<round>/`) → commit.
5. Update `TASKS.md` statuses + append `worklog.md` with the `---` template.
6. Push origin + fork. State owner actions still pending.
