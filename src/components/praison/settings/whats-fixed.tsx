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
      "The full-data export (praisonai-export.json) strips settings keys before download; the provider vault backup remains the sanctioned way to move keys between browsers.",
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
];

// r294: the covered range is DERIVED from FIXES (first → last entry) instead
// of a hardcoded string — the r274 defect class was exactly this string going
// stale ("r186-r241" while receipts ran to r273). The range can no longer lie.
const RANGE_LABEL = `${FIXES[0].round}-${FIXES[FIXES.length - 1].round}`;

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
      <CardContent className="space-y-3">
        {[...FIXES].reverse().map((f) => (
          <div key={f.round} className="rounded-lg border p-3">
            <div className="flex items-baseline gap-2">
              <span className="shrink-0 rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-600 dark:text-violet-400">
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
