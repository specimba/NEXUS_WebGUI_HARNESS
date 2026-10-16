# NEXUS WebGUI Multi-Agent Platform — Agent Operations Handbook

**Audience:** any AI agent (patrol/review cron loops, or a human developer) operating the project at `/home/z/my-project` (Next.js 16 App Router, served on `localhost:3000`).
**Scope:** architecture, operational doctrine, forensics history, verified fixes, known issues, and step-by-step protocols. This document supersedes conversational memory; the append-only changelog lives in `/home/z/my-project/worklog.md` (read its tail before every shift).

---

## 1. Project Overview

NEXUS WebGUI is a **local-first, BYOK (bring-your-own-key), multi-agent platform**:

- **Stack:** Next.js 16 (App Router) + TypeScript 5 + Tailwind CSS 4 + shadcn/ui (New York) + Zustand stores persisted to `localStorage`. No server-side database. Prisma is configured but the product is intentionally client-side.
- **Storage keys & rebrand migration:** persisted state lives under `nexus-*` / `nexus.*` localStorage keys (e.g. `nexus-workflows`). The pre-rebrand `praison-*` / `praisonai.*` keys are copied to their new names once at boot by `src/lib/migration.ts` — idempotent, guarded by the `nexus-migrated-from-praison-v1` flag key, legacy keys kept for rollback.
- **Single user-visible route:** `/` (`src/app/page.tsx`). Chat, Agents, Workflows (Workflow Studio), Radar (model tracker), and Settings are client-side views switched inside that route. Do NOT create new routes.
- **Engine is client-side:** workflow runs execute in the user's browser (`src/lib/workflow-runner.ts` → `src/lib/agent-engine.ts`). Consequences:
  - A closed tab cannot run anything; the in-app scheduler (10s tick) fires due schedules only while the tab is open (r71 handles background-tab timer throttling).
  - All run state persists to `localStorage` under the `nexus-workflows` key (Zustand persist). QA in one browser profile is invisible to another profile (isolated localStorage).
  - Page reload mid-run kills the run; r25 "zombie cleanup" marks orphaned `running` runs so they never fake liveness.
- **Port/gateway discipline:** the sandbox exposes only port 3000 (Caddy gateway). Cross-service API calls must use relative URLs with `?XTransformPort=<port>`. Never write absolute localhost URLs in frontend fetches; never write ports in WebSocket URLs.
- **Mini services** (if ever needed) live in `mini-services/`, each an independent bun project with its own fixed port, started with `bun run dev` in the background (auto-restart via `bun --hot`).

## 2. Cron Fleet Doctrine (CRITICAL — read before touching anything)

Two recurring platform-side jobs drive autonomous operation. They fire as user messages into the IM session:

1. **Job 414938 — fleet patrol** (every 30 min). Protocol: HTTP health check → `cron list` check → append one line to `ops/heartbeat.log` → STOP. Hard budget ≤8 tool rounds. **No code changes, no QA, no worklog edits.**
2. **Job 414940 — hourly review** (every hour). Protocol: SELF-HEAL cron check → worklog tail → health curl → one agent-browser snapshot + console check → **ONE focused improvement** (small verified fix or feature increment) → verify → worklog append → STOP. Hard budget ≤12 tool rounds. Early clean exit = success.

**Non-negotiable rules:**
- NEVER create cron jobs with `kind=webDevReview`. Forensics: 10/10 such jobs died via `max_rounds_exceeded` (r56). Only `kind=agentTurn` is legal.
- NEVER recreate jobs that are still firing. The `cron` CLI is unavailable from the sandbox (platform-side, 10+ consecutive rounds). Substitute evidence: the jobs' own on-schedule firing IS the liveness proof ("behavioral fleet 2/2"). Log it as `fleet=2/2` in the heartbeat line.
- Heartbeat line format: `<ISO-8601 UTC timestamp> http=<code> fleet=<n>/2` appended to `ops/heartbeat.log`. `http=000` lines are recorded as-is (patrol reads only; it does not self-heal by protocol — but see §4 for the 1-round self-heal recipe a review round may apply).

## 3. Budget & Round Discipline

