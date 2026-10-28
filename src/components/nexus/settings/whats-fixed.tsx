"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * r195: the platform shipped nine rounds of pipeline/relay fixes (r186-r194)
 * while the user's board looked unchanged — dev HMR dies silently in
 * background tabs, and a changelog living only in git is invisible to the
 * person who needs it. This section is the in-app receipt: what changed, and
 * the exact chip/banner/pill to look for on the Workflows board. Reading this
 * panel at all is itself proof the tab is running r195+ code (the section
 * did not exist in older bundles).
 */

interface FixNote {
  round: string;
  title: string;
  detail: string;
  lookFor?: string;
}

const FIXES: FixNote[] = [
  { round: "r674", title: "The whole review fleet refuses family-cousins — verification gate + peer blind score join the doctrine", detail: "r673 taught the generate gate cross-family manners; r674 extends them to the other two judges. prev entries now carry genFamily (the producing dial's provider family) through every push site — review outputs, rework outputs, verification-passed drafts, final outputs — so the crew VERIFICATION gate (System-One notes) and the PEER blind score both dial family-disjoint rungs first. Peer notes join the witness vocabulary: 'Peer blind score PASS 92% (fast-model · cross-family)'. ⚖ gate chips gained cursor-help alongside the ledger chip. Ledger census stable at 11·4 — auto-growth witness still pending the next natural run.", lookFor: "Run a workflow with verification/crew roles on → System-One and Peer blind score notes end in (fast-model · cross-family|same-family) when the generator family was known; hover any ⚖ chip for the pointer affordance." },
  { round: "r675", title: "Replacement dials re-stamp the family — re-dialed outputs are witnessed by their OWN lane", detail: "When a gate rejects a draft, the replacement pass (looped tied block, single rework, peer blind-revise) dials a fresh lane — but until r675 the step's stamped genFamily still pointed at the ORIGINAL draft's lane, so downstream judges computed family-disjointness against a stale family. All three replacement sites now refresh genFamily from the dial that actually produced the kept output (truthy-guarded: an unknown family never clobbers a known one); the looped re-judge (v2) compares against the replacement's family too. The ↻ looped board chip gained cursor-help alongside ⧉/⚖.", lookFor: "Steps with reworked/looped passes: subsequent gates judge against the replacement lane's family; hover the ↻ looped chip for the pointer affordance." },
  { round: "r676", title: "The drift witness is now a chip — family verdicts read at a glance in the call log", detail: "Since r673 the verdict notes carry '(fast-model · cross-family)' but the suffix was buried in mono prose. The run-panel call log now splits the witness token out and renders it as a tone chip: violet ◈ CROSS-FAMILY when the judge rung is family-disjoint from the generator (no narcissistic drift), muted ◇ SAME-FAMILY when no disjoint lane was available. Un-witnessed pre-r673 notes render untouched. QA side: the golden harness gained a readiness-retry (cold-route lazy-compile blocked Runtime.evaluate once — the r676 P2 catch) and the P3 palette finally opens headless via raw CDP Input.dispatchKeyEvent (⌘K modifiers:4) — synthetic KeyboardEvent was filtered by cmdk's trust gate; the harness now picks a workflow through the palette and long-pastes into the panel: full P3 witness for the first time.", lookFor: "Run-panel call log: verdict notes end in a small ◈ CROSS-FAMILY (violet) or ◇ SAME-FAMILY (muted) chip; hover it for the drift doctrine." },
  { round: "r673", title: "Cross-family judge — the gate no longer lets a model's cousins grade its homework", detail: "The KICK corpus's RSI doctrine lands in the Decision gate: every judge rung now knows its provider family (hop key, intern-decision-4b → intern-ai, jev → typesafe), the ladder takes the generator's dialed family from streamStep, and family-DISJOINT fast-judge hops answer first — a GLM-lane judge never reviews a GLM-lane draft. Honest degradation: with no disjoint hop the chain is unchanged and the verdict note says 'same-family' instead of pretending. Every verdict note carries the witness: 'Decision gate PASS 95% (fast-model · cross-family)'. Fixtures: qa-cross-family freezes the family mapper, the chain-reorder preference, the tag contract, and census compatibility (the suffixed notes still parse as verdicts).", lookFor: "Run a workflow with the gate on → call-log note reads '(fast-model · cross-family)' when the judge hopped providers; run-panel and board chips unchanged in shape." },
  { round: "r672", title: "Cortex revision — persisted liveness census + HUD vocabulary; RSI eval ledger lands in SQLite", detail: "The Owner's KICKspeciBOT deep dive (two expert agents over upload/kickbot/) found the Cortex card stale: its probe verdict was ephemeral (died on reload) and the lane-armed badge stayed green even while the edge function was down. Now: every probe verdict persists (cortex-census adapter, never-throw) and renders as an always-on chip + HUD status line in the KICK corpus telemetry vocabulary (CORTEX // ONLINE · 6/6 LANES · FRA1 · 34MS — vocabulary, not palette); armed configs auto-probe on mount past a 15-min freshness window. Second ship: gate outcomes from finished runs now land in a durable SQLite ledger (EvalEvent via /api/evals, the corpus interaction_logs pattern) — the Runs board digest gains a ledger N·M chip fed by a live census GET. Fixtures: qa-cortex-census 16/16, qa-gate-events 13/13.", lookFor: "Settings → Cortex Edge: CORTEX // chip beside the title + mono status line with tone dot; Runs board digest: the ledger chip once events accumulate." },
  { round: "r671", title: "Board digest speaks gate health — and the patrol template stopped chasing ghosts", detail: "The Runs board digest line now aggregates the Decision gate census across every visible card — ⚖ 5 gate calls · 4 verdicts · 2 latest-FAIL live on first render — amber when any run's latest verdict is a FAIL, emerald when verdicts landed clean, muted while judges stay unanswered: the r670 chip tone contract, aggregated to scan level. Both ⚖ chips gained transition-colors so tone changes animate. Doc side: the cron-template paste block's stale TASK-101/102 references are reworded to the real backlog anchors (the live z.ai cron payload is Owner-side and keeps the old text until the job is edited there).", lookFor: "Runs board top digest: N runs on the board · N harness debts · ⚖ N gate calls · N verdicts — the ⚖ chip is amber while FAIL verdicts lead, emerald when clean." },
  { round: "r670", title: "Gate chips now color by the LATEST verdict — a FAIL never reads green", detail: "The r669 verdict line rendered inside a chip that stayed emerald whenever ANY verdict landed — a FAIL 95% read as success. The census adapter now derives the tone from the LATEST verdict (rework-then-pass runs read PASS — the run's final gate state): emerald PASS, amber FAIL, muted engaged-only, matching the r659 note-family colors at chip level. Fixture catch en route: a junk callLog row (note: 123) crashed the reader — gateCensusOf now skips non-string notes (25/25 in scripts/qa-gate-census.ts, the adapter's first fixture).", lookFor: "Runs board: the both-families-FAIL chip (1·2 · FAIL 95%) is amber; the fast-model PASS run (1·1 · PASS 95%) is emerald; the fast-model FAIL run (1·1 · FAIL 95%) is amber; no-judge runs stay muted." },
  { round: "r669", title: "Gate census counts both verdict families — and shows the verdict at a glance", detail: "The r668 census adapter counted verdicts only from System-One gate notes; the runner also stamps Decision gate PASS/FAIL N% (fast-model) notes — real verdicts that rendered as engagement-only (runs showed 1·0 with a verdict inside). The census now recognizes both families (no-judge traces stay engagement-only) and extracts the outcome line (FAIL 95% / PASS 95%) onto the board and panel-header chips. Data receipt from the store: the ledger holds verdicts from three Novelty Lab runs, including a PASS 95% — the judge ladder answers outside congestion windows.", lookFor: "Runs board ⚖ chips end with the outcome when a verdict landed — e.g. ⚖ gate 2·2 · FAIL 95% in emerald; three runs gained their verdict dot." },
  // r242: the array stays CHRONOLOGICAL (oldest → newest, new receipts append
  // at the bottom) and the component renders it REVERSED, so the newest
  // receipt is what a returning user sees first.
  {
    round: "r186",
    title: "Deep pipelines degrade instead of dying",
    detail:
      "After repeated scheduled failures a Deep pipeline drops to Standard depth instead of dying 0/11 within minutes.",
    lookFor: 'violet chip "deep paused · firing standard" on the card',
  },
  {
    round: "r187-r188",
    title: "Relay rotation learns from the FULL error",
    detail:
      "Dead hops (tier / region / auth / maintenance) are skipped for hours instead of re-dialed every turn; a rejected key sinks its whole provider family; 429s never demote a hop. Classification now reads the complete upstream error, not a 90-character fragment.",
  },
  {
    round: "r189",
    title: "Stale tabs announce themselves",
    detail:
      "Background tabs stop hot-reloading silently — old code kept firing old bugs for hours. A stale tab now shows a toast plus an amber reload pill within a minute of a new build.",
    lookFor: 'if you see the amber "App updated" pill, click it — that click may fix more than any patch',
  },
  {
    round: "r190-r191",
    title: "Evolution proposals actually rotate",
    detail:
      "A stalled pipeline gets a different angle each proposal (arXiv:2609.37834 branch router), and proposals now learn which branches historically produced novel output instead of repeating the same suggestion.",
  },
  {
    round: "r192",
    title: "The board explains parked schedules",
    detail:
      "When the failure breaker auto-pauses schedules, a red banner names them, cites the failure streak, and offers a one-click bulk resume — no more a board that just looks dead.",
    lookFor: 'red "Lane degraded — N schedules auto-paused" banner with a Resume all button',
  },
  {
    round: "r193",
    title: "Exports no longer leak API keys",
    detail:
      "The full-data export (nexus-export.json) strips settings keys before download; the provider vault backup remains the sanctioned way to move keys between browsers.",
  },
  {
    round: "r194",
    title: "Relay reads structured error codes",
    detail:
      "model_not_found / permission_denied / account_deactivated / region codes inside JSON envelopes now classify correctly even when the message text is uninformative — corpses stop being re-dialed all night.",
  },
  {
    round: "r195",
    title: "This panel — the receipt for the invisible rounds",
    detail:
      "Nine rounds of pipeline repairs landed while boards could look unchanged. Settings now leads with what changed and the exact board evidence to check, so fixes stop living only in git. Reading this panel proves the tab runs current code.",
  },
  {
    round: "r196",
    title: "Imports can no longer wipe your API keys",
    detail:
      "Since r193 exports carry no credentials — but importing one still replaced settings wholesale, silently clearing this browser's provider keys. Import now keeps every credential field the file is silent on, and the confirm dialog states exactly what happens to keys.",
    lookFor:
      'the amber "No credentials in this export" note inside the import confirm dialog',
  },
  {
    round: "r237-r238",
    title: "Workflow Studio is searchable",
    detail:
      "The pipeline list gains a real search box — one needle matches names, descriptions, step labels, step instructions, agent names and even the schedule task text that says what a recurring pipeline is for. Live result count, Esc or the × button clears, and a no-match state offers a one-click reset. Cards now also show that schedule task line, so a hit by intent is visible on the card itself.",
    lookFor:
      'the "Search pipelines, agents, steps, schedules…" box above the card grid — press / to jump into it',
  },
  {
    round: "r239",
    title: "Pipeline cards show their recurring intent",
    detail:
      "A pipeline with a schedule shows the schedule's task line right on the card (clock icon, muted) when it says something the description doesn't — so a pipeline found by what it does shows what it does.",
    lookFor: "the clock line under the description on scheduled cards",
  },
  {
    round: "r240",
    title: "Trend Radar remembers where you were",
    detail:
      "Switching views no longer resets the HF Trending Hub section (models/datasets/spaces) or an arXiv query you had typed but not yet searched — the GitHub tab already remembered its username, now the other two tabs match.",
    lookFor: "set the Hub section to Datasets, navigate away and back — it stays",
  },
  {
    round: "r241",
    title: "Markdown in replies renders images & checklists",
    detail:
      "Model replies that embed images now show them clamped to the card (lazy-loaded), broken image URLs get a clean fallback that keeps the alt text instead of the browser's raw broken glyph, inline data-URI images (charts, screenshots) actually render, and - [x] task lists display as real checkboxes.",
    lookFor: "images in replies stay inside the bubble; task lists show checkboxes",
  },
  {
    round: "r270",
    title: "Copy buttons survive clipboard blockers",
    detail:
      "Copy actions (referral link, model names) used to die silently wherever the Clipboard API is unavailable or denied — HTTP origins, embedded frames, focus races. They now fall back to the legacy hidden-textarea copy, and if the browser blocks that too you get an explicit \"Copy failed\" toast instead of nothing.",
    lookFor: "copy the referral link in Settings — a success or an honest failure toast, never silence",
  },
  {
    round: "r271",
    title: "Motion respects your OS reduce-motion setting",
    detail:
      "With prefers-reduced-motion enabled, every looping animation (model ticker, typing dots, ripples, EQ bars, shimmer) and all slide/fade view transitions now stop app-wide (WCAG 2.3.3). Previously only the ticker complied — the rest kept moving for vestibular-sensitive users.",
    lookFor: "enable reduce motion in your OS and reload — the ticker freezes, views switch without sliding",
  },
  {
    round: "r272",
    title: "Every view is deep-linkable",
    detail:
      "#/chat, #/agents, #/workflows and #/settings now open their view directly, like the existing #/setup, #/providers and #/radar links. Bare #/settings lands at the top of Settings instead of a section, and any of these links cleanly exits the setup wizard.",
    lookFor: "add #/agents to the URL and reload — the agents view opens; bookmarkable",
  },
  {
    round: "r273",
    title: "Trend Radar's watched-lanes count stopped overclaiming",
    detail:
      "A wide filter made the header say \"250 shown\" while the list rendered its first 120 rows; the header now reads \"first 120 of 250 shown\" when a result set outgrows the render cap.",
  },
  {
    round: "r287",
    title: "Trend Radar's HF hub is filterable",
    detail:
      "The HF Trending section gains a keyword filter matching model id, pipeline tag and library name, with an honest \"N of M\" count line and a \"Nothing matches\" empty state — a 250-row wall is now three keystrokes from the one model you wanted.",
    lookFor: "the filter box on the HF Trending hub — type a tag and watch the count line",
  },
  {
    round: "r289",
    title: "Delete a single bad reply",
    detail:
      "Assistant replies can be removed one at a time (heartbeat noise, a failed or mistaken turn) without clearing the surrounding transcript. Two-click confirm: the first click arms the trash icon (red, auto-disarms after 2.5s), the second deletes. Hidden while the reply streams or is being read aloud.",
    lookFor: "hover an assistant reply → trash icon → click twice (the second click confirms)",
  },
  {
    round: "r290",
    title: "The signals card says what it truncates — and stale workflows explain themselves",
    detail:
      "The tracker's early-signals card rendered its first 24 rows while silently dropping the rest of a longer feed; it now states \"first 24 of N shown\" out loud (screen readers included). On the Workflows board, duplicating a workflow that just vanished or opening a kanban card whose pipeline is gone now shows an explicit refresh-sync toast instead of doing nothing.",
    lookFor: "when the signals feed exceeds the cap: \"first 24 of N shown\" above the list",
  },
  {
    round: "r293",
    title: "Long chats stop re-rendering while a reply streams",
    detail:
      "Every streaming token used to re-render the whole transcript (an invisible memo breaker: five per-message callbacks were fresh closures on each render). Now only the streaming bubble updates — long conversations stay smooth while replies stream, and scrolling or toggling speech no longer redraws every message.",
  },
  {
    round: "r295",
    title: "The setup wizard stopped bouncing mid-flow",
    detail:
      "Opening the guided free-key setup from the sidebar, provider gallery or command palette and clicking \u201cSave & test\u201d or \u201cActivate\u201d snapped the dialog straight back to the provider picker: the wizard's reset effect subscribed to the very store slice its own save mutates, so saving re-fired the reset. Deep-link entries masked it, which is why hash-route QA never witnessed it. The reset now fires only on open/deep-link transitions.",
    lookFor: "Settings \u2192 Providers \u2192 guided setup: pick a provider, Save & test \u2014 the connect step stays put",
  },
  {
    round: "r296",
    title: "A validation that outlives your click can't haunt the next screen",
    detail:
      "Switching providers or closing the guided setup while a \u201cSave & test\u201d round-trip was still in flight could let the old dial's error render inside the new provider's dialog (witnessed live during r295's QA). In-flight validations are now invalidated by any provider switch or close \u2014 a result only applies if you are still on the provider you tested.",
  },
  {
    round: "r297",
    title: "The usage dashboard counts days like your calendar does",
    detail:
      "The 7-day activity chart bucketed messages by 24-hour arithmetic from today's midnight, which drifts an hour across DST transitions \u2014 the same defect class r267 fixed for the streak (late-evening and early-morning messages could land in the wrong day). Buckets are now true local calendar midnights. The tool mix also stops rendering a wall of zero rows: unused tool types are summarized out loud (\u201cN of M tool types unused\u201d) instead of drawn.",
    lookFor: "Settings \u2192 Usage: the tool mix lists only tools you have actually run",
  },
  {
    round: "r298",
    title: "The pipeline header no longer argues with its own runs",
    detail:
      "Deep pipelines run extra research passes at run time, so a 9-step pipeline actually shows 11 step rows per run \u2014 but the run panel's header still said \u201c9 steps\u201d right above the run's \u201c3/11\u201d banner. The header now reads the run-time count and states the delta out loud: \u201c11 steps per run \u00b7 9 authored + 2 deep-research passes\u201d. Pipelines without injected passes keep their plain step line.",
    lookFor:
      "Workflows \u2192 open a deep pipeline's run panel: the small line under the task box matches the step rows below it",
  },
  {
    round: "r300",
    title: "The fleet chip counts what it says it counts",
    detail:
      "The sidebar's tiny 'cron 2/2' chip labelled its ratio '(agentTurn)' while the denominator counted EVERY registry job \u2014 a paused schedule or a wrong-kind job (the forensics route still warns about the webDevReview era) silently shrank the ratio and lit the amber degraded state even when every agent was armed. Both sides of the ratio now count agentTurn jobs only, and paused or non-agentTurn jobs are named out loud in the tooltip instead of hiding inside the denominator.",
    lookFor:
      "Sidebar \u2192 hover the cron chip at the bottom: the tooltip says 'agentTurns armed' and names any paused or foreign jobs explicitly",
  },
  {
    round: "r301",
    title: "The radar remembers which tab you were on",
    detail:
      "The four radar tabs (Models / GitHub Stars / HF Trending / Paper Radar) snapped back to Models every time you left the view and returned \u2014 even though r240 already made the HF section, GitHub username and arXiv query survive the same trip. The active tab now persists locally and reopens exactly where you left it.",
    lookFor:
      "Radar \u2192 switch to any tab, visit Chat, come back: the same tab is still selected",
  },
  {
    round: "r302",
    title: "The HF board says what it's doing while it refreshes",
    detail:
      "Refreshing a cached Hugging Face board showed only a tiny spinner inside the Refresh button \u2014 up to 25 silent seconds that felt like a dead click (the GitHub Stars tab already prints an inline 'Refreshing from GitHub\u2026' line in the same situation). The HF tab now shows an inline, screen-reader-live status line until the board settles \u2014 and the agent importer's fallback tool-iteration cap now matches the create form's default (6) instead of a third value nobody chose (3).",
    lookFor:
      "Radar \u2192 HF Trending with a cached board \u2192 hit Refresh: an inline 'Refreshing from the Hugging Face Hub\u2026' line appears until the board settles",
  },
  {
    round: "r303",
    title: "Esc on the slash menu dismisses it instead of deleting your draft",
    detail:
      "Typing \u201C/\u201D opened the quick-actions menu, but pressing Esc \u2014 which the menu header literally promises will dismiss it \u2014 wiped the entire message you had typed so far. Dismissing a menu should never eat typed text (the same rule r144 set for stopping a reply), so Esc now just closes the menu and your draft stays; editing the text re-summons the menu, and Esc during an active CJK composition is left alone for the IME to cancel.",
    lookFor:
      "Chat \u2192 type \u201C/the\u201D \u2192 press Esc: the menu closes and \u201C/the\u201D is still in the composer",
  },
  {
    round: "r304",
    title: "The deep-pause chip stops claiming to fire while nothing fires",
    detail:
      "A Deep pipeline that failed twice in a row shows a \u201Cdeep paused\u201D chip \u2014 but it said \u201Cdeep paused \u00B7 firing standard\u201D even while the failure breaker or a rate-limit backoff had the whole schedule parked, a state in which nothing runs at all (witnessed stacked on the red \u201Cauto-paused\u201D chip). Paused schedules now say just \u201Cdeep paused\u201D and the tooltip explains what actually restores deep; the state is derived from one shared rule instead of a hardcoded string.",
    lookFor:
      "Workflows \u2192 a Deep pipeline card that is auto-paused or in backoff: the violet chip says \u201Cdeep paused\u201D with no firing claim; only an enabled schedule can show \u201C\u00B7 firing standard\u201D",
  },
  {
    round: "r305",
    title: "A 429 now rotates the pipeline to other providers instead of re-dialing the exhausted one",
    detail:
      "When a step hit a rate limit, the engine cooled down 20\u201345 seconds and then dialed the SAME provider family again \u2014 and because only mid-stream drops were remembered as \u201Csick\u201D, every later step re-learned the same saturation from scratch until the run parked. Now a 429 marks that provider family exhausted for 5 minutes across all runs: retries and later steps open on healthy lanes first (the exhausted lane is demoted to the back of the chain, never removed), and the cooldown grows with consecutive 429s on the same family (20s \u2192 45s \u2192 90s) so a saturated lane is approached slower each time instead of being hammered at a fixed pace.",
    lookFor:
      "Workflows \u2192 a run\u2019s call log after a 429: entries note \u201Ccongestion rotation \u2014 \u2026 demoted to the back of the wire\u201D and the next dial leads with another lane",
  },
  {
    round: "r306",
    title: "The pipeline now LEAVES an exhausted provider family — full provider rotation on the final attempt",
    detail:
      "r305 reordered the relay chain, but the retry ladder still re-dialed the just-429’d primary first (only mid-stream drops demoted it), and when every chain hop was exhausted the run parked. Now a 429 also puts the dialed provider on an exponential registry cooldown (60s → 2m → … capped at 15m) and demotes the primary for the next attempt, so attempt 2 leads with the built-in engine instead of hammering the saturated lane. If the family is still saturated on the final attempt, the dial leaves it entirely: a different provider you have a key for is rotated in (its own endpoint, model and key), or — when the whole roster is cooling — the engine waits exactly the soonest provider’s remaining window instead of blind-retrying into a fourth 429. A successful dial clears that provider’s cooldown immediately.",
    lookFor:
      "Workflows → a run’s call log after a 429 on a multi-key profile: the final attempt notes “registry rotation — <provider> dialed instead of the saturated <family> family” and dials a different endpoint; single-key profiles keep the r305 rotation behavior",
  },
  {
    round: "r307",
    title: "Mid-stream network drops now trigger provider rotation too — not just 429s",
    detail:
      "The r305/r306 rotation machinery fed off 429s only, but the live failure kind was different: streams that die MID-CALL after tool rounds succeeded (network/timeout drops). Those marked nothing, so the retry ladder kept re-dialing the same flaky lane and the rotation escape never fired. Now a proven mid-stream drop feeds the same saturation memory: the dropped provider’s family is demoted on the relay wire for 5 minutes across all runs, the next attempt leads with the built-in engine, and the final attempt rotates to another provider you have a key for. Note copy now reads “recent 429s or mid-stream drops”.",
    lookFor:
      "Workflows → a run’s call log after a mid-stream drop: the wire note says “recent 429s or mid-stream drops”; with a second provider key saved, the final attempt notes “registry rotation” instead of parking",
  },
  {
    round: "r308",
    title: "The “Lane degraded” breaker banner now names each schedule’s OWN failure streak",
    detail:
      "The banner attributed one MAX-across-schedules number to every listed name — if one pipeline failed 5 runs in a row and another only 2, both were announced as “failed 5 runs in a row”. Each schedule name now carries its own count (“Name” ×3 in a row), so the strip is honest about which pipeline actually burned which attempts.",
    lookFor:
      "Workflows → the red “Lane degraded” strip when the failure breaker has paused a schedule: each name reads “…” ×N in a row with its true count",
  },
  {
    round: "r309",
    title: "Server-side relay rotation no longer crashes on its own failure classifier",
    detail:
      "The relay failure classifiers (soft/dead/auth) lived in a client-only module while the dial engine is deliberately isomorphic — it runs both in the browser and inside the /api/chat server route. On the server, every one of those calls threw Next's client-boundary error — “Attempted to call isDeadlyRelayFailure() from the server” — and the run recorded THAT as the step error, so the relay ladder died at its first hop failure instead of rotating. The pure taxonomy moved to a directive-free core module both sides execute natively, and a boundary-guard QA script now fails if any server-graph module runtime-imports a client-only module again.",
    lookFor:
      "A run dying at step 1 with “Attempted to call … from the server” should be gone; after a provider hop fails, the relay emits its real rotation status line instead",
  },
  {
    round: "r310",
    title: "Out-of-credits (HTTP 402) failures are now honestly classified — and stop re-dialing the drained lane",
    detail:
      "A 402 from a provider's credit gate used to land in “Unknown — couldn't classify”, the lane only cooled for 5 minutes, and all step retries burned themselves against a wallet at $0.00. Credit-gate deaths are now their own class: the recovery card reads “Out of credits” with the two real fixes (top up the provider, or save a second key so rotation has another lane), the relay taxonomy stamps the lane DEAD for 6 hours, and OrcaRouter's workspace-wide credit gate sinks every orca lane at once — no more corpse-dialing a drained workspace.",
    lookFor:
      "A failed run card now reads “Out of credits” instead of “Unknown”; after a 402, the model picker shows the orca lanes as blocked until credits are added",
  },
  {
    round: "r311",
    title: "Imported plans no longer stamp an identical “tag ≠ worker” warning on every single step",
    detail:
      "Plans imported from a pasted source carry the authoring chain's “ [Role]” tags, so every step row showed the same amber “tag [X] ≠ worker” chip — nine repetitions, zero routing information. When EVERY tagged step mismatches its worker, the run panel and the pipeline card now show one honest summary line instead (“routing follows the assigned agents, never the titles”) and the per-step chips go quiet. A single mismatched step keeps its chip — that one is actionable.",
    lookFor:
      "Workflows → open the Continuous Research run: one amber note above the step list instead of a chip on every row; the pipeline card shows the same one-liner under the step chain",
  },
  {
    round: "r313",
    title: "A schedule you stopped yourself is no longer invisible on its card",
    detail:
      "Disabled schedules with a self-heal path (backoff) or a breaker trip (auto-paused) had chips — but a schedule YOU stopped rendered nothing, indistinguishable from a rendering gap, and resuming meant Edit → toggle. The card now shows a neutral “stopped · click to resume” chip (slate, not amber/red — it is an intentional human state, not a malfunction); one click re-enables it and it fires on the next tick.",
    lookFor:
      "Workflows → a schedule card you stopped shows the slate “stopped · click to resume” chip; clicking it re-enables the schedule with a toast",
  },
  {
    round: "r316",
    title: "Chat now tells you when a provider is still cooling from a 429",
    detail:
      "A 429 anywhere in the app puts that provider on a growing cooldown (60s doubling up to 15m) so scheduled workflow steps rotate off it — but chat dialed the same provider silently, so you re-hit the exact same rate limit with no hint why. The chat status line now reads the same shared cooldown map BEFORE dialing: “Provider cooling 90s (recent rate limit) — dialing anyway…”. Your pick still dials (it may succeed; the memory paces rotation, not your chat), and a fresh 429 extends the window.",
    lookFor:
      "Chat → send a message right after a 429: the status line above the reply shows “Provider cooling Ns …” before the provider is dialed",
  },
  {
    round: "r318",
    title: "Keyless free lanes now join the relay chain — a 429'd step finally has somewhere to rotate",
    detail:
      "With one saved key the fallback chain contained only that provider's own models (+ the built-in engine), so when its quota tripped, the step rotated inside the SAME quota bucket and parked (live: “⇄0 relay”, 13 gateway 429s in 24h). The chain now includes the registry's no-key free lanes; health memory sinks any that misbehave.",
    lookFor:
      "Workflows → after a 429, a run card's LLM calls row shows relay hops (⇄) > 0; steps survive single-provider quota trips instead of parking",
  },
  {
    round: "r319",
    title: "Tab-closed (server) runs now survive a 429 by rotating onto keyless free lanes",
    detail:
      "When the tab is closed the local server claims schedules and dialed the vault provider exactly once — a 429 was a dead end, so runs died on a saturated quota bucket (witnessed: server runs 0✓ 2✗). On a 429 the step now falls back to up to two registry no-key free lanes (never a credential — keyless by doctrine); failed lanes cool for later steps.",
    lookFor:
      "Server runs · 24h — after a Vyce 429, runs complete via a no-key free lane instead of ✗ error",
  },
  {
    round: "r320",
    title: "Run cards now witness failed dials by lane — “did rotation run?” is answerable at a glance",
    detail:
      "The LLM-calls tally counted only successful lanes (note prefixes), so an all-429 run read “⇄0 relay” even when the rotator HAD walked the free lanes — indistinguishable from a stale page that never rotated. Failed dials already record the exact engine they dialed; the card now groups them: “✗5 failed dials (Vyce · … ×3, Pollinations · openai-fast ×2)”. Pure UI — no store shape change.",
    lookFor:
      "Workflows → a parked run card's LLM calls row ends with ✗N failed dials (lane ×count, …); hard-reload the tab (Ctrl+Shift+R) so the newest engine bundle is live, and the free lane should appear among the failed (or successful) lanes",
  },
  {
    round: "r321",
    title: "The vault handoff endpoint now refuses cross-site browser calls (drive-by CSRF gate)",
    detail:
      "POST /api/vault/consume returns the stored key and sat behind the r138 localhost guard — which stops proxies and DNS-rebinding, but a page on another origin in your browser could still FIRE the POST (a text/plain body skips preflight; the route defaulted provider to builtin). The response was unreadable to that page only by same-origin-policy grace — now the gate is enforced server-side with the app's standard double-gate: foreign pages can't attach the x-nexus-csrf header without a preflight that is never granted, and Sec-Fetch-Site cross-site is rejected. The headless scheduler and CLI (no browser headers) pass unchanged; the Settings Test-key and reveal buttons were taught the header.",
    lookFor:
      "Settings → Automation vault → Test key still verifies as before (200 path); a cross-site caller now gets a 403 “consume rejects cross-site browser calls (CSRF gate)” instead of the key",
  },
  {
    round: "r323",
    title: "The free-lane rotation actually works now — the noKey flag it read had never been set",
    detail:
      "Honest root-cause confession: the r318 relay-chain widening and the r319 server fallback both filtered the provider registry by a “noKey” flag that ZERO providers ever set — pollinations, the documented keyless provider, included. Both passes silently rotated an empty lane list, so “⇄0 relay” would have persisted even after a reload. Pollinations now carries the flag: a runnable probe proves the chain grows the tier-2 no-key hop (keyless dial, apiKey undefined) and registry rotation reaches it, and the header picker gains Pollinations as a ready keyless pick (anonymous tier is real but shares a global IP budget — the 429 cooldown memory sinks the lane when it saturates).",
    lookFor:
      "Settings → provider gallery shows Pollinations as “No key needed — start chatting”; after a Vyce 429 (post-reload), the parked card's failed-dial witness should show a Pollinations dial among the lanes",
  },
  {
    round: "r325",
    title:
      "The vault route is uniformly CSRF-gated — upsert and delete included, not just the raw-key handoff",
    detail:
      "The r321 gate covered POST /api/vault/consume, but POST /api/vault (upsert) and DELETE /api/vault were still open to a drive-by page: a preflight-free simple request could overwrite a stored slot or plant an attacker-chosen provider+key pair the closed-tab executor would then dial. The house double-gate now guards GET, POST, and DELETE; every in-app caller sends the header; non-browser callers (scheduler, CLI, QA scripts) pass unchanged.",
    lookFor:
      "No visible change for you (headers are automatic) — Settings → Automation vault behaves exactly as before; foreign pages now get a 403 on every vault operation.",
  },
  {
    round: "r397",
    title: "Autopilot error chips now say WHAT failed, not just that something did",
    detail:
      "A failed run in the 24-hour history used to be an undifferentiated red ✗. Failures are now classified with the same production classifier the runner self-heals with: transient kinds (network / timeout / rate-limit) show an amber “↻ retried” chip with the kind label and an actionable hint, while fatal errors stay red “✗ error”. The chip row and the expanded line finally speak the same language.",
    lookFor:
      "Workflows → autopilot 24h history — the next failed run’s chip carries a kind label and hint instead of a bare ✗ (needs a real failed run to show; none existed at ship time)",
  },
  {
    round: "r398",
    title: "Evolution proposal goals no longer cut off mid-word",
    detail:
      "Proposal goals were truncated with a hard 220-character slice, so a goal could end “...continuous impro” and that fragment then seeded the whole proposal card. Word-boundary truncation replaces the slice: the goal ends on the last complete word inside the budget instead of amputating one.",
    lookFor:
      "Workflows → Evolution — any long proposal goal now ends on a whole word (visible on the next generated proposal)",
  },
  {
    round: "r400-r401",
    title: "The keyboard shortcuts are documented in the product — press ? anywhere",
    detail:
      "Five global shortcuts (⌘⇧N new chat, ⌘⇧F search, ⌘1–5 views, ? this sheet) existed for months with no surface listing them. Pressing ? outside a text field now opens a cheat-sheet dialog, and ⌘K’s Quick actions gained a searchable “Keyboard shortcuts” entry for pointer/touch users. The ? hotkey is deliberately modifier-less (GitHub/Gmail convention) and skips input fields, so typing a question mark still types a question mark.",
    lookFor:
      "Press ? on any view outside an input — the cheat sheet dialog opens; or ⌘K → “Keyboard shortcuts”",
  },
  {
    round: "r402",
    title: "The “server lane can’t dial” advice is now a button, not homework",
    detail:
      "When schedules are due while this tab is quiet, the autopilot’s blocked strip told you to go store a registry provider key in the Automation vault — then left you to find the path yourself. The strip now carries an “Open the Automation vault” button that switches to Settings and scrolls straight to the vault card via the same anchor mechanism as the deep links.",
    lookFor:
      "Workflows → autopilot strip after a tab-closed quiet window with due schedules — amber “Open the Automation vault” button lands on the vault card (transient by design: with the tab open the client lane drains due queues, so the strip may not appear)",
  },
  {
    round: "r403",
    title: "#/vault and #/evolution deep links — every Settings section is linkable now",
    detail:
      "The address-bar routes #/providers and #/local-models scrolled Settings to their sections, but #/vault and #/evolution were silently dead even though the app’s internal state supported both. The hash router now routes all four anchors (wizard dismissed, view switched, section scrolled into place). Share a teammate the exact vault or Evolution panel instead of “go to Settings and scroll”.",
    lookFor:
      "Open /#/vault (or /#/evolution) in the address bar — Settings opens scrolled to the Automation vault (or Evolution proposals) card",
  },
  {
    round: "r405-r406",
    title: "Deep links got completion: share buttons and per-conversation routes",
    detail:
      "The #/vault and #/evolution routes existed but nothing in the UI surfaced them — the vault and Evolution cards now carry Share buttons that copy the exact deep link. Conversations got the same treatment: #/chat/<id> opens a specific conversation, and the conversation list has a “Copy link” affordance, so “look at this chat” is a link instead of a treasure hunt.",
    lookFor:
      "Automation vault card → Share; conversation list row menu → “Copy link” — the pasted URL opens the same spot",
  },
  {
    round: "r409-r410",
    title: "⌘⇧F search finds agents now — and its copy tells the truth",
    detail:
      "Global search matched conversations and models but returned nothing for agents — the roster was invisible to its own search surface. Agent hits landed, and the search panel’s helper copy was corrected to describe what it actually searches instead of overpromising.",
    lookFor: "Press ⌘⇧F and type an agent’s name — the agent appears as a hit",
  },
  {
    round: "r414-r415",
    title: "The storage-quota crash is fixed — and you can see what eats your quota",
    detail:
      "Four QuotaExceededError overlays (“setItem on Storage failed” for nexus-settings) could bury the app when localStorage filled — writes are guarded now, so a full quota degrades gracefully instead of stacking error toasts. The companion fix is visibility: Settings → Your Data gained an honest Storage meter showing every nexus-* key’s size against the ~5 MB browser budget.",
    lookFor:
      "Settings → Your Data → Storage card: per-key rows, a Recheck button, and honest over-budget notes instead of silent failures",
  },
  {
    round: "r427",
    title: "In-app navigation lands in the address bar",
    detail:
      "The SPA router was one-way: the hash could take you somewhere, but clicking around never updated the URL — refreshing or sharing the tab always dumped you back at the default view. In-app navigation now reflects into the hash, so refresh, bookmark and share all reopen the view you were actually on.",
    lookFor: "Switch to Workflows — the address bar follows (#/workflows); a refresh reopens the same view",
  },
  {
    round: "r428",
    title: "The Agents roster is searchable",
    detail:
      "Rosters grow faster than scrolling: the Agents view gained a search box that filters the roster by name as you type, matching the search affordances the conversations and models surfaces already had.",
    lookFor: "Agents view → type in the roster search — the grid narrows as you type",
  },
  {
    round: "r429-r431",
    title: "The server-run drawer is keyboard-complete",
    detail:
      "Opening a server-run detail drawer dropped keyboard users into the page behind it: focus wasn’t moved in, Tab could escape under the overlay, and closing it left focus wherever it had wandered. The drawer now takes focus on open, traps Tab at both edges, re-captures it if it falls to the page, and Escape restores focus to the card that opened it.",
    lookFor:
      "Workflows → a ⇉ server-run card → Enter: Tab cycles inside the drawer, Escape closes and focus returns to the card",
  },
  {
    round: "r432",
    title: "Download on a generated image actually saves the file",
    detail:
      "Image generation returns a provider-hosted https URL, and browsers ignore the anchor download attribute cross-origin — so “Download” silently navigated to the image in the same tab instead of saving anything. The button now fetches the image to a blob and saves a real file (extension from the actual mime type); if the host blocks that fetch, it opens the image in a new tab with a toast explaining why, instead of pretending.",
    lookFor:
      "Composer → Open Image Studio → generate → Download: a file lands in your downloads (or an honest new tab + toast, never a silent navigation)",
  },
  {
    round: "r433",
    title: "The storage meter names every key it counts",
    detail:
      "The Storage meter listed raw localStorage key names — “nexus-radar-hf” defeats the point of a “where does my budget go” card. Every key the app writes now has a plain-language label (radar caches, provider vault, automation vault, relay health log…); genuinely unknown keys still show raw, honestly.",
    lookFor: "Settings → Your Data → Storage: rows read “HF trending cache”, “Provider vault”… not raw nexus-* names",
  },
  {
    round: "r434-r435",
    title: "The model tracker reaches every lane it watches",
    detail:
      "The tracker watched 160 lanes but the ticker panel listed 60 and the radar table 120 — the rest were invisible in the very views that claimed to show them. Both surfaces gained search over the full lane set (ids, display names, providers) with honest match counts and stated caps, so any watched lane is now findable and pinnable.",
    lookFor:
      "Ticker panel or Radar → Models: a search box; footers/captions state “showing 60 of 160” / “N of 160 match” instead of silently truncating",
  },
  {
    round: "r437",
    title: "A rescued dial is remembered — the next congested step leads with the lane that just worked",
    detail:
      "Forensics on a parked hourly run: attempt-3 rotation rescued one step via a free provider (a 512s research pass ✓), yet the next three dials led with the saturated built-in engine anyway and the run parked with a proven-healthy lane sitting ready. The engine now records any substituted dial that finishes a full successful call and — for the next 15 minutes — leads congested dials with that proven lane before the built-in engine, and final-attempt rotation prefers it over registry order. The memory clears the moment the rescue lane itself fails.",
    lookFor:
      "Workflows → a parked-then-resumed run's LLM calls: after a “(registry rotation)” success, the next demoted dial reads “(rescue lane leads)” instead of “auto (primary demoted)”",
  },
  {
    round: "r438",
    title: "The rescue lane works with the tab closed too — and the board can finally see it",
    detail:
      "The server scheduler (closed-tab hourly runs — how the parked runs actually fire) walked its fallback ladder in raw registry order: it kept negative memory (saturated lanes ride the back) but never remembered WHICH lane had just answered. The r437 rescue-lane memory now covers the server lane as well: a completed fallback answer leads the next congested dial for 15 minutes, and an unrelated lane's failure never erases another lane's evidence. The gateway pulse exposes that proof live, so it is no longer invisible module state.",
    lookFor:
      "Workflows → gateway pulse: when the server lane records a rescue, an emerald “rescue lane · {provider} · Nm left” chip appears beside the amber 429 chip (server lane only; an open browser tab's engine keeps its own memory)",
  },
  {
    round: "r439",
    title: "Every live model is findable — the composer can no longer shrink the picker's world",
    detail:
      "The chat composer capped every provider's live model roster at 20 before handing options to the model picker, so live models 21+ were unsearchable and unselectable even though the picker promises full catalogs. The cap is gone and the picker now owns its search: honest match counts over label/id/note/keywords, a stated 60-row render cap instead of a silent one, and a “No model matches” state kept distinct from an empty catalog. All four picker surfaces (chat composer, provider gallery, setup wizard, agent form) inherit the fix for free.",
    lookFor:
      "Chat composer → model picker: searching “glm” shows “3 of 31 match”; a nonsense query shows “No model matches” instead of a silently empty list",
  },
  {
    round: "r442",
    title: "Same-minute schedules stop colliding — next-fire times drift apart instead of stacking",
    detail:
      "Forensics on the parked evening runs found the upstream cause: schedules enabled in the same minute re-armed collinearly forever (next-fire = last-fire + interval, phase locked), so N schedules met the shared gateway at the same minute EVERY interval. A deterministic per-schedule offset (≤90s, capped at 20% of the interval) now spreads the first fire and every re-arm on the closed-tab lane — stable per schedule, never re-randomized mid-life.",
    lookFor:
      "Workflows board → next-fire times: after a server-lane fire, same-minute schedules drift apart by up to 90s instead of staying collinear",
  },
  {
    round: "r443",
    title: "The closed-tab executor can no longer stampede — “one run per tick” is finally true",
    detail:
      "The server scheduler's 15s claim loop fired each tick with no overlap guard while a tick awaits the ENTIRE pipeline (runs take minutes): every 15s a new overlapping tick re-claimed the same still-overdue workflow and launched another concurrent copy — a 10-minute pipeline could stampede into ~40 simultaneous runs in the first tab-closed window. An in-flight guard makes overlapping ticks honest no-ops; the next overdue schedule is claimed the moment the current run settles.",
    lookFor:
      "after the first real closed-tab fire, the server-run panel shows exactly ONE new run — not a stack of simultaneous copies of the same workflow",
  },
  {
    round: "r516",
    title: "Routing reads the leaderboards, not name-words — and every panel you reported un-scrollable now scrolls",
    detail:
      "Four owner-reported fixes. (1) Lane order is benchmark-led: a new intelligence index distills arena.ai (WebDev + Agent boards) and Artificial Analysis (intelligence + coding agents) server-side, caches 6h, and the relay chain blends 65% benchmark · 35% catalog Elo within each class — the diffusion speed lane no longer outranks benchmark-proven free frontier models because a hand-typed constant said so. (2) The Frontier Scout tab (and every radar tab) is its own scroll container — tall boards no longer clip with no way down. (3) The workflow run panel caps the task box at ~8 lines with internal scroll, so a long pasted instruction can never push the Run button out of reach; the step log gained the missing min-h-0 shrink. (4) The GitHub radar's rate-limit wall grew an escape hatch: a 403/429 on the shared egress IP now retries through the Webshare pool automatically and says so honestly. Bonus: per-step Decision Gates — the free Intern Decision-4B primitive judges every workflow step output (confident FAIL → one free rework pass) on its separate 200 RPM decision quota.",
    lookFor:
      "Settings → Model Relay: an emerald “Benchmark intelligence” panel (source chips + top-6 board + Refresh) and “Intel 0.9xx” badges on every hop; Radar → Frontier scrolls; a long paste in the run panel keeps Run visible; a GitHub refresh that needed the pool toasts “Refreshed via the egress pool”",
  },
  // r654: the receipts backlog — 138 rounds shipped after r516 while this
  // panel rendered nothing newer (Owner's own paste proved the stall). The
  // entries below are compressed ARC digests, each sourced from the round's
  // commit chain, not invented detail. Patrol rounds append here again.
  {
    round: "r654",
    title: "The receipts return — this panel had quietly stalled at r516",
    detail:
      "Honest confession, caught from the Owner's own capture: 138 rounds shipped (r517-r653) while this panel rendered nothing newer — receipts lived only in git + worklog, and the auto-derived range label kept LOOKING alive (the r294 guard protects the header string, not the backlog). This round backfills the arcs below as compressed digests and bounds the list with an internal scroll so the growing wall stays scannable; patrol rounds feed this panel again from now on.",
    lookFor:
      "this panel leads with r654 and the entry list scrolls internally instead of stretching Settings",
  },
  {
    round: "r651-r653",
    title: "The run archive became a precedent lane — and was witnessed live",
    detail:
      "arXiv:2610.31421 F6/F7 ported dial-free: past SUCCESSFUL run outputs are the precedent store — a shared honesty mapper refuses blind rows (the archive chip's verdict gates eligibility), an RRF hybrid retriever picks the top-2 similar precedents, a both-legs confidence gate refuses single-leg noise (the refusal is still countable in the call log), and the survivors ride every step's context as two-occurrence exemplars closest to the generation point. Closed the loop on a REAL run: the persisted call log carried 'Precedent lane — 13 eligible precedents, top 2 … both legs … block injected'.",
    lookFor:
      "a workflow run's call log shows a violet ◈ 'Precedent lane …' note; the workflow editor's generate steps mirror the same verdict as a live preview chip (emerald 'gate ✓ both legs' / amber 'gate · single-leg')",
  },
  {
    round: "r648-r650",
    title: "TraceTrial: every run surface grew an evidence-honest harness chip",
    detail:
      "arXiv:2610.32285 ported: run-history rows, runs-board cards and archive rows each render a harness chip scored ONLY over the evidence that surface actually materializes (six criteria at the run surface; one — lineage — at the archive, with the bypassed count named in the tooltip: visible zero, not attributed). The F3 'harness debts' census (success despite violation — green masks red) is visible at all three altitudes, and a control test pins the vacuous-pass it prevents.",
    lookFor:
      "run cards and archive rows carry a harness chip; the archive toolbar shows 'N harness debts' only when real debts exist",
  },
  {
    round: "r641-r647",
    title: "Radar grew a registry canary — in both directions — and generate steps learned to loop",
    detail:
      "The radar compares registry.enabled against the previous digest: a ≥2→0 collapse is CRITICAL with re-arm tryables, and (r646-r647) the heal direction is witnessed too — prev≤1 → now≥2 renders a violet ✓ recovery witness, the radar's first positive-tone finding. Loop depth (r643-r645): generate steps gained a Looped Off/×2/×3 toggle wired into the engine with per-turn via-lane telemetry — the depth-growth looping shape from the paper deep-dive, opt-in and gated.",
    lookFor:
      "radar capability strip: red/amber/violet severity chips including a violet 'recovered' witness; the workflow editor's generate steps show a Looped segmented toggle",
  },
  {
    round: "r621-r640",
    title: "Incident repairs, a focus-ring canon, and badges that admit their age",
    detail:
      "A sandbox rollback incident was repaired and root-caused (mixed-generation SQLite pair → corruption → the r639 fresh-schema swap restored the 500ing endpoints live; the radar now degrades honestly instead of 500ing). The keyboard story was unified: violet focus-visible rings closed across cards, messages, schedules and run rows. Intel + census badges speak their vintage — live/cached · HH:MM relative age instead of a wall clock that could hide a 3-day-old snapshot.",
    lookFor:
      "Tab shows violet rings on cards/chips; Model Relay badges read 'live/cached · HH:MM'",
  },
  {
    round: "r594-r619",
    title: "The plugin-manifest dynasty + the honesty copy pass",
    detail:
      "One JSON manifest registers a tool pack without code edits (slices 1-2: loader + pack_stamp, registry-fed pack defs, agent-form toggleable pack rows, browser-direct defs, open-world tool-id widening). In parallel, copy stopped overpromising: queue/dial contracts stated on cards and empty states ('dials only with a vault key…'), the in-dialog Run gate self-explains, run-archive gained status filter chips + clipboard copy, and a repo-wide fetch-catch audit triaged 12 silent-failure sites.",
    lookFor:
      "agent form shows toggleable pack rows; run-archive toolbar has All/Done/Failed/Amber filter chips with live counts",
  },
  {
    round: "r580-r593",
    title: "Harness-adapter spec, AWorld seeds, and chips that speak live vs cached",
    detail:
      "docs/specs/harness-adapter-spec.md fixed the six-rule contract for lane adapters; Frontier Scout gained AWorld explore→reproduce→improve seeds with per-seed evidence; peer blind-scoring (r578) and the RRF hybrid retrieval shim (r579) landed as pure modules — the shim later became the precedent lane's retrieval engine. The benchmark-intelligence and free-reach badges learned to state live vs cached with age + refresh affordances.",
    lookFor:
      "Frontier Scout AWorld rows carry evidence chips; relay badges state their vintage",
  },
  {
    round: "r561-r579",
    title: "The vault card modularized and paste plans learned hygiene",
    detail:
      "The vault card broke into honest modules (acquisition panel, mirror strip, lane-slots list), the paste-plan dialog gained a live char count, numbered rotation echo, step-prefix stripping and an honest 8-step overflow warning, Evolution's true-zero vanish bug was fixed, and proposal plan-size chips surfaced scale. r577 pinned plugin-lane drift flags in resume QA.",
    lookFor:
      "paste a multi-step plan — the dialog echoes '(1 Agent → 2 Scout …)' with a char count and warns past 8 steps",
  },
  {
    round: "r522-r560",
    title: "The TASK-100/101/102 dynasty: redaction, encrypted vault, dialects, durable steps",
    detail:
      "Three tracks closed in sequence: token-lean request shaping; TASK-102's acquisition lane (single redaction choke on engine dials, AES-256-GCM vault encryption at rest, Anthropic/SSE dialect threading, the Exa lane verified end-to-end); TASK-101's durable-step semantics (resume-after-failure from the persisted step boundary, resume plans surfaced on armed schedule rows). Infra: the dev-server liveness supervisor and the golden-path QA script were born here (r522), and the vault gained a two-way seed bridge.",
    lookFor:
      "an errored run resumes from its last durable step; the vault card shows acquisition lanes with key-source readouts",
  },
  {
    round: "r655",
    title: "The vault backup API got its buttons — Backup and Restore, 275 rounds after the route shipped",
    detail:
      "r380's GET/POST /api/vault/backup round trip existed with zero UI: the vault card's only recovery path was a CLI hint, so a wiped disk meant re-seeding from a terminal. Now the card header carries Backup (confirm-gated — the dialog and the success toast both say the exported file holds every key UNENCRYPTED, the route's own trust model) and Restore (a file picker takes the same document back, refuses non-JSON and foreign files with the reason instead of silence, upserts slot-by-slot, reloads the card, and counts malformed skips honestly). The empty-vault state leads with a Restore-a-backup button before the CLI fallback, and the storage meter's fossil nexus-automation-vault label now reads legacy — the vault has lived in server SQLite (AES-256-GCM) since r526.",
    lookFor:
      "Settings → Automation vault: Backup/Restore buttons top-right of the card; Backup confirm warns about plaintext keys; Restore rejects a non-backup file with a toast instead of silence",
  },
  {
    round: "r656",
    title: "Call-log lanes became data, not prose — and a healthy direct dial stopped reading as a warning",
    detail:
      "The run surface's lane-health chips and note styling STRING-MATCHED the call log's note prefixes ('server relay…', 'browser-direct…') — prose was load-bearing, so a reworded note would silently miscount lanes. The writer now stamps a structured lane on every LLM-call record (from the dial's actual transport), a shared reader (src/lib/call-log-lane.ts) is the single adapter between writer and surface with an honest prefix fallback for pre-r656 rows, and a healthy browser-direct dial got its own neutral ⊙ family — it rendered amber ↻ like a warning even when it succeeded. Step id and result status were already first-class on every record (ok is required by the schema, stepId stamped at all 12 writer sites) — this closed the last prose-parsed field.",
    lookFor:
      "Workflow run panel: '⇄N relay / ⊙N direct' chips still count history runs (prefix fallback); in an expanded call log, browser-direct notes show a calm ⊙ instead of the amber ↻ warning marker",
  },
  {
    round: "r657",
    title: "Radar findings carry chain-typed evidence — validated vs candidate, on the record",
    detail:
      "TraceTrial slice 3 (paper F5): capability-radar findings now name the DECLARED mechanism chain they activate. The R7 registry-collapse canary — whose own evidence cites the evidence-reviewed r640 silent-DB-swap incident — stamps the chain VALIDATED; the registry-shrink warning, whose evidence says it may be intentional, stamps the honest CANDIDATE ('co-occurrence, not yet propagation') and promotion stays with evidence review, never the radar; findings whose evidence names no mechanism (the archive-corrupt row) stay unchained — no chain is invented. The autopilot radar digest renders the ⛓ chips (emerald validated / amber candidate). Companion (F7): every active experiment entry in TASKS.md now carries its admission gate — trigger / expected / boundary / verdict checkboxes fixed before execution, the paper's anti-theatre discipline applied to our own backlog.",
    lookFor:
      "Server autopilot radar digest: a registry-collapse or shrink finding carries a ⛓ chain line naming the mechanism and its status; TASKS.md experiment entries end with checked trigger/expected/boundary/verdict boxes",
  },
  {
    round: "r658",
    title: "The looped chip says how the loop ended — a converged loop stopped wearing warning amber",
    detail:
      "The run row's '↻ looped k/r' chip painted EVERY exit reason the same amber: a loop that CONVERGED (the re-judge accepted the rework — pass-verdict) rendered exactly like a judge refusal, and a judge-errored stop (infrastructure, not quality) was indistinguishable from either. The chip now reads its tone and label from the shared adapter (src/lib/looped-outcome.ts — single mapping, never-throw, unknown reasons honestly 'exit unknown'): pass-verdict goes emerald '· pass', rework-exhausted and unsure-at-cap stay amber ('· best kept' / '· unsure at cap'), judge-unavailable goes neutral ('· judge down'). The visible label now carries the outcome (was tooltip-only) and the tooltip says the full honest sentence.",
    lookFor:
      "Workflow run panel: after a Looped-armed step's FAIL branch, the chip reads '↻ looped k/r · pass' in emerald when the rework was accepted; refusals stay amber '· best kept'; a judge error shows neutral '· judge down' instead of warning amber",
  },
  {
    round: "r659",
    title: "The Decision gate's silent verdicts now speak — uncertain accepts and judge errors leave honest witness lines",
    detail:
      "Three live witness runs (Looped FAIL-branch attempt) proved the gap: the per-step Decision gate ENGAGED (enabled, output over the 200-char floor, generate kind) but an UNCERTAIN judge verdict accepted the output with ZERO callLog trace — the user could not see the gate ran at all; a judge ERROR vanished the same way. Both silent branches now emit honest lines: 'Decision gate uncertain N% (via) — no confident verdict; output accepted unchanged' and 'Decision gate judge errored — no verdict arrived (infra stop, not quality)'. Companion styling: the panel's gate-note families split — a confident PASS now renders calm emerald (it previously wore warning amber ↻ like a refusal — the r656 false-alarm pattern at note level), uncertain/errored render muted neutral, and FAIL keeps amber (a rework really is coming).",
    lookFor:
      "Workflow run panel call log: a run whose gate was unsure now shows a muted 'Decision gate uncertain …' line instead of nothing; a clean pass shows emerald 'Decision gate PASS …' instead of amber",
  },
  {
    round: "r660",
    title: "The gate that ran without a judge now says so — and the loop's verdict reached the Runs board",
    detail:
      "The post-fix live confirmation (4th witness run: 4KB gate-worthy output on a congested ladder) still left NO gate line — exposing the fourth silent path: decide() resolves NULL when no judge answers, and the r659 guard (else if (gate)) let the null case vanish exactly like the ones it fixed. The else now covers gate-vs-null with an honest 'Decision gate engaged but no judge answered — output accepted unchanged (verdict not possible, not a pass)' — it refuses to impersonate a pass. Every gate outcome now leaves a visible trace: PASS emerald, uncertain muted, judge-errored muted, no-judge muted, FAIL amber. Companion: the looped-depth outcome chip reached the Runs board (run-kanban) — the same shared adapter the run panel reads (second honest call site, r649 doctrine), so a loop's verdict is legible at board scale.",
    lookFor:
      "Workflow run panel under a congested ladder: a muted 'Decision gate engaged but no judge answered …' line instead of silence; Runs board: a card whose step ran looped carries '↻ looped k/r' tinted by its exit reason",
  },
  {
    round: "r662",
    title: "The no-judge gate line now says WHY — which judge rungs were tried and how they fell through",
    detail:
      "Seven live witness runs (r659-r661) hit the gate's no-judge path repeatedly — every one congestion, but the note could not prove it: 'no judge answered' named no lane. decide() now carries an optional onAttempt witness callback: each rung of the judge ladder (intern-systemone, the vault fast-judge with its top-2 relay hops, the paid jev rung) reports honestly when it is not armed or produced nothing, and the no-judge / judge-errored notes compose the trace as a 'tried: …' suffix — placed AFTER the stable family prefix, so the muted panel families and every pinned QA matcher survive byte-identical. The trace is bounded at 6 lines and the contract is otherwise unchanged: the gate still never blocks a run.",
    lookFor:
      "Workflow run panel on a congested ladder: 'Decision gate engaged but no judge answered (tried: intern-systemone — not armed (no intern-discovery key); fast-judge — relay chain exhausted (top 2 hops, no verdict); jev (paid rung) — not armed (no key)) — output accepted unchanged (verdict not possible, not a pass)' — the silence now carries its own evidence",
  },
  {
    round: "r663",
    title: "Palette workflow commands are findable by verb and by screen reader — 'run' now filters them, and each item speaks its action",
    detail:
      "The r663 patrol drove golden path 3 (Workflows → run-panel long-paste) through the ⌘K palette and hit a locator lesson: the 'Run a workflow' group was fully functional, but its items exposed only bare-noun text ('Deep Research Dossier· 4 steps') — no verb, no accessible name. Typing 'run' in the palette matched nothing in that group (the value carried no verb), and a screen reader heard a list of nouns with no action attached. Each workflow item now carries an explicit aria-label ('Run workflow: <name> — N steps'), the searchable value gains a 'run' prefix so the verb itself finds the group, the step count sets tabular-nums so 4/3/1-step columns align, and the Play icon brightens (emerald-400 → 300) on keyboard-selected items via an honest compound variant (data-play marker scoped to the item — the first attempt used group-data-[selected] against a base component that has no group class, a dead selector caught before shipping).",
    lookFor:
      "⌘K palette: type 'run' — the 'Run a workflow' group surfaces; keyboard onto an item reads 'Run workflow: <name> — N steps' and the Play icon brightens; step counts align in tabular figures",
  },
  {
    round: "r664",
    title: "The decision gate's 200-char floor is now visible where outputs render — and named in one place instead of two",
    detail:
      "The r659 gate engages only on outputs of ≥200 chars, but that number lived inline at two independent runner sites (the generate gate and the peer blind-score) — a drift pair waiting to diverge — and was invisible to the one person who needs it: an Owner preparing a gate-witness run had no way to know whether a step's output even reaches the floor. The threshold is now a named constant (GATE_MIN_CHARS in systemone.ts, shared by both runner sites), and every step header in the run panel carries a length chip: 'gate floor met · 1,240' in violet when the output reaches the floor, 'below gate floor · 120' muted when it does not. The chip claims length only, by design — the gate also needs a generate kind, a non-degraded stream, and the toggle, and this chip never promises a verdict; its tooltip names those remaining conditions honestly.",
    lookFor:
      "Run panel step headers: each finished step shows a length chip — violet 'gate floor met · N' once the output crosses 200 chars, muted 'below gate floor · N' under it; hover states exactly what the floor does and does not guarantee",
  },
  {
    round: "r665",
    title: "Witness attempt #9 doubles as the gate-floor chip's live debut — and queued steps breathe while they wait",
    detail:
      "The r665 patrol ran a real 4-step looped research workflow through the palette route with a 770-char gate-worthy task: the r664 length chips rendered LIVE on real outputs across loop passes ('gate floor met · 1,135' on pass one, 'gate floor met · 1,821' on pass two — the chip follows the live pass output, exactly as designed), console stayed at 0 for the whole run, and the gate's verdict note was deliberately left to form as the run converged (the panel is never mutated mid-run — the r662 cleanup-race lesson). Same run exposed a smaller honesty gap: during the multi-pass stretch, six queued steps rendered as one motionless wall — 'Waiting for the previous step…' in flat italic for everyone. Motion now extends the r598 semantic split: a step that waits for a PREVIOUS one carries a quiet animate-pulse (something is alive upstream), while the opening step — which waits for no one — stays still.",
    lookFor:
      "Run panel during a multi-step run: queued steps other than the first breathe with a subtle pulse; the opening step's queue line stays still; finished steps wear violet 'gate floor met · N' chips when their outputs cross the 200-char floor",
  },
  {
    round: "r666",
    title: "The gate-floor census reaches the Runs board — '⌈floor met/total' on every card, and witness attempt #9 closes at the panel",
    detail:
      "Witness attempt #9's left-alive run converged: all seven output-bearing steps lit violet 'gate floor met' chips (1,821 → 15,608 chars) in the panel — the r664 chip is live-proven across an entire multi-pass chain — yet no gate note appeared. Honest attribution: the dossier's steps dial non-generate kinds, and the r659 gate engages only on generate steps; the chips' tooltips already said so ('the gate ALSO requires a generate step…'), so the UI never lied — but board-scale readiness was invisible. The gate-floor census now rides the Runs board cards as the panel chip's second honest call site (r649 doctrine): a '⌈floor met/total' tabular chip in violet when every output-bearing step crosses GATE_MIN_CHARS, muted otherwise, reading the same constant the runner enforces, its tooltip stating that a verdict also needs a generate kind, a non-degraded stream, the toggle, and a judge that answers (ledger unchanged: confident verdicts remain 0/8 — no gate engaged to ask).",
    lookFor:
      "Runs board cards: output-bearing runs carry '⌈floor N/M' — violet when every output reaches the 200-char floor (the r665 dossier run reads ⌈floor 7/7), muted when some fall short; hover states exactly what the floor does and does not guarantee",
  },
  {
    round: "r667",
    title: "Correction with a receipt: the gate DID engage 6 times on the dossier run — its silence was hidden in the collapsible call log, so gate activity now reads on the board card",
    detail:
      "The r666 round misattributed the converged dossier run's missing gate note to non-generate step kinds. Reading the archive directly (callLog, not the panel), the truth is better: the gate ENGAGED six times on that run — six 'Decision gate engaged but no judge answered (tried: intern-systemone — not armed; fast-judge AIHubMix · qwen3.8-m…; jev — not armed)' notes, the no-judge line's fourth live firing, judge ledger now 0/14 — but every note lived inside the collapsible call log the patrol never expanded, and the r666 UI search looked only at rendered text. Lesson recorded: search the data layer before attributing silence. Productized: every board card now carries a '⚖ gate engaged·verdicts' census chip computed from the same callLog notes the panel colors (Decision-gate prefix = engagement, System-One prefix = confident verdict) — muted when verdicts are zero, emerald when one lands — so the next congested run is legible at board scale without expanding anything.",
    lookFor:
      "Runs board cards: the converged dossier run now reads '⚖ gate 6·0' next to '⌈floor 7/7' — engaged six times, zero verdicts, muted; a run with a confident PASS/FAIL would show an emerald chip with a non-zero verdict count",
  },
  {
    round: "r668",
    title: "The gate census becomes a shared adapter and reaches the run panel's header — and witness attempt #10 launched into a congestion window",
    detail:
      "The r667 board census chip proved gate truth must be read from the data layer; this round promotes that reader into a shared adapter (gate-census.ts: 'Decision gate' prefix = engagement, 'System-One gate' prefix = confident verdict, tolerant input, honest zero) and gives it a second call site — the run panel's header, next to the export button, so a run's gate story is visible WITHOUT expanding the call log. Board card and panel header now read one mapping (r649 doctrine), not two copies. Same round: witness attempt #10 (Novelty Lab, 673-char gate-worthy task) launched cleanly through the palette route but hit a deeply congested free lane — no dial landed in ~3 minutes, so the run was left converging untouched (the r665 launch-and-leave pattern, which paid off when r666 read its converged archive); the census chip will speak on whichever round finds it finished.",
    lookFor:
      "Run panel header (a viewed run with gate activity): '⚖ gate N·M' beside the export button — muted while verdicts are zero, emerald the moment a confident verdict lands; the Runs board card carries the same census from the same adapter",
  },
];

