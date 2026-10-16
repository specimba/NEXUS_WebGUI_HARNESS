"use client";

// ─── Storage usage meter ──────────────────────────────────────────────────────
// The honest companion to the r414 quota work. That round made localStorage
// failures degrade gracefully (one toast instead of a crash) — but the user
// still had no way to see WHERE the per-origin budget actually goes. This
// card enumerates every key this origin holds, sizes each in the same unit
// browsers budget against (UTF-16 characters — the wall the quota errors
// hit), and names the biggest eaters first. Measured live on mount and on
// demand; nothing is estimated, cached, or invented.

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

const KNOWN_KEYS: Record<string, string> = {
  "nexus-workflows": "Workflows",
  "nexus-conversations": "Chats",
  "nexus-agents": "Agents",
  "nexus-settings": "Settings",
  "nexus-ui": "UI state",
  // r416: the tracker mirror was audited this round (biggest key in a fresh
  // profile) — it has earned labels like the rest.
  "nexus-tracker-cache": "Model radar cache",
  "nexus-tracker-lastseen": "Radar last-seen",
  // r433: complete the map — every key the app writes is grep-verified, and
  // the radar caches + provider vault can be among the biggest eaters, so
  // showing them as raw key names defeated the card's "where does it go" job.
  "nexus-radar-hf": "HF trending cache",
  "nexus-radar-arxiv": "Paper radar cache",
  "nexus-radar-gh": "GitHub stars cache",
  "nexus-radar-user": "Radar GitHub user",
  "nexus-radar-hf-kind": "Radar HF kind",
  "nexus-radar-paper-query": "Radar paper query",
  "nexus-radar-tab": "Radar active tab",
  "nexus-provider-vault": "Provider vault (keys)",
  "nexus-automation-vault": "Automation vault",
  "nexus-relay-health": "Relay health log",
  "nexus-schedule-skips": "Schedule skip ledger",
  "nexus-local-model": "Local model pick",
  "nexus-free-catalog": "Free model catalog",
  "nexus-free-catalog-at": "Catalog refresh time",
  "nexus-theme": "Theme",
  "nexus-stall-timeout-ms": "Stall timeout",
  "nexus-stall-watchdog": "Stall watchdog",
  "nexus-aihubmix-intro": "AiHubMix intro seen",
  "nexus-vyce-intro": "Vyce intro seen",
  // Rebrand: one-time migration stamp written by the nexus-* key migration.
  "nexus-migrated-from-praison-v1": "Rebrand migration stamp",
};

// Keys written before the NEXUS rebrand (praison-* / praisonai.*). The
// migration copies them to nexus-* but keeps the originals as rollback
// safety, so an un-migrated or leftover legacy key still gets an honest
// label instead of a raw identifier.
const LEGACY_PREFIXES = ["praison-", "praisonai."];
const LEGACY_LABEL = "Legacy pre-rebrand data";

function keyLabel(key: string): string {
  if (KNOWN_KEYS[key]) return KNOWN_KEYS[key];
  if (LEGACY_PREFIXES.some((p) => key.startsWith(p))) return LEGACY_LABEL;
  return key;
}

// The classic per-origin localStorage budget (Chrome/Firefox count ~5 MB in
// UTF-16 characters; r414's live QA witnessed the exact wall at 5,242,880
// chars). Browsers may differ — which is why every label says "typical",
// never "your quota is exactly this".
const TYPICAL_BUDGET_CHARS = 5_242_880;

const SEGMENT_CLASSES = [
  "bg-sky-500/80",
  "bg-emerald-500/80",
  "bg-amber-500/80",
  "bg-violet-500/80",
  "bg-rose-500/80",
  "bg-cyan-500/80",
  "bg-teal-500/80",
  "bg-slate-400/80",
];

type KeyUsage = { key: string; label: string; chars: number };

type Snapshot = { rows: KeyUsage[]; totalChars: number; available: boolean };

function measure(): Snapshot {
  if (typeof window === "undefined") {
    return { rows: [], totalChars: 0, available: false };
  }
  try {
    const store = window.localStorage;
    if (!store) return { rows: [], totalChars: 0, available: false };
    const rows: KeyUsage[] = [];
    let totalChars = 0;
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key === null) continue;
      const chars = key.length + (store.getItem(key)?.length ?? 0);
      totalChars += chars;
      rows.push({ key, label: keyLabel(key), chars });
    }
    rows.sort((a, b) => b.chars - a.chars);
    return { rows, totalChars, available: true };
  } catch {
    // Private-browsing modes and blocked site data make every access throw —
    // say so instead of rendering a fake zero.
    return { rows: [], totalChars: 0, available: false };
  }
}