Exceeding a task's round budget kills the entire recurring job (`max_rounds_exceeded`). Batch aggressively: combine curl + cron check in one Bash call; combine grep + tail; use compound commands. Count rounds explicitly. If a verification turns inconclusive, prefer a clean exit with a complete handover in `worklog.md` over burning the last rounds.

## 4. Dev-Server Lifecycle & Tree-Kill Forensics

**The sandbox kills every process spawned by a tool call when the call ends** (verified by controlled experiments r79: nohup, setsid, and setsid+bash all died at the call boundary — `next_call=000`).

**The fix:** `scripts/start-server.py` — double-fork orphaning (`fork → setsid → fork → exec bun run dev`), reparenting the worker to PID 1 (tini), outside the kill tree. Idempotent (exits 0 if :3000 already answers), logs to `server.log`, `dev.log` stays canonical.

- **If any round finds `http=000`:** run `python3 scripts/start-server.py` (≤1 tool round), verify `curl` returns 200 in the SAME call and ideally on the next call boundary.
- Dev-server death signature: `dev.log` cut mid-requests with NO crash line = external kill (OOM/kill), not an app bug.
- Do NOT use `bun run build` (forbidden in this environment). Use `bun run lint` + HMR compile evidence in `dev.log`/`server.log` for verification.

## 5. Gate Discipline for Editing the Runner/Engine

`src/lib/workflow-runner.ts` and `src/lib/agent-engine.ts` execute the user's live runs. Editing them while a run is in flight can (a) be harmless if the change is value-only (in-flight closures keep old refs) or (b) trigger HMR/full reload that kills the run.

**Gate checklist before touching these files:**
1. `tail dev.log | grep POST` — zero in-flight `/api/chat` streaming requests (only cron `GET /api/cron/forensics` polls should appear).
2. Last observed run state is TERMINAL (failed/done + recovery card), not mid-run.
3. Keep the edit window seconds-long; prefer value-only edits (constants) over structural changes.
4. Worst case if the gate call is wrong: one zombie run, cleaned by r25; schedules re-fire on the next tick. Document the gate decision in the worklog.

## 6. Resilience Architecture (as of r83) — where failures are handled

Failure classes and their defense layers, in call order:

