"use client";

import { ArrowDownToLine, Layers, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// r564: the r337 mirror strip is its own tiny component — the vault card's
// modular break-up completes (r562 took the acquisition panel; this takes the
// browser→server key-mirror seam). Dumb render: the card computes candidates
// (FREE_PROVIDERS with a browser-saved key and no slot yet) and owns the busy
// state, shared with the lane rows' drift re-mirror buttons — one mirror at
// a time across the whole card.
// r720: the strip gained the one-click recovery road — "Mirror all (n)" runs
// the SAME onMirror seam sequentially (nothing new writes the vault). Added
// after the third wipe turned recovery into "click the 17 waiting buttons"
// (r719 handoff); with one candidate the bulk button is noise and stays hidden.
export type MirrorCandidate = { id: string; name: string };

export function MirrorCandidatesStrip({
  candidates,
  busy,
  bulkBusy = false,
  onMirror,
  onMirrorAll,
}: {
  candidates: MirrorCandidate[];
  busy: string | null;
  bulkBusy?: boolean;
  onMirror: (id: string) => void;
  onMirrorAll?: () => void;
}) {
  if (candidates.length === 0) return null;
  const frozen = busy !== null || bulkBusy;
  return (
    <div className="space-y-1.5 rounded-md border border-violet-500/30 bg-violet-500/5 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10.5px] text-muted-foreground">
          Saved in this browser, not mirrored yet — one click stores it for
          closed-tab runs (no re-paste; local SQLite only):
        </p>
        <span
          data-testid="mirror-count"
          className="shrink-0 rounded-md border border-violet-500/30 bg-violet-500/5 px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums text-violet-600 dark:text-violet-400"
        >
          {candidates.length} waiting
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {candidates.length > 1 && onMirrorAll && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="mirror-all"
            onClick={onMirrorAll}
            disabled={frozen}
            className="h-7 gap-1.5 border-violet-500/40 bg-violet-500/10 px-2 text-[11px] font-medium text-violet-700 hover:bg-violet-500/20 hover:text-violet-800 dark:text-violet-300 dark:hover:bg-violet-500/20 dark:hover:text-violet-200"
            title={`Mirror all ${candidates.length} waiting keys in one pass — the same seam the individual buttons use (sequential, same toasts). The recovery road after a database revert.`}
          >
            {bulkBusy ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <Layers className="h-3 w-3" aria-hidden />
            )}
            Mirror all ({candidates.length})
          </Button>
        )}
        {candidates.map((p) => (
          <Button
            key={p.id}
            type="button"
            variant="outline"
            size="sm"
            data-testid="mirror-btn"
            data-mirror-id={p.id}
            onClick={() => onMirror(p.id)}
            disabled={frozen}
            className="h-7 px-2 text-[11px]"
            title={`Store the ${p.name} key you already saved in Providers here — the server lane (tab closed) dials with it.`}
          >
            {busy === p.id ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <ArrowDownToLine className="h-3 w-3" aria-hidden />
            )}
            Mirror {p.name}
          </Button>
        ))}
      </div>
    </div>
  );
}
