# E2E Harness — Stall-Failover & Lane QA Recipes

Consolidated doctrine for browser-direct vs server-relay QA rounds (epic v4→v16).
Read this BEFORE attempting a capture round — recipes were historically re-derived
from worklog.md each attempt and cost budget.

## Round-budget doctrine
- Patrol budget 8 rounds, review budget 12. Exceeding kills the recurring job.
- Visual-capture rounds historically overrun (r94: 13/12). Early clean exit is a SUCCESS.
- Never run builds or heavy suites. Verify via live HMR + console scan + health curl only.

## Canonical route recipe (r95+)
1. `agent-browser open http://localhost:3000`
2. Click the **"Workflows" client-side nav button** (sidebar). `/workflows` as a URL is **404** — root is the dashboard menu.
3. Probe card ("Stall Probe v4") renders **in-panel after reload-to-hydrate**. If the card is missing, reload root once, re-click Workflows, re-snapshot.

## Injection — inject-v8.js is the ONLY valid injector
- `inject-v4.js` / `inject-v7.js` are BROKEN (falsified): they wrote envelope-root
  mirror keys (`state.provider` etc.) that the store IGNORES. Real Settings live at
  `state.settings.*` inside the zustand-persist envelope.
- What inject-v8 does (verify before trusting — read the file):
  - Backs up `praison-settings` → `praison-bak-settings` (atomic-restore anchor)
  - Sets `provider=custom`, `baseUrl=http://localhost:4319/v1`, `defaultModel=hang-test`
  - Disables relay (`relayEnabled=false`) so the FIRST dial is browser-direct
  - Sets `praison-stall-timeout-ms=20000` (watchdog window)
  - Also touches `praison-agents` (backs up → `praison-bak-agents`)
- Execute via `agent-browser eval "$(cat scripts/inject-v8.js)"` after opening root.

## hang-server
- `bun scripts/hang-server.ts` — stalling stream server on **port 4319**.
- Start it BEFORE the run; it never answers, so the runner watchdog aborts at ~20s
  with: `no model output for over Ns — the stream stalled`.

## start-v4-run.sh — PARTIALLY STALE
- The h3-at-root probe-card recipe inside it is STALE (pre-r95 route map).
- Still useful: the dialog fill + enabled-Run-button click steps (textarea value
  setter + input event, `[role=dialog]` scoping).
- Route steps: replace with the canonical recipe above.

## Expected E2E arc (v9/v10 behavior)
1. Run dials browser-direct → hang-server stalls → runner watchdog aborts (~20s).
2. v10 classification: watchdog reason matches `isWatchdogAbortReason` → NOT a user
   cancel → fallback lane engages with a clean (signal-stripped) relay call.
3. Relay leg dials `/api/chat` (network count 0→1) → **SSRF guard rejects
   `http://localhost:4319` BY DESIGN** (`route.ts:120` — non-public-https).
   The rejection copy shown to the user is the honest terminal surface, not a bug.
4. Surfaces to capture: v11 "Retry via relay" button (sky accent since v15),
   v11b per-call lane notes (⇄ sky / ↻ amber), v13 lane-ratio chip in the call
   summary, v15 recovery card glow + ping + error copy-button, v14 chat header
   chip, v17 sidebar lane dots, v16 export receipts.

## Unit test
- `bun scripts/test-v9-abort.ts` → **17 checks, 0 fail** is green
  (r95 worklog text once said "18/18" — off-by-one typo; the suite is 17).

## Atomic state-restore doctrine (zero residue)
1. Restore from bak keys (`praison-bak-settings` → `praison-settings`, same for
   agents/workflows) via agent-browser eval.
2. Reload → verify state (provider/baseUrl back to user values).
3. ONLY THEN delete the bak keys.
4. Re-verify zero `praison-bak-*` keys remain. Never delete baks before verify.

### r446 incident — bak-key contract (PAID IN DATA, read this)
- Bak key names are `praison-bak-<SHORT>` where SHORT ∈ {settings, agents,
  workflows, conversations}. NEVER construct them as `praison-bak-<full-key>`
  (`praison-bak-praison-settings` silently matches nothing).