// Characters are the budget unit, so they are also the display unit: "KB"
// here means 1,024 characters, not bytes (the footnote spells this out).
function fmt(chars: number): string {
  if (chars < 1024) return `${chars}`;
  if (chars < 1024 * 1024) return `${(chars / 1024).toFixed(1)} KB`;
  return `${(chars / (1024 * 1024)).toFixed(2)} MB`;
}

export function StorageUsage() {
  const [snap, setSnap] = React.useState<Snapshot>({
    rows: [],
    totalChars: 0,
    available: false,
  });

  const recheck = React.useCallback(() => {
    setSnap(measure());
  }, []);

  React.useEffect(() => {
    recheck();
  }, [recheck]);

  const ratio = snap.totalChars / TYPICAL_BUDGET_CHARS;
  const fillPct = Math.min(100, ratio * 100);
  const nearlyFull = ratio >= 0.9 && ratio < 1;
  const overBudget = ratio >= 1;

  return (
    <div className="rounded-lg border p-3" data-testid="storage-usage">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Storage usage</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={recheck}
          aria-label="Recheck storage usage"
        >
          <RefreshCw className="h-3 w-3" aria-hidden />
          Recheck
        </Button>
      </div>

      {!snap.available ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Storage is unavailable in this browser mode (private windows and some
          site-data settings block it), so usage can&apos;t be measured.
        </p>
      ) : (
        <>
          <div
            className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={`Local storage: ${fmt(snap.totalChars)} characters of the typical ${fmt(
              TYPICAL_BUDGET_CHARS,
            )} budget used`}
          >
            <div
              className="flex h-full"
              style={{ width: `${snap.totalChars > 0 ? fillPct : 0}%` }}
            >
              {snap.rows.map((row, i) => (
                <div
                  key={row.key}
                  className={SEGMENT_CLASSES[i % SEGMENT_CLASSES.length]}
                  style={{
                    width: `${(row.chars / Math.max(snap.totalChars, 1)) * 100}%`,
                  }}
                />
              ))}
            </div>
          </div>

          <p
            className="mt-2 text-xs text-muted-foreground"
            aria-live="polite"
            data-testid="storage-usage-summary"
          >
            {fmt(snap.totalChars)} of the typical {fmt(TYPICAL_BUDGET_CHARS)}{" "}
            per-site budget
            {overBudget ? " — over it" : nearlyFull ? " — nearly full" : ""}
            {" · "}
            {snap.rows.length} {snap.rows.length === 1 ? "key" : "keys"}
            {snap.rows.length > 0 && snap.rows[0].chars > 0
              ? ` · biggest: ${snap.rows[0].label} (${fmt(snap.rows[0].chars)})`
              : ""}
          </p>

          {snap.rows.length === 0 ? (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Nothing stored yet — this site&apos;s localStorage is empty.
            </p>
          ) : (
            <ul className="mt-2 space-y-1">
              {snap.rows.slice(0, 8).map((row, i) => (
                <li
                  key={row.key}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        SEGMENT_CLASSES[i % SEGMENT_CLASSES.length]
                      }`}
                      aria-hidden
                    />
                    <span className="truncate">{row.label}</span>
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {fmt(row.chars)}
                  </span>
                </li>
              ))}
              {snap.rows.length > 8 && (
                <li className="text-xs text-muted-foreground">
                  … and {snap.rows.length - 8} more{" "}
                  {snap.rows.length - 8 === 1 ? "key" : "keys"}
                </li>
              )}
            </ul>
          )}

          {(nearlyFull || overBudget) && (
            <p
              role="note"
              data-testid="storage-usage-warning"
              className={`mt-2 rounded-md border px-3 py-2 text-xs leading-relaxed ${
                overBudget
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
              }`}
            >
              {overBudget
                ? "This site is over the typical localStorage budget — saves may not persist until you free space. Old workflow runs and chat tool payloads eat the most; Export above, then Clear all data, frees it, and recent saves already trim old history automatically."
                : "Nearly full. Recent saves trim old workflow runs and chat tool payloads automatically, but Export + Clear all data frees the most space if storage errors appear."}
            </p>
          )}

          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Measured live from this browser when the card opens or you press
            Recheck; recent saves can land up to ~0.5 s after you act. Sizes
            count characters — the unit browsers budget against (1 KB here =
            1,024 characters) — and the typical budget is ~5 MB per site.
            Storage-full errors (&quot;exceeded the quota&quot;) happen when
            that wall is hit; since the recent fix, saves degrade gracefully
            instead of crashing.
          </p>
        </>
      )}
    </div>
  );
}