1. **Pre-stream failures** (fetch throws / non-200 before first token): engine-level `attemptLoop` retries up to `MAX_UPSTREAM_ATTEMPTS` with 1.2s backoff, gated on `!streamedAny` and `isTransientNetworkError()` (agent-engine.ts:199 — regex covering `network error|fetch failed|ECONNRESET|ETIMEDOUT|upstream|http 5xx|failed to fetch|…`). Also handles: deadline aborts surfacing as `UpstreamDeadlineError`, `max_tokens → max_completion_tokens` parameter adaptation, tools-unsupported fallback.
2. **Engine-layer silence** (stream opens, then zero bytes): `IDLE_CHUNK_TIMEOUT_MS = 180_000` (r78; forensics in-code: 15s killed runs twice in r68, 90s still killed a Deep run — 3/3 auto-resumes re-stalled in the same generation phase = deterministic buffered-reasoning silence, not provider jitter). 180s is sized for 2–3 min reasoning buffers and stays below the runner's 4-minute watchdog so the engine deadline fires first and the run stays auto-resumable.
3. **Mid-stream drops** (`streamedAny=true`): NO engine-level retry by design — a fresh regeneration would duplicate already-streamed tokens (the runner's `draft += t` only resets per STEP attempt, not per engine attempt). The error throws to the runner.
4. **Runner step-level self-heal:** `MAX_STEP_ATTEMPTS = 3` (r83, was 2). Per attempt: `draft = ""` (clean UI, no duplicated text), `localToolCalls = []`, and the **relay wire is rebuilt from the rotator's health memory** (r25 doctrine) so each retry dials a DIFFERENT lane. Gated on `SELF_HEAL_KINDS` (transient classes) + `!signal.aborted`. Toast: `🛟 "…" hit a {kind} hiccup — auto-retry {n}/{MAX} on a fresh lane…`.
5. **Terminal failure:** recovery card on the run ("Retry failed step" preserves all completed steps' outputs; "Restart from scratch" discards; "Partial report"; "Copy diagnostics"). `classifyRunError` (workflow-runner.ts:225) attaches structured `{kind, hint}`.
6. **Step statuses are honest** (r80): materialized steps start `"pending"` (dimmed "Queued" UI), flip `"running"` only when the engine reaches them. Union: `pending|running|done|error|stopped`. `resumeCount` counts run-level resumes; call-level hiccup retries do NOT increment it.

## 7. UI Liveness Features (r81/r82) — the "board feels alive" set

User complaint (verified fixed): scheduled/automated runs were invisible on the Workflow Studio board ("always looking stale/dead without clicking play"). Root cause: the scheduler fires runs fire-and-forget; the view only tracked the run dialog it opened itself.

- **r81 (workflows-view.tsx):** per-card live badge derived from `runs[]` (`status === "running"`): pulsing emerald dot + `Running · step k/n · <current step label>` (+ queued/starting fallbacks), `ring-1 ring-emerald-500/40` on the live card; PageHeader chip `n running` beside `n scheduled`; outcome dot on the "N runs · last Xm" meta line (emerald done / red error / zinc stopped / pulsing running) with title tooltip. Works for ANY trigger because the runner patches `addRun/patchRunStep` reactively into the store.
- **r82 (workflows-view.tsx):** run-history sparkline in the card meta row — up to 10 bars (oldest→newest), fixed height, colored by terminal status, per-bar tooltip `rel time · status · duration`, `role="img"` + full aria-label, hidden below 2 runs. Duration deliberately NOT height-encoded (692s deep runs would flatten the scale).
- Design language: emerald = live/ok, amber = review/blocked, red = failure, zinc = stopped/neutral. No blue/indigo (project style rule).

## 8. Verification Protocol (every change)

1. `bun run lint` — must be clean.
2. HMR compile evidence: `✓ Compiled in …ms` in `dev.log`/`server.log`.
3. `agent-browser` QA against `http://localhost:3000` (the ONLY route is `/`): open, snapshot, console check (`agent-browser console` must show no errors).
4. **DOM truth over a11y snapshots:** playwright-style snapshots collapse small spans (r81's header chip was invisible in snapshots but present in DOM). Verify chips/small nodes via `agent-browser eval "…"`.
5. For run-flow features: fire a real run from the QA browser profile (card Run → dialog → `agent-browser fill <ref> "<task>"` → Run) and snapshot behind the dialog.
6. Append a complete worklog entry (template below).

**agent-browser quirks (verified):**
- `agent-browser fill <ref> "<text>"` works ONLY alone; a `click → Control+a → type` sequence CLEARS the React state. Re-fill with `fill` alone.
- `/workflows` is a 404 — navigate to `/` and click the nav, or rely on persisted last-view.
- Console lines from Fast Refresh (`[Fast Refresh] rebuilding/done`) are normal; filter them out.

## 9. Worklog Protocol

Append-only (`cat >> /home/z/my-project/worklog.md`), one section per task:

```markdown
---
Task ID: <cron job id | user-round>
Agent: <main | main (review round)>
Task: <one line>

Work Log:
- <concrete steps, evidence, file:line references>

Stage Summary:
- <key results/decisions/artifacts>
- NEXT: 1) …, 2) …, 3) …
```

Read the tail before every shift. Never overwrite. The patrol job does NOT write the worklog (protocol).

## 10. Known Issues & Pending Work (priority order)

1. **Recovery-card counter bug (SUSPECTED, view-only):** the user's failed-run card read "0/11 steps done" while run history clearly showed steps 1–2 done with full outputs. Hypothesis: the counter reads a different array/status set (or only counts the resumed attempt). Locate the string in the recovery-card component, fix the count source, verify against a stored errored run. First candidate for the next review round.
2. **Run-level auto-resume for scheduled runs:** on terminal failure with a transient kind (`network error`, stall) when `source === "scheduled"`, schedule ONE automatic resume after ~60s (reuse "Retry failed step" machinery + `resumeCount`). Turns the 1h fleet from "dies and waits for a human" into self-healing. Touches the runner — needs gate discipline (§5).
3. **Stall-failover epic:** rotate to an alternate healthy lane on repeated engine-layer stalls, including an engine-level mid-stream retry with a cross-layer output-reset signal (engine→runner→panel). Largest item; design before touching.
4. **Auto-resume E2E verification recipe (v2):** to exercise hang/stall handling end-to-end: run a hang server on `:4319` (`?hang=ms` pattern), then inject settings via `settings.providerKeys.custom = { key, model, … }` — NOT legacy top-level `baseUrl/defaultModel` (resolveLlm's registry branch matches the `custom` registry entry first; keyless registry selections gracefully ride Auto). The 07:0x round's accidental probe validated the whole real-UI run path otherwise (task gate → panel Run → per-step ms → runs[] persistence).
5. **Styling/feature queue:** sparkline echo in run-dialog history rows; recovery-card visual hierarchy; Runs board (kanban) parity for r81/r82 signals.
6. **Platform issues (NOT project bugs):** (a) user file uploads intermittently fail to land in `/home/z/my-project/upload/` — treat pasted text as source of truth and note the miss; (b) `cron` CLI unavailable from the sandbox — use behavioral fleet evidence; (c) tool-call process tree-kill — use `scripts/start-server.py` for anything long-lived.

## 11. Key Files Map

| Path | Role |
|---|---|
| `src/lib/workflow-runner.ts` | Run orchestration: step loop, materializeRunSteps (r80 pending), MAX_STEP_ATTEMPTS=3 self-heal (r83), relay wire rebuild, classifyRunError, resume machinery |
| `src/lib/agent-engine.ts` | LLM engine: attemptLoop, IDLE_CHUNK_TIMEOUT_MS=180_000 (r78), isTransientNetworkError, consumeUpstreamSSE, tool loop |
| `src/lib/stores.ts` | Zustand stores + localStorage persistence (`nexus-workflows`), r25 zombie cleanup |
| `src/components/nexus/workflows/workflows-view.tsx` | Workflow Studio: cards (r81 live badge/ring, r82 sparkline, outcome dots), scheduler chips (r76 blocked, r77 deferral audit), header counters |
| `src/components/nexus/workflows/workflow-run-panel.tsx` | Run dialog: live step rows, statuses, recovery card |
| `src/components/nexus/workflows/workflow-scheduler.tsx` | 10s tick scheduler, fire-and-forget executeWorkflowRun, r77 deferral audit |
| `scripts/start-server.py` | Double-fork daemonizer — the 1-round self-heal for http=000 (r79) |
| `ops/heartbeat.log` | Patrol heartbeat lines (`<ISO-8601Z> http=<code> fleet=<n>/2`) |
| `ops/cron.jobs.json` | Canonical fleet definition (recreate from here ONLY if a job stops firing; kind=agentTurn ONLY) |
| `worklog.md` | Append-only changelog/handover — read tail every shift |
| `dev.log` / `server.log` | Dev server logs (dev.log is canonical) |

## 12. Recent Changelog Digest (r78–r83)

- **r78:** `IDLE_CHUNK_TIMEOUT_MS` 90s → 180s (engine). Forensics chain documented in-code. Applies to every new LLM invocation without reload.
- **r79:** `scripts/start-server.py` double-fork daemonizer; retracted the wrong "browser netns" theory (dead server was the only cause); tree-kill mechanism proven by 3 controlled experiments.
- **r80:** workflow step status union += `"pending"`; all 3 materializeRunSteps construction sites + resume map produce pending; UI dimmed "Queued" rows; compare-dialog status map gained the key. Fixed the user-reported "ALL 8 STEPS RUNNING AT ONCE" lie.
- **r81:** live-run visibility on studio cards (badge + ring + header counter + outcome dots) — store-derived, trigger-agnostic.
- **r82:** run-history sparkline on cards (10 bars, status-colored, tooltip duration).
- **r83:** `MAX_STEP_ATTEMPTS` 2 → 3 with per-attempt fresh-lane dial (evidence: two independent deep runs died when attempt-2 lanes were also sick in the same provider outage window); toast text now count-accurate.

— End of handbook. Keep it updated when doctrine changes; the worklog remains the fine-grained journal.
