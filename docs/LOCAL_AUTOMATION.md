# Local automation — the two-lane model & the vault

PraisonAI pipelines with recurring schedules run on one of two lanes. Which lane
is active is not a setting — it is decided by whether an open browser tab is
keeping a fresh heartbeat. This document describes both lanes, the Automation
Vault that feeds the headless lane, and the local HTTP contract every piece
relies on. Everything here is local-only: no telemetry, no cloud relay.

## The two lanes

**In-tab lane (BYOK).** While a tab is open, the client-side scheduler runs
schedules directly in the browser using the user's own provider keys — the same
keys the chat uses. Keys never leave the browser in this mode. Every 60 seconds
the tab pushes the enabled schedules plus a heartbeat to the server
(`POST /api/automation/sync`, `SYNC_INTERVAL_MS = 60_000` in
`src/components/praison/workflows/automation-bridge.tsx`). The server stands
down while that heartbeat is fresh.

The heartbeat's visibility behaviour is deliberate and is the mirror image of
the Server Autopilot panel's poll (r144/r145, documented in-code):

- **Hidden tabs keep heartbeating.** The POST is a *liveness claim* ("tab
  alive → server lane stands down"), not a data poll. Suppressing it while
  hidden would hand schedules to the shared built-in gateway the moment the
  user merely switches windows, so it is NOT paused on
  `visibilitychange`. Chromium's background throttling still bounds it to
  ≥1/minute, which satisfies the 120s staleness window by design.
- **Returning to a visible tab resyncs immediately.** Without this, the next
  fresh heartbeat could be up to 60s away and in that window the still-stale
  registration lets the headless lane claim a due run the tab lane is about
  to fire itself — the resync makes lane handback land the instant the user
  actually looks.

**Server lane (headless).** When the heartbeat goes stale (>120s — tab closed,
machine asleep, or the tab busy), the server lane takes over: the in-repo claim
loop (`src/lib/server/automation-executor.ts`, booted once per server process
by `src/instrumentation.ts`, r204) ticks every 15s, stands down while the tab
heartbeat is fresh, claims due workflows (`nextRunAt <= now`), dials the LLM,
and writes `automationRun` rows. One honest caveat: the loop dials **only**
with a key from the Automation Vault — with no resolvable slot it does not
dial anything implicit; the run is skipped and the reason reported
(`no-vault-key` / `no-resolvable-provider`, visible in the autopilot panel's
"server lane: no key — closed-tab runs wait" state). The early r109-era
fallback of dialing the shared built-in gateway is gone — the legacy
`builtin` slot is skipped by the executor entirely (see below) — so a stored
vault key is what turns closed-tab schedules from "queued" into "runs". Since r319 the server dial also rotates on a 429: a saturated
vault-provider dial falls back to up to two registry no-key free lanes
(keyless by doctrine — no credential is invented), sharing the same
cooldown-memory shape as the browser lane; if every lane fails, the ORIGINAL
error is thrown honestly (no fabricated output).

## The Automation Vault

Opt-in, local-only key slots for the headless lane. Store a key per provider
and closed-tab runs dial with your quota instead of the shared lane.

- **Storage:** one row **per provider** in the local SQLite DB
  (`AutomationVault`, `provider` is unique — a slot list, not a single slot).
  Nothing is telemetered. `GET /api/vault` never returns raw keys — only
  masked previews (`first4••••last4` for keys longer than 12 chars,
  otherwise `••••••••`).
- **Slot resolution (r207/r211):** the executor scans the slots **oldest
  first** (`createdAt` asc — the order the vault GET ships since r210) and
  the first resolvable slot wins: a slot with no key or no matching registry
  provider is skipped, and if no slot resolves the run is honestly reported
  as `no-vault-key` / `no-resolvable-provider`. The dial semantics have
  exactly one exported resolver (`resolveServerDialFromSlots`); the lane chip
  and the sync GET mirror it, so they cannot disagree.
- **Legacy `builtin` slot:** the built-in engine's gateway-key handoff is
  kept for older client bundles but the server executor **skips it** — it is
  a client-lane concept, not a headless credential.
- **UI:** Settings → *Automation vault* card — one row per provider slot with
  its stored age (the dial-order input, made visible), plus:
- **Test key:** per slot — dials `POST /api/vault/consume` exactly as the
  claim loop would, then round-trips the returned raw key through the
  same `mask()` and compares it with the displayed preview. A match proves the
  handoff endpoint is reachable, the slot is readable, and the key is intact —
  without ever rendering the raw key. It does **not** dial an LLM (the built-in
  lane is environment-credentialed in-repo; dialing with the key is the
  claim loop's job).
- **Reveal (r154):** the card's eye button on a stored-slot row dials the
  same `POST /api/vault/consume` and renders the raw key for ~8 seconds, then
  re-masks itself — immediate re-mask on second click / unmount / re-store,
  no auto-copy, and a reload re-masks (reveal state is never persisted).
  Threat model unchanged: the key is already plaintext in this machine's
  SQLite and `consume` is reachable by any same-machine **non-browser**
  caller (foreign browser pages have been rejected by the r321 CSRF gate;
  same-LAN `Host` spoofing remains the documented limit) — the reveal
  changes who can *see* the key on screen, not who can programmatically
  *get* it.
- **Status at a glance:** the *Server autopilot* panel (top of the Workflows
  view) shows a lane chip — when the tab drives, "browser driving — schedules
  run in-tab (your keys)"; when the server lane is live, "server lane:
  <provider> <mask>" with the resolved slot; and when the tab is closed but no
  vault slot resolves, the explicit no-key states "server lane: no key —
  closed-tab runs wait" / "server lane: needs a registry provider key"
  (nothing implicit dials — runs stay queued). The chip sits next to the
  bridge-sync freshness line and the next scheduled fire ("next fire …"), and
  the vault-related surfaces deep-link to the vault card.

## HTTP contract (all localhost)

| Method & path | Caller | Behaviour |
| --- | --- | --- |
| `POST /api/automation/sync` | open tab, every 60s | Heartbeat + push enabled schedules. A push with ≥1 enabled schedule prunes orphaned registry rows; an empty push is heartbeat-only (protects against a second client disarming the registry). |
| `GET /api/automation/sync` | Server autopilot panel (15s poll) & drivers | `{ serverDriving, lastSeenAt, registry, runs[last 25], executorLane, vaultLane }`. `serverDriving` = heartbeat stale >120s. `executorLane` (r205/r207) mirrors `resolveServerDialFromSlots` exactly — `{ ready, reason?, providerLabel, maskedKey, slotProvider, slotCount }` for the slot the executor will actually dial (live-verified r217); `vaultLane` is the legacy r133 builtin-slot read, kept for older cached bundles. The panel poll pauses while the tab is hidden and refetches on return (r141) — the deliberate mirror of the heartbeat's keep-hidden semantics. |
| `POST /api/automation/run-now` | UI ("Run on server") | Sets `nextRunAt = now` and re-enables the row; the claim loop claims it within ~30s when it is driving. |
| `POST /api/vault` | Settings UI | Upsert `{ provider, key, label }` → masked ack. **CSRF double-gate (r325):** browser callers need `x-praison-csrf: 1` + non-cross-site `Sec-Fetch-Site`, else `403` "vault rejects cross-site browser calls (CSRF gate)" — without the gate a drive-by page could overwrite a stored slot with a preflight-free simple request. Non-browser callers (scheduler, CLI, QA scripts) pass unchanged. |
| `GET /api/vault` | Settings UI + Workflows lane chip | Masked slots only — raw key never leaves the DB except through `consume`. **CSRF double-gate (r325)** — same contract as the `POST` row: in-app callers (vault card load, Workflows readiness poll) send the header; foreign pages get `403`. |
| `DELETE /api/vault?provider=…` | Settings UI | Removes the slot; headless runs fall back to the shared lane automatically. **CSRF double-gate (r325)** — same contract as the `POST` row (a drive-by DELETE is slot sabotage). |
| `POST /api/vault/consume` | claim loop (and the Test key button) | `{ provider }` → `{ key, updatedAt }` — the raw key. **Localhost-only guard (enforced since r138):** non-local `Host`, non-local `x-forwarded-host`, non-loopback `x-forwarded-for` / `x-real-ip`, or any `forwarded` header ⇒ `403` before any key lookup — both legit callers dial localhost, so both pass. **Browser drive-by gate (r321):** browser callers must also pass the house CSRF double-gate — `x-praison-csrf: 1` (a foreign page cannot attach it without a preflight that is never granted) and `Sec-Fetch-Site: cross-site` rejected ⇒ `403` with the reason "consume rejects cross-site browser calls (CSRF gate)"; a `text/plain` body that skips preflight is caught by the header gate. The claim loop and CLI send no browser headers and pass untouched. **Trust model:** the key is already plaintext in this machine's SQLite DB, so localhost HTTP adds no exposure while giving the service a stable, DB-agnostic contract. Never logged, never telemetered. The header guard is defense-in-depth, not auth — a LAN client can still spoof `Host`, so if this app is ever deliberately exposed beyond localhost, it **must** gain real auth first. |

- **Cache discipline (r218):** every `/api/*` response ships `Cache-Control: no-store, max-age=0, must-revalidate` (blanket header via `next.config.ts`) — none of these endpoints is cacheable-by-design. Browsers heuristically caching an empty vault answer was observed rendering a false "No registry-provider key stored" state while the DB held the row (r218 QA); the vault card also refetches whenever it becomes visible (r218), so tab panels that are CSS-hidden rather than unmounted can never show a stale vault.
- **Test key / Reveal (per slot, r218):** every registry-provider row — not just the legacy builtin box — carries its own eye (reveal-once, ~8s auto re-mask) and Test button; both dial `POST /api/vault/consume` with that row's provider. The builtin "Vault key verified" toast text is preserved verbatim (D-series CDP contract).

## Reliability notes

- Errors in the server-run history are classified: transient infra noise
  (429 / rate-limit / socket blips / timeouts — `TRANSIENT_RE`) renders amber
  as "↻ retried" with retry backoff armed; only hard failures show the red
  terminal "✗ error".
- Run history rows with recorded LLM calls expose an "N calls" expander: the
  grouped per-step call log with global numbering and a counted resilience
  digest (`↻ primary skipped ×N · ⇄ model substitution ×N · ⇄ relay rotation ×N`);
  since r320 the run card's LLM-calls row also witnesses FAILED dials by
  lane (`✗N failed dials (lane ×count, …)`) — a parked run answers "did
  rotation run, and onto which lanes?" at a glance.
- **Failure breaker (server side):** three straight failed closed-tab runs
  park a registry row (`enabled: false, failStreak ≥ 3`) instead of burning
  more quota. Parked rows render in the autopilot panel's red strip (r216)
  with the resume advice; the pulse's attention cell deep-links to the first
  offender's remediation surface (stale >24h → the amber strip, breaker-parked
  → the red strip, lane-blocked due run → the vault card) — each surface
  renders from the same data source as the count it explains (r212/r216).
- **Failure breaker (client lane too):** the in-tab scheduler mirrors the
  server breaker — at `failStreak >= 2` scheduled fires degrade deep runs to
  Standard (r26's `depthOverride` path), and 3 consecutive failures auto-pause
  the schedule (`enabled: false` — the card's "auto-paused · click to resume"
  chip; r171 parity with the executor's `PARK_AFTER`). Transient failures
  instead arm an auto-resume backoff (`autoResumeTrips`/`autoResumeAt` — the
  run panel's "Run parked — auto-resume scheduled" state), and a parked run
  resumes via relay rotation when the network or gateway recovers; the next
  `done` run resets streak and trips to zero.
- **429 rotation ladder (browser lane, r305–r318):** an in-tab run's dial
  ladder is primary → demoted primary (sick-window) → built-in engine →
  registry rotation (the final attempt leaves a saturated provider family
  entirely), with congestion rotation reordering the relay wire and — since
  r318 — the relay chain including the registry's no-key free lanes, so a
  single-key vault still has somewhere to rotate instead of parking on an
  empty chain. Chat dials the same shared cooldown memory: a cooling
  provider announces "Provider cooling Ns" before dialing (r316).
- **Stale registry:** an enabled schedule overdue >24h with neither lane
  claiming it renders the amber strip in the autopilot panel (re-enable the
  schedule, store a vault key, or use "Run on server").

---

Fact-checked against code as of r322 (2026-10-07), re-stamped after the
r300–r321 drift window (the 429-rotation doctrine rounds). Re-verified this pass: `SYNC_INTERVAL_MS = 60_000`
(bridge), `HEARTBEAT_STALE_MS = 120_000` (executor + sync route),
`GET /api/automation/sync` shape **verified live** (`serverDriving` /
`lastSeenAt` / `registry` / `runs` [take: 25] / `executorLane` /
`vaultLane`, with `executorLane.reason = "no-vault-key"` observed on the
keyless dev profile), `MASK_MIN = 12` mask shape, the r138+r321 consume-guard
header list (the CSRF double-gate re-proven live this pass: CLI pass /
cross-site 403 / UI+header pass / Host spoof 403 — and the text/plain
preflight-bypass cell in the r321 round's 5/5 matrix), the r154 reveal-once path (~8s auto re-mask, per slot), the
vault card's per-slot Test-key round-trip, `run-now`'s
`nextRunAt + enabled: true`, the `TRANSIENT_RE` coverage, the digest strings
in `workflow-run-panel.tsx`, the r212/r216 attention deep-link targets
(`automation-stale-strip`, `automation-parked-strip`, vault anchor), the
no-store blanket (`next.config.ts`), and the claim loop's in-repo home
(`automation-executor.ts` + `instrumentation.ts`, 15s tick). Corrected this
pass: the claim loop is no longer described as external (r204 moved it
in-repo; the r217 stamp missed this), the "shared gateway by default"
wording is replaced by the honest queue-until-key semantics, the autopilot
panel's no-key / next-fire states are documented, and the client-lane breaker
got its own reliability note. Corrected this pass (r322): the server lane's
r319 no-key fallback, the browser lane's r305–r318 rotation ladder, the
r320 failed-dial lane witness, and the r321 browser drive-by gate are now
documented; the sync GET shape was re-verified live
(`serverDriving` / `lastSeenAt` / `registry` / `runs` / `executorLane` with
`ready, reason, providerLabel, maskedKey, slotProvider, slotCount` /
`vaultLane`). Not re-verified live this pass: the vault
`consume` round-trip against a stored key (the keyless dev profile can only
witness the no-key lane) and the prune-on-push registry path (no enabled
schedules in the dev registry). Future rounds changing these endpoints
should treat this file as part of the blast radius.
