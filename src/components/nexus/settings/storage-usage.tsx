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
import { History, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

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
  // r498: tombstone written by the legacy reclaimer (small JSON receipt).
  "nexus-legacy-reclaimed": "Legacy reclaim receipt",
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

// r498: the rebrand migration (src/lib/migration.ts) COPIED every praison-*/
// praisonai.* key to its nexus-* name but deliberately kept the originals as
// rollback safety. Months later the nexus-* keys hold newer, diverged live
// data — the originals are stale rollback weight (measured live: up to ~70%
// of the per-origin budget). The reclaimer frees that space with a
// provably-safe order: download a full backup FIRST, then delete ONLY keys
// whose migrated counterpart exists (a copy-failure survivor is kept and
// reported), then leave a small receipt tombstone for the next visit.
const MIGRATION_FLAG = "nexus-migrated-from-praison-v1";
const RECLAIM_FLAG = "nexus-legacy-reclaimed";

function nexusKeyOf(legacy: string): string | null {
  if (legacy.startsWith("praisonai.")) return "nexus." + legacy.slice("praisonai.".length);
  if (legacy.startsWith("praison-")) return "nexus-" + legacy.slice("praison-".length);
  return null;
}

interface LegacyScan {
  keys: { key: string; chars: number; hasCounterpart: boolean }[];
  chars: number;
  reclaimableChars: number;
  migrationDone: boolean;
}

function scanLegacy(): LegacyScan {
  const empty: LegacyScan = {
    keys: [],
    chars: 0,
    reclaimableChars: 0,
    migrationDone: false,
  };
  if (typeof window === "undefined") return empty;
  try {
    const store = window.localStorage;
    if (!store) return empty;
    const migrationDone = !!store.getItem(MIGRATION_FLAG);
    const keys: LegacyScan["keys"] = [];
    let chars = 0;
    let reclaimableChars = 0;
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (!k || !(k.startsWith("praison-") || k.startsWith("praisonai."))) continue;
      const c = k.length + (store.getItem(k)?.length ?? 0);
      chars += c;
      const hasCounterpart = store.getItem(nexusKeyOf(k) ?? "") != null;
      if (hasCounterpart) reclaimableChars += c;
      keys.push({ key: k, chars: c, hasCounterpart });
    }
    return { keys, chars, reclaimableChars, migrationDone };
  } catch {
    return empty;
  }
}

interface ReclaimReceipt {
  at: string;
  reclaimed: number;
  chars: number;
  skipped: string[];
  backupFile: string;
}

function readReceipt(): ReclaimReceipt | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(RECLAIM_FLAG);
    return raw ? (JSON.parse(raw) as ReclaimReceipt) : null;
  } catch {
    return null;
  }
}

