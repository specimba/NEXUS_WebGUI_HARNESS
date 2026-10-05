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
];

export function WhatsFixedSection() {
  return (
    <Card className="gap-4 border-violet-500/25">
      <CardHeader className="pb-3">
        <CardTitle>What&apos;s fixed recently</CardTitle>
        <CardDescription>
          r186-r273 shipped pipeline, radar, provider &amp; rendering repairs while boards can look unchanged
          (background tabs stop hot-reloading). Newest receipts first. If you can read this section,
          this tab already runs current code — otherwise an amber refresh pill appears within a
          minute.
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
