// r562: extracted from automation-vault-card.tsx — the acquisition cluster
// (r554 registry note + r552 fleet strip) as its own component, making the
// visual seam r561 drew modular: one honest sky sub-panel below the store
// row, in the chips' "pending" palette (r556).
import { cn } from "@/lib/utils";
import {
  ACQUISITION_PROVIDERS,
  acquisitionById,
} from "@/lib/acquisition-registry";

export type AcquisitionLane = {
  provider: string;
  label: string;
  envFallback: string;
  source: "vault" | "env" | null;
};

export function AcquisitionLanesPanel({
  acqLanes,
  laneProvider,
  setLaneProvider,
  laneKeyRef,
}: {
  acqLanes: AcquisitionLane[];
  laneProvider: string;
  setLaneProvider: (id: string) => void;
  // structural ref — focus + scroll is all the fleet chips need
  laneKeyRef: {
    current: {
      focus(): void;
      scrollIntoView(options?: ScrollIntoViewOptions): void;
    } | null;
  };
}) {
  // r562: at-a-glance census — how many lanes hold a key (vault slot or env
  // fallback), of how many registry rows exist. Counted from the SAME
  // guard-resolved data the chips render from; it promises nothing beyond
  // the count (dormant dialects still count as keyed — they hold tokens).
  const keyed = acqLanes.filter((a) => a.source !== null).length;
  return (
    <div
      className="space-y-2 rounded-lg border border-sky-500/20 bg-sky-500/5 p-3"
      data-testid="acq-cluster"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-sky-600 dark:text-sky-400">
          Acquisition lanes — search &amp; tool keys, never LLM dials
        </p>
        <span
          data-testid="acq-census"
          className="shrink-0 rounded-md border border-sky-500/20 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-sky-600 dark:text-sky-400"
        >
          {keyed}/{ACQUISITION_PROVIDERS.length} keyed
        </span>
      </div>
      {(() => {
        // r554: registry-aware note — dormant rows get the honest
        // "dials later" wording, live rows keep the r551 copy; both
        // state the same resolution order the guard enforces.
        const reg = acquisitionById(laneProvider);
        if (!reg) return null;
        return (
          <p
            className={cn(
              "text-[11px] leading-snug",
              // r556: dormant reads as "pending" (the chips' sky),
              // not as a warning — amber stays for live lanes.
              reg.status === "dormant"
                ? "text-sky-600 dark:text-sky-400"
                : "text-amber-500/90",
            )}
          >
            Acquisition lane
            {reg.status === "dormant"
              ? " (dormant — the dial dialect hasn't shipped yet)"
              : ""}{" "}
            —{" "}
            {reg.status === "dormant"
              ? `a token stored here is honored today: the fleet chip flips to "key stored — dial pending" and ${reg.label}'s lane picks it up the moment its dialect ships. `
              : `this key powers Radar Frontier's ${reg.label} search (picked up on the next Frontier refresh). `}
            Resolution order: this vault slot first, then the
            machine&apos;s{" "}
            <code className="font-mono text-[10px]">{reg.envFallback}</code>{" "}
            env fallback; with neither, the lane stays silent. The
            executor never dials it as an LLM step, so it can&apos;t win
            the dial-slot marker below.
          </p>
        );
      })()}
      <div className="flex w-full flex-wrap items-center gap-1.5" data-testid="acq-fleet">
        {ACQUISITION_PROVIDERS.map((p) => {
          // r552: the always-on fleet readout — one honest pill per
          // registry row, resolved through the same guard data the
          // frontier dials use. Dormant rows declare themselves instead
          // of pretending to be configurable.
          const source = acqLanes.find((a) => a.provider === p.id)?.source ?? null;
          const text =
            p.status === "dormant" && source === null
              ? "awaiting token — dormant"
              : p.status === "dormant"
                ? "key stored — dial pending"
                : source === "vault"
                  ? "vault slot"
                  : source === "env"
                    ? `env fallback (${p.envFallback})`
                    : "unconfigured — silent";
          const dot =
            p.status === "dormant" && source === null
              ? "h-1.5 w-1.5 rounded-full border border-muted-foreground/50"
              : p.status === "dormant"
                ? "h-1.5 w-1.5 rounded-full bg-sky-500"
                : source === "vault"
                  ? "h-1.5 w-1.5 rounded-full bg-emerald-500"
                  : source === "env"
                    ? "h-1.5 w-1.5 rounded-full bg-amber-500"
                    : "h-1.5 w-1.5 rounded-full bg-muted-foreground/40";
          const tone =
            p.status === "dormant" && source === null
              ? "text-muted-foreground"
              : p.status === "dormant"
                ? "text-sky-600 dark:text-sky-400"
                : source === "vault"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : source === "env"
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground";
          return (
            <button
              key={p.id}
              type="button"
              data-testid={`acq-fleet-${p.id}`}
              title={`${p.blurb} — click to store a token below`}
              aria-label={`${p.label}: ${text}. ${keyed} of ${ACQUISITION_PROVIDERS.length} lanes keyed. Click to select this lane and focus the key input.`}
              onClick={() => {
                setLaneProvider(p.id);
                laneKeyRef.current?.focus();
                laneKeyRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 text-left text-[10px] font-medium transition-colors hover:border-foreground/30 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            >
              <span aria-hidden className={dot} />
              <span className={tone}>
                {p.label} · {text}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