/** One reclamation: backup download → delete migrated keys → receipt. */
function reclaimLegacy(scan: LegacyScan): { reclaimed: number; chars: number; skipped: string[]; backupFile: string } | null {
  if (typeof window === "undefined" || scan.keys.length === 0) return null;
  const store = window.localStorage;
  const backupFile = `nexus-legacy-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.json`;
  // 1. Backup FIRST — every legacy key and value, plus the migration stamp
  //    for context. If the download cannot even be offered, nothing is
  //    deleted (the reclaim aborts with the error instead).
  let downloadOk = false;
  try {
    const payload = {
      kind: "nexus-legacy-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      migrationStamp: store.getItem(MIGRATION_FLAG),
      keys: scan.keys.map((k) => ({ key: k.key, value: store.getItem(k.key) })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 1)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = backupFile;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
    downloadOk = true;
  } catch {
    downloadOk = false;
  }
  if (!downloadOk) return null;
  // 2. Delete only provably-migrated keys; copy-failure survivors stay.
  let reclaimed = 0;
  let chars = 0;
  const skipped: string[] = [];
  for (const k of scan.keys) {
    if (!k.hasCounterpart) {
      skipped.push(k.key);
      continue;
    }
    try {
      store.removeItem(k.key);
      reclaimed += 1;
      chars += k.chars;
    } catch {
      skipped.push(k.key);
    }
  }
  // 3. Receipt tombstone — small, honest, survives for the next visit.
  try {
    store.setItem(
      RECLAIM_FLAG,
      JSON.stringify({ at: new Date().toISOString(), reclaimed, chars, skipped, backupFile } satisfies ReclaimReceipt),
    );
  } catch {
    /* quota on a ~200-char receipt — the reclaim itself already happened */
  }
  return { reclaimed, chars, skipped, backupFile };
}

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
  const [legacy, setLegacy] = React.useState<LegacyScan>({
    keys: [],
    chars: 0,
    reclaimableChars: 0,
    migrationDone: false,
  });
  const [receipt, setReceipt] = React.useState<ReclaimReceipt | null>(null);
  const [reclaiming, setReclaiming] = React.useState(false);

  const recheck = React.useCallback(() => {
    setSnap(measure());
    setLegacy(scanLegacy());
    setReceipt(readReceipt());
  }, []);

  const onReclaim = React.useCallback(() => {
    setReclaiming(true);
    try {
      const result = reclaimLegacy(scanLegacy());
      if (!result) {
        toast.error("Reclaim aborted — the backup download could not be offered, nothing was deleted.");
        return;
      }
      const skippedNote =
        result.skipped.length > 0 ? ` · kept ${result.skipped.length} key${result.skipped.length === 1 ? "" : "s"} without a migrated copy` : "";
      toast.success(
        `Reclaimed ${result.reclaimed} legacy key${result.reclaimed === 1 ? "" : "s"} (${fmt(result.chars)}) — backup ${result.backupFile} downloaded${skippedNote}`,
      );
    } catch (err) {
      toast.error(`Reclaim failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setReclaiming(false);
      recheck();
    }
  }, [recheck]);

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
                ? "This site is over the typical localStorage budget — saves may not persist until you free space. Old workflow runs and chat tool payloads eat the most; reclaiming the stale pre-rebrand copies below (if offered) frees it without touching live data, and recent saves already trim old history automatically."
                : `Nearly full. Recent saves trim old workflow runs and chat tool payloads automatically${legacy.chars > 0 ? ", and the stale pre-rebrand copies below can be reclaimed in one click" : ""}; Export + Clear all data frees the most space if storage errors appear.`}
            </p>
          )}

          {legacy.keys.length > 0 && (
            <div
              className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2"
              data-testid="legacy-reclaim"
            >
              <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                The rebrand copied every pre-rebrand key to its new <code>nexus-*</code> name but kept the
                originals as rollback safety. Those copies are stale now (the live keys hold newer data) and
                currently weigh <span className="font-medium">{fmt(legacy.chars)}</span> —
                {legacy.reclaimableChars === legacy.chars ? (
                  <> all of it provably migrated and safe to free.</>
                ) : (
                  <> {fmt(legacy.reclaimableChars)} of it provably migrated and safe to free (the rest has no migrated copy and will be kept).</>
                )}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2 h-7 gap-1.5 border-amber-500/40 px-2 text-xs text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
                disabled={reclaiming || !legacy.migrationDone}
                onClick={onReclaim}
                aria-label="Download a backup of the pre-rebrand data, then delete the migrated legacy keys"
              >
                <History className="h-3 w-3" aria-hidden />
                {reclaiming
                  ? "Reclaiming…"
                  : !legacy.migrationDone
                    ? "Reclaim unavailable — migration stamp missing"
                    : `Reclaim legacy space (${fmt(legacy.chars)})`}
              </Button>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                A full backup downloads first; only keys whose migrated copy exists are deleted (the rest are
                kept and reported). The live <code>nexus-*</code> data is never touched.
              </p>
            </div>
          )}

          {receipt && (
            <p className="mt-2 text-[11px] text-muted-foreground" data-testid="legacy-reclaim-receipt">
              Last reclaim {new Date(receipt.at).toLocaleString()} — {receipt.reclaimed} key
              {receipt.reclaimed === 1 ? "" : "s"} ({fmt(receipt.chars)}) freed, backup {receipt.backupFile}
              {receipt.skipped.length > 0 ? `, kept without migrated copy: ${receipt.skipped.join(", ")}` : ""}.
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