- The restore eval's output is a GATE, not a log line: if ANY key reports
  no-bak/MISSING, ABORT the chain — never run the delete step after a no-op
  restore. In r446 a mis-named restore no-oped, the chain continued, and only
  a second naming bug (in the delete) prevented permanent loss; the bak keys
  then vanished unexplained one round later (no app/script path deletes them —
  suspect agent-browser daemon state), so the originals became unrecoverable.
- Recovery that DID work: inject-v8 prints `preReal` (provider fields) before
  mutating, and its mutation rule is exact (only `model===""| "auto"` agents
  become `hang-test`, count = agentsTouched) — reconstruction = restore preReal
  + invert the rule (`hang-test` → `auto`) + remove injected artifacts by id.
  Unrecoverable by any recipe: `settings.providerKeys` entries wiped by
  inject-v8 (key material lived only in the QA profile's settings envelope).
- The agent-injection recipe for r446's heartbeat witness is superseded by
  this file's rule: conversation injection must be paired with the SAME
  short-name bak discipline (`praison-bak-conversations` ✓ was correct).

## QA console scan
`agent-browser console | grep -iE "error|warn|failed"` — HMR/Fast-Refresh info
noise is expected and fine; anything else is a finding.

## agent-browser QA doctrine (r417-r425, accumulated + falsified)

Each lesson below was paid for in budget (r420 alone burned 4 rounds re-deriving
three of them; r424 burned 2 more). Read before ANY interactive QA round.
**Verify STATE (data-state, aria-checked, DOM delta), never the harness's "✓ Done".**

### Selection & activation
- `:has-text()` is NOT supported (selector error, r420). Pure CSS only —
  positional selectors like `[role="tablist"] [role="tab"]:nth-child(3)` work
  and are the verified path for Radix Tabs.
- Radix Tabs CANNOT be activated by synthetic PointerEvents dispatched from
  `eval` — the hand-rolled pointerdown/mousedown/pointerup/click chain leaves
  `data-state="inactive"` (r425 falsification). Use the native `agent-browser
  click` (trusted CDP events).
- Conversely, plain shadcn Buttons can silently NO-OP under native `click`:
  "✓ Done" is printed while React state stays unchanged (r420). Escape hatch:
  eval a native `el.click()` inside an IIFE. Either way, assert the resulting
  state, not the ack.
- Controlled inputs need a real `type <selector> <text>`. And `type` APPENDS to
  an existing value (r423): a test string typed into the GH username input
  produced `specimba` + suffix. Select/clear first for replacement semantics.

### eval discipline
- eval scope PERSISTS across calls (r420): a top-level `const li` throws
  "already declared" on the next eval. Wrap EVERY eval body in an IIFE.
- Guard every `.find()` before dispatching on its result (r424): an unguarded
  find returns undefined and the TypeError kills the eval — in a chained bash
  call, the earlier steps' stdout is swallowed with it. Return diagnostics
  (URL, element counts) from step 1 of any chain, and append `|| echo
  "STEP-FAIL"` per step so one failure doesn't abort the rest.
- eval can race `open` and land on chrome-error:// (SecurityError signature,
  r420): sleep ~2-3s after open and assert `location.pathname` inside the eval
  before touching DOM.
- State assertions after a synthetic event must run in a SEPARATE eval/round-trip
  (r430): dispatchEvent is synchronous, but React's re-render (dialog unmount,
  effect cleanups like focus-restore) settles a tick LATER — asserting in the
  same eval reads stale DOM and fails a correct implementation. The async
  cousin of "verify state, not the ack".
- Before injecting localStorage state, check the store sanitizer contract —
  the inject-v8 doctrine above still applies (envelope-root mirror keys are
  ignored by the store).

## Probe status
- `probe-r345-vault-mirror.mjs` RETIRED (r426): source-regex probes pin
  implementation details (function names, code shape) and shatter on every
  refactor — 9/23 assertions were permanently stale after the r337/r340 mirror
  rework (refute-first proven: same failures on a clean HEAD, r422). Its
  one-time mission (the r345 re-land) completed long ago; the surviving
  replacements are live agent-browser QA (per this file) and the a11y audit,
  which pins a stable contract (aria-label presence) instead of code shape.
  Rule of thumb: a probe that greps source text dies with the next refactor —
  prefer behavior-level assertions.
