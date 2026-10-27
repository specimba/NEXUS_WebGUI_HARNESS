"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtRel } from "@/lib/helpers";
import { providerById } from "@/lib/providers";

// ─── Gateway pulse chip (r161) ───────────────────────────────────────────────
// Ambient answer to "is the shared gateway congesting?" on the workflows
// view — the surface where schedules show "next in Xm" and runs park on
// 429s (r158). Reads what the SERVER saw on completion dials via
// /api/gateway/pulse; the browser-side cadence/park state deliberately
// stays client-only, so this is the one signal that survives tab deaths
// and is readable cross-round via curl.
//
// Egress doctrine (r159 R5): ONE fetch per view mount, plus an explicit
// click-to-refresh on the chip itself — no polling. Renders NOTHING while
// the gateway has been clear for 24h (silence = healthy; a permanently
// green chip is noise, mirroring the CacheStatus decision in r160).

interface Pulse {
  last429At: number | null;
  count1h: number;
  count24h: number;
  recent: { t: number; model: string }[];
  rescueLane?: { providerId: string; msLeft: number } | null;
}

/** Fresh enough to warn about — inside this window the chip turns amber
 * (matches the client-side 90s quiet window's order of magnitude, with
 * headroom for the minutes-long saturation windows r158 measured). */
const FRESH_MS = 10 * 60_000;
/** Older than a day and the congestion is history — render nothing. */
const HIDE_MS = 24 * 60 * 60_000;

export function GatewayPulse() {
  // r453: `at` is the fetch timestamp — the snapshot's rescue msLeft is
  // frozen at that moment, so the live remainder is DERIVED from it instead
  // of displayed raw (the old Math.max(1,…) floor could read "1m left"
  // forever after the server's 15m TTL had expired).
  const [pulse, setPulse] = React.useState<(Pulse & { at: number }) | null>(null);
  const [busy, setBusy] = React.useState(false);

  const fetchPulse = React.useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/gateway/pulse", { cache: "no-store" });
      if (res.ok) setPulse({ ...(await res.json()) as Pulse, at: Date.now() });
    } catch {
      /* server briefly down — keep the previous (or empty) state silently */
    } finally {
      setBusy(false);
    }
  }, []);

  // One-shot per mount (egress doctrine) — refresh is explicit on the chip.
  React.useEffect(() => {
    void fetchPulse();
  }, [fetchPulse]);

  // r453: keep the chip's CLOCK honest while its data stays frozen by the
  // egress doctrine (one fetch per mount + click-to-refresh). The rendered
  // classifications — fresh amber ≤10m, the 24h hide, the rescue countdown —
  // are pure functions of time and must not freeze at mount values. A silent
  // 30s re-render, zero network: same doctrine as the run panel's
  // scheduleTick keeping the schedule countdown live while open.
  const [, clockTick] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    const t = setInterval(clockTick, 30_000);
    return () => clearInterval(t);
  }, [clockTick]);

  const fresh =
    pulse?.last429At != null && Date.now() - pulse.last429At < FRESH_MS;
  const recent = pulse?.last429At != null && Date.now() - pulse.last429At < HIDE_MS;

  if (!pulse || !recent || pulse.last429At == null) return null;

  // r438: same single fetch, second signal — the server lane's live rescue
  // lane (positive rotation memory). Emerald = proven-healthy, the
  // deliberate contrast to the amber congestion chip beside it.
  // r453: msLeft is measured from the fetch snapshot — age it by the time
  // since that fetch, and RETIRE the chip at zero (the server's 15m TTL has
  // lapsed; the next explicit refresh confirms). No more "1m left" forever.
  const rescue = pulse.rescueLane ?? null;
  const rescueMsLeft = rescue
    ? rescue.msLeft - (Date.now() - pulse.at)
    : 0;
  const rescueLive = rescue != null && rescueMsLeft > 0;
  const rescueLabel = rescue
    ? (providerById(rescue.providerId)?.name ?? rescue.providerId)
    : null;
  const rescueMin = rescueLive ? Math.max(1, Math.ceil(rescueMsLeft / 60_000)) : 0;

  const recentLines = pulse.recent
    .slice()
    .reverse()
    .map((e) => `· ${e.model || "unknown model"} — ${fmtRel(e.t)}`)
    .join("\n");
  const title = `Upstream 429s the server observed on completion dials (chat turns, workflow steps, autopilot — server-seen only; browser-direct keys are invisible here).\n\n${recentLines}\n\nClick to refresh.`;

  return (
    <>
      <button
        type="button"
        onClick={() => void fetchPulse()}
        aria-label={`Gateway pulse: last rate limit ${fmtRel(pulse.last429At)}, ${pulse.count24h} in the last 24 hours. Click to refresh.`}
        title={title}
        className={cn(
          "inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          fresh
            ? "border-amber-500/40 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-400"
            : "border-border bg-muted/40 text-muted-foreground hover:bg-muted/60"
        )}
      >
        <span
          aria-hidden
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            fresh ? "animate-pulse bg-amber-500" : "bg-muted-foreground/50"
          )}
        />
        gateway 429 · last {fmtRel(pulse.last429At)} · {pulse.count24h} in 24h
        <RefreshCw
          aria-hidden
          className={cn("h-2.5 w-2.5 opacity-50", busy && "animate-spin")}
        />
      </button>
      {rescue && rescueLive && (
        <span
          title={`Rescue lane — the server lane's positive rotation memory (r437/r438): this lane finished a FULL successful call on a recent congested dial, so the next fallback walk LEADS with it while it stays live (15m TTL, refreshed on each success, cleared the moment it fails).\n\nServer lane only — a browser tab's engine keeps its own rescue memory, invisible here.`}
          className="inline-flex w-fit items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
        >
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          rescue lane · {rescueLabel} · {rescueMin}m left
        </span>
      )}
    </>
  );
}
