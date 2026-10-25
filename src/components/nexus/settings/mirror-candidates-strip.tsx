"use client";

import { ArrowDownToLine, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// r564: the r337 mirror strip is its own tiny component — the vault card's
// modular break-up completes (r562 took the acquisition panel; this takes the
// browser→server key-mirror seam). Dumb render: the card computes candidates
// (FREE_PROVIDERS with a browser-saved key and no slot yet) and owns the busy
// state, shared with the lane rows' drift re-mirror buttons — one mirror at
// a time across the whole card.
export type MirrorCandidate = { id: string; name: string };

export function MirrorCandidatesStrip({
  candidates,
  busy,
  onMirror,
}: {
  candidates: MirrorCandidate[];
  busy: string | null;
  onMirror: (id: string) => void;
}) {
  if (candidates.length === 0) return null;
  return (
    <div className="space-y-1.5 rounded-md border border-dashed border-violet-500/30 bg-violet-500/5 px-2.5 py-2">
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
        {candidates.map((p) => (
          <Button
            key={p.id}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onMirror(p.id)}
            disabled={busy !== null}
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