// r294: the covered range is DERIVED from FIXES (first → last entry) instead
// of a hardcoded string — the r274 defect class was exactly this string going
// stale ("r186-r241" while receipts ran to r273). The range can no longer lie.
// r437: multi-round keys ("r434-r435") contribute only their TRAILING round —
// the old join read "r186-r434-r435" (honest but wrong-shaped).
const RANGE_LABEL = `${FIXES[0].round.split("-")[0]}-${FIXES[FIXES.length - 1].round.split("-").pop()}`;

export function WhatsFixedSection() {
  return (
    <Card className="gap-4 border-violet-500/25">
      <CardHeader className="pb-3">
        <CardTitle>What&apos;s fixed recently</CardTitle>
        <CardDescription>
          {RANGE_LABEL} shipped pipeline, radar, provider &amp; rendering repairs while boards can look
          unchanged (background tabs stop hot-reloading). Newest receipts first. If you can read this
          section, this tab already runs current code — otherwise an amber refresh pill appears within
          a minute.
        </CardDescription>
      </CardHeader>
      <CardContent className="max-h-[38rem] space-y-3 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-violet-500/30 scrollbar-track-transparent">
        {[...FIXES].reverse().map((f) => (
          <div key={f.round} className="rounded-lg border p-3">
            <div className="flex items-baseline gap-2">
              <span className="shrink-0 rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-violet-600 dark:text-violet-400">
                {f.round}
              </span>
              <span className="text-sm font-medium">{f.title}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{f.detail}</p>
            {f.lookFor && (
              <p className="mt-1 text-xs">
                <span className="font-medium">On the board: </span>
                <span className="text-muted-foreground">{f.lookFor}</span>
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
