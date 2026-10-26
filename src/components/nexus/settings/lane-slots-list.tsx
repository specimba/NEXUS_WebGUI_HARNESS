"use client";

import {
  Eye,
  EyeOff,
  FlaskConical,
  KeyRound,
  Loader2,
  PlugZap,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { providerById } from "@/lib/providers";
import { fmtSlotAge } from "@/lib/automation-lane";
import { cn } from "@/lib/utils";

// r566: the server-lane slot rows are their own component — the vault card's
// modular break-up completes (r562 acquisition panel, r564 mirror strip, and
// now the executor-facing lane list). Dumb render: the card owns every busy
// state and handler (the builtin box shares revealSlot/testSlot), the list
// only shapes rows. The census chip on top is the third application of the
// census vocabulary (r562 acq-census, r564 mirror-count): how many lanes are
// stored and which one the closed-tab executor dials first, at a glance.
interface LaneSlot {
  provider: string;
  label: string | null;
  maskedKey: string;
  updatedAt: string;
  createdAt: string;
}

export function LaneSlotsList({
  slots,
  dialProvider,
  revealed,
  revealingProvider,
  testingProvider,
  mirroringProvider,
  dialingProvider,
  confirmRemoveProvider,
  drifted,
  onReveal,
  onTest,
  onLiveDial,
  onMirror,
  onRemove,
}: {
  slots: LaneSlot[];
  dialProvider: string | null;
  revealed: { provider: string; key: string } | null;
  revealingProvider: string | null;
  testingProvider: string | null;
  mirroringProvider: string | null;
  dialingProvider: string | null;
  confirmRemoveProvider: string | null;
  drifted: (s: LaneSlot) => boolean;
  onReveal: (providerId: string) => void;
  onTest: (providerId: string) => void;
  onLiveDial: (providerId: string) => void;
  onMirror: (providerId: string) => void;
  onRemove: (providerId: string) => void;
}) {
  if (slots.length === 0) {
    // r568: an empty vault used to render as silence (return null) — the
    // section just vanished and the Owner couldn't tell "empty" from
    // "missing". The census family now explains itself: 0 stored, and what
    // the closed-tab lane does until a key lands here.
    return (
      <div
        data-testid="lane-census-empty"
        className="flex items-center justify-between gap-2 rounded-md border border-dashed border-cyan-500/30 bg-cyan-500/5 px-2.5 py-2"
      >
        <p className="text-[10.5px] text-muted-foreground">
          Server-stored lanes — the closed-tab executor stays queued until a key
          lands here (save a provider key above, or mirror a browser-saved one).
        </p>
        <span className="shrink-0 rounded-md border border-cyan-500/30 bg-cyan-500/5 px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums text-cyan-600 dark:text-cyan-400">
          0 stored
        </span>
      </div>
    );
  }
  const dialName = dialProvider
    ? providerById(dialProvider)?.name ?? null
    : null;
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10.5px] text-muted-foreground">
          Server-stored lanes — closed-tab runs dial the oldest resolvable one
          first (delete a slot to promote the next):
        </p>
        <span
          data-testid="lane-census"
          className="shrink-0 rounded-md border border-cyan-500/30 bg-cyan-500/5 px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums text-cyan-600 dark:text-cyan-400"
        >
          {slots.length} stored{dialName ? ` · dials ${dialName} first` : ""}
        </span>
      </div>
      <ul className="space-y-1.5">
        {slots.map((s) => {
          const resolvable = !!providerById(s.provider);
          const isDialSlot = dialProvider === s.provider;
          const slotName = providerById(s.provider)?.name ?? s.provider;
          const isRevealed = revealed?.provider === s.provider;
          return (
          <li key={s.provider} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <KeyRound className={cn("h-3 w-3 shrink-0", isDialSlot ? "text-cyan-400" : "text-cyan-500/60")} aria-hidden />
            <span className="font-medium">{slotName}</span>
            {providerById(s.provider)?.dialect === "anthropic" ? (
              <span
                title="This provider pairs an Anthropic-style /v1/messages endpoint — step dials, the engine's streaming tool-loop AND relay chains (dialect threaded per hop) ride the Anthropic dialect (x-api-key auth, system as a top-level field, SSE deltas translated), shaped behind the same redaction choke as every other lane. The wave's acquisition side rides the same discipline: the Radar Frontier's Exa lane (r531) dials a shaped /search body behind EXA_API_KEY."
                className="rounded-full border border-violet-500/40 bg-violet-500/10 px-1.5 py-0 text-[10px] font-medium text-violet-600 dark:text-violet-400"
              >
                anthropic dialect · relay + acquisition
              </span>
            ) : null}
            {isDialSlot ? (
              <span
                title="The executor dials THIS slot for closed-tab runs: the oldest stored slot whose provider pairs with a registry endpoint (newer keys wait their turn — delete this one to promote the next)."
                className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-1.5 py-0 text-[10px] font-semibold text-cyan-600 dark:text-cyan-400"
              >
                dials first
              </span>
            ) : !resolvable ? (
              <span
                title="This provider id no longer pairs with a registry endpoint — the executor skips it and scans the next slot (never guesses)."
                className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0 text-[10px] font-medium text-amber-600 dark:text-amber-400"
              >
                not pairable — skipped
              </span>
            ) : (
              <span
                title="A resolvable slot is stored, but the executor dials the OLDEST resolvable one first — this slot fires only if older slots are removed."
                className="rounded-full border border-border/60 px-1.5 py-0 text-[10px] text-muted-foreground"
              >
                queued
              </span>
            )}
            {resolvable && drifted(s) ? (
              <button
                type="button"
                onClick={() => onMirror(s.provider)}
                disabled={mirroringProvider !== null}
                title="The key saved in Providers no longer matches this stored slot — the browser key was rotated after mirroring, so closed-tab runs still dial with the OLD one. Click to re-mirror: this slot updates to the current browser key (local SQLite only)."
                className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0 text-[10px] font-semibold text-amber-600 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
              >
                {mirroringProvider === s.provider ? "re-mirroring\u2026" : "key drifted \u2014 re-mirror"}
              </button>
            ) : null}
            <span className="font-mono tabular-nums text-muted-foreground">
              {isRevealed ? revealed.key : s.maskedKey}
            </span>
            {isRevealed ? (
              <span className="text-[10px] text-amber-600 dark:text-amber-400">visible — auto-hides</span>
            ) : null}
            <span
              className="text-[10px] text-muted-foreground/70"
              title={`stored ${s.createdAt ? new Date(s.createdAt).toLocaleString() : "unknown"} · key last updated ${new Date(s.updatedAt).toLocaleString()}`}
            >
              {s.createdAt ? `stored ${fmtSlotAge(s.createdAt)}` : `updated ${new Date(s.updatedAt).toLocaleString()}`}
            </span>
            {/* r218: the executor-facing slots get the same per-slot
                verify + reveal affordances the builtin box always had. */}
            <button
              type="button"
              onClick={() => onReveal(s.provider)}
              disabled={revealingProvider === s.provider}
              aria-label={
                isRevealed
                  ? `Hide stored ${slotName} key`
                  : `Reveal stored ${slotName} key (auto-hides after 8 seconds)`
              }
              title="Deliberate reveal: shows this stored key for 8 seconds, then re-masks itself. Uses the same localhost-only handoff the headless scheduler uses — it changes who can see the key on screen, not who can already get it."
              className="ml-auto rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              {revealingProvider === s.provider ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              ) : isRevealed ? (
                <EyeOff className="h-3 w-3" aria-hidden />
              ) : (
                <Eye className="h-3 w-3" aria-hidden />
              )}
            </button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onTest(s.provider)}
              disabled={testingProvider !== null}
              title="Dials /api/vault/consume exactly as the external headless scheduler would, and verifies THIS slot's stored key comes back intact — the raw key is never shown."
              className="h-6 gap-1 px-1.5 text-[10px]"
            >
              {testingProvider === s.provider ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              ) : (
                <FlaskConical className="h-3 w-3" aria-hidden />
              )}
              Test
            </Button>
            {resolvable ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onLiveDial(s.provider)}
                disabled={dialingProvider !== null}
                title="Asks the PROVIDER about this stored key: the server dials the provider's allowlisted endpoint with it (the raw key never leaves the server) and reports an honest verdict — accepted / rejected / region-blocked / unreachable."
                className="h-6 gap-1 px-1.5 text-[10px] text-cyan-600 hover:text-cyan-600 dark:text-cyan-400"
              >
                {dialingProvider === s.provider ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                ) : (
                  <PlugZap className="h-3 w-3" aria-hidden />
                )}
                Live dial
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onRemove(s.provider)}
              aria-label={
                confirmRemoveProvider === s.provider
                  ? `Click again to confirm removing the stored ${slotName} key`
                  : `Remove the stored ${slotName} key (click twice)`
              }
              title={
                confirmRemoveProvider === s.provider
                  ? "Click again to delete this slot — closed-tab runs stay queued until a new key is stored (the executor never falls back implicitly)."
                  : "Arms a deliberate two-click remove: the first click only highlights, the second deletes. No key is removed by a single accidental click."
              }
              className={cn(
                "h-6 gap-1 px-1.5 text-[10px] text-red-500 hover:text-red-500",
                confirmRemoveProvider === s.provider &&
                  "bg-red-500/10 font-semibold",
              )}
            >
              <Trash2 className="h-3 w-3" aria-hidden />
              {confirmRemoveProvider === s.provider ? "Confirm remove" : "Remove"}
            </Button>
          </li>
          );
        })}
      </ul>
    </>
  );
}
