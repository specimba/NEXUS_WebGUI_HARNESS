# WORKLOGS.md — log discipline

There are **three logs**, each with one job. Don't mix them.

| Log | Path | Job | Written by |
|---|---|---|---|
| **Round log** | `/home/z/my-project/worklog.md` | the append-only journal of dev rounds — what changed, what was verified, what's handed off | the chat-side architect, every round |
| **Cycle log** | `AutonomyLog` table (+ panel feed) | machine cycles & 24h reports of the improvement engine | the AIE, every 10 min |
| **Digest** | `PlatformSetting: strategy.digest` (→ every briefing) | distilled findings worth carrying forward (ADAPT verdicts, stalls, syncs, status flips) | engine · sync · architect |

## Round log discipline (the `---` template)

Append — never overwrite. Each section starts with a line containing exactly
`---` and then:

```markdown
---
Task ID: <round/task id, e.g. r515-c>
Agent: <agent name>
Task: <what was asked>

Work Log:
- <concrete step 1>
- <concrete step 2>

Stage Summary:
- <key results / decisions / artifacts>

Round Handoff:
Round ID: <next round id>
Task owner: <who continues>
Open risks: <numbered, honest>
Blockers: <none or list>
Next recommended action: <numbered, concrete>
```

Rules:
1. **Read the tail before you write.** New sessions read the last 2-3 rounds
   first — the log is the handoff mechanism between sessions that never meet.
2. **Every round ends with an appended section and a double push** (origin +
   fork). Unpushed work is unfinished work; `/tmp/my-project` is only the
   survivor snapshot of last resort.
3. Honest numbers only: verified counts, exact baselines, measured outcomes.
   If it wasn't witnessed, mark it as not-yet-witnessed.
4. QA artifacts → `upload/qa-<round>/`, referenced from the round section.

## What the machine logs owe the round log

The AIE's cycle/report rows and the digest stream are the *input* to
distillation: when a dev round starts, the architect reads worklog tail +
`GET /api/briefing` (which already folds in the newest digest, the last 24h
engine report, radar findings, and the top strategy items) and turns anything
actionable into `TASK-*` rows in `docs/strategy/TASKS.md` + the DB. That is
step 2 of the elevation cycle in [AGENT.md](./AGENT.md).
