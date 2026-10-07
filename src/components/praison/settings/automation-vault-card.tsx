"use client";

// ─── v25: Automation Vault (Settings card) · r218 per-slot Test/Reveal ───────
// Opt-in, LOCAL-ONLY key storage. While a tab is open, schedules run
// in-browser with the user's own keys (BYOK — keys never leave the browser).
// When the tab is CLOSED, the local server claims due schedules itself
// (r204 executor) but dials ONLY with a REGISTRY-PROVIDER key stored here —
// no key means an honest no-op (runs stay queued, nothing implicit dials).
// The "builtin" slot is a legacy client-lane handoff the executor SKIPS:
// the built-in gateway has no server-side endpoint pairing. Local SQLite
// only, nothing telemetered, masked previews only.

import * as React from "react";
import {
  Eye,
  EyeOff,
  FlaskConical,
  KeyRound,
  Loader2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FREE_PROVIDERS, providerById } from "@/lib/providers";
import { fmtSlotAge, pickExecutorSlot } from "@/lib/automation-lane";
import { cn } from "@/lib/utils";

interface VaultSlot {
  provider: string;
  label: string | null;
  maskedKey: string;
  updatedAt: string;
  /** r210: dial-order input — the executor dials the OLDEST resolvable slot
   *  (the vault GET ships this since r210; required for pickExecutorSlot). */
  createdAt: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  builtin: "Built-in engine slot (legacy client handoff — the server executor skips it)",
};

/** The exact mask the consume round-trip is verified against (r149 fact-check:
 * first4••••last4, keys ≤12 chars render as all-dots). Shared by every slot's
 * Test button so the proof is identical across slots. */
function maskOf(raw: string): string {
  return raw.length > 12 ? `${raw.slice(0, 4)}••••${raw.slice(-4)}` : "••••••••";
}

export function AutomationVaultCard() {
  const [slots, setSlots] = React.useState<VaultSlot[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [key, setKey] = React.useState("");
  const [showKey, setShowKey] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  // r218: per-slot affordances — WHICH slot is under test / on screen, not a
  // single card-wide flag. The executor-facing registry slots get the same
  // verify + reveal machinery the legacy builtin slot always had (the doc
  // already promised "per slot"; the UI now delivers it).
  const [testingProvider, setTestingProvider] = React.useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const [revealed, setRevealed] = React.useState<{ provider: string; key: string } | null>(null);
  const [revealingProvider, setRevealingProvider] = React.useState<string | null>(null);
  const revealTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // r218: the settings tab panels are CSS-hidden, NOT unmounted — this card
  // mounts when the settings view mounts (which persisted-view restores can
  // do long before the user ever opens the Vault tab) and its one mount-time
  // load() could go stale forever: keys stored later (another tab, a later
  // store, a transient fetch failure) never appeared until a full reload.
  // Refetch whenever the card actually becomes VISIBLE, debounced.
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const lastLoadRef = React.useRef(0);

  const load = React.useCallback(async () => {
    lastLoadRef.current = Date.now();
    try {
      // cache:"no-store" (r218): this endpoint's answer must never come from
      // the browser's HTTP cache — a cached empty vault rendered a LIE
      // ("no key stored") while the DB held the row.
      const res = await fetch("/api/vault", { cache: "no-store" });
      const json = (await res.json()) as { vault?: VaultSlot[] };
      setSlots(Array.isArray(json.vault) ? json.vault : []);
    } catch {
      /* local server briefly unreachable — keep last known slots */
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // r218: refetch on becoming visible (tab switch into the Vault panel, or
  // the settings view re-entering the viewport). Debounced to 2s so hover-
  // flicker across panels cannot spam the endpoint.
  React.useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && Date.now() - lastLoadRef.current > 2_000) {
          void load();
        }
      },
      { threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [load]);

  const maskNow = React.useCallback(() => {
    if (revealTimer.current) {
      clearTimeout(revealTimer.current);
      revealTimer.current = null;
    }
    setRevealed(null);
  }, []);

  // Reveal never survives unmount — a freshly mounted card is always masked.
  React.useEffect(() => maskNow, [maskNow]);

  const builtin = slots.find((s) => s.provider === "builtin");
  // r205: registry-provider slots are what the server executor actually
  // reads; the builtin slot above is legacy client-lane.
  const [laneProvider, setLaneProvider] = React.useState(FREE_PROVIDERS[0]?.id ?? "");
  const [laneKey, setLaneKey] = React.useState("");
  const [laneSaving, setLaneSaving] = React.useState(false);
  // r210: display slots in DIAL order (oldest first — the executor's actual
  // scan order, not the API's provider-asc order) and mark the winner.
  const laneSlots = slots
    .filter((s) => s.provider !== "builtin")
    .sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime());
  const dialSlot = React.useMemo(
    () => pickExecutorSlot(slots, (p) => !!providerById(p)),
    [slots],
  );

  async function save() {
    if (!key.trim()) {
      toast.error("Paste a key first — the vault stores exactly what you paste.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/vault", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "builtin", key: key.trim() }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setKey("");
      setShowKey(false);
      setConfirmRemove(false);
      maskNow(); // a revealed OLD key must not linger past an Update
      await load();
      toast.success("Vault key stored — closed-tab runs will dial with it.", {
        description: "Local SQLite only. Nothing leaves this machine.",
      });
    } catch (e) {
      toast.error("Could not store the key", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/vault?provider=builtin", { method: "DELETE" });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      maskNow();
      await load();
      toast.success("Vault key removed — headless runs fall back to the built-in lane.");
    } catch (e) {
      toast.error("Could not remove the key", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
      setConfirmRemove(false);
    }
  }

  // r205: store a key for a REAL registry provider — the only kind the
  // server executor can pair with an endpoint. POST upserts by provider id.
  async function saveLane() {
    if (!laneProvider || !laneKey.trim()) {
      toast.error("Pick a provider and paste its key first.");
      return;
    }
    setLaneSaving(true);
    try {
      const res = await fetch("/api/vault", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: laneProvider, key: laneKey.trim() }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setLaneKey("");
      await load();
      toast.success("Server-lane key stored — closed-tab runs can dial now.", {
        description: `${providerById(laneProvider)?.name ?? laneProvider} · local SQLite only, nothing leaves this machine.`,
      });
    } catch (e) {
      toast.error("Could not store the server-lane key", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLaneSaving(false);
    }
  }

  async function removeSlot(provider: string) {
    try {
      const res = await fetch(`/api/vault?provider=${encodeURIComponent(provider)}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      await load();
      toast.success("Server-lane key removed — closed-tab runs stay queued until a key is stored again.", {
        description: "Nothing dials implicitly; the executor never falls back.",
      });
    } catch (e) {
      toast.error("Could not remove the key", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // r135 (generalized per slot in r218): the vault epic's verify affordance.
  // What this test verifies — honestly: the EXACT handoff the external
  // headless scheduler depends on, for ANY slot (registry-provider slots are
  // the ones the executor actually dials since r205). It POSTs
  // /api/vault/consume as the scheduler would, then round-trips the returned
  // raw key through the same mask() the API uses and compares with the
  // displayed masked preview. A match proves: endpoint reachable, slot
  // readable, key intact end-to-end. What it does NOT verify: a real LLM
  // dial — dialing with the key is the external scheduler's job. The raw key
  // is never rendered, never logged — only the masked form ever reaches the UI.
  async function testSlot(provider: string) {
    const slot = slots.find((s) => s.provider === provider);
    if (!slot) return;
    setTestingProvider(provider);
    try {
      const res = await fetch("/api/vault/consume", {
        method: "POST",
        headers: { "content-type": "application/json", "x-praison-csrf": "1" },
        body: JSON.stringify({ provider }),
      });
      if (res.status === 404) {
        toast.error("No key to test", {
          description: "The vault slot vanished — store a key first.",
        });
        return;
      }
      const json = (await res.json()) as { ok?: boolean; key?: string; error?: string };
      if (!res.ok || !json.ok || typeof json.key !== "string" || json.key.length === 0) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      const masked = maskOf(json.key);
      if (masked !== slot.maskedKey) {
        toast.error("Key round-trip mismatch", {
          description:
            "The handoff endpoint returned a key that does not match the stored slot — re-store the key.",
        });
        return;
      }
      // builtin keeps its historical "Vault key verified" toast (the D-series
      // CDP contract asserts it verbatim); lane slots name their provider.
      const name =
        provider === "builtin"
          ? "Vault"
          : providerById(provider)?.name ?? PROVIDER_LABELS[provider] ?? provider;
      toast.success(`${name} key verified`, {
        description: `The headless handoff returns it intact (${masked}) — closed-tab runs will dial with it.`,
      });
    } catch (e) {
      toast.error("Key test failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setTestingProvider(null);
    }
  }

  // r154 (per slot since r218): deliberate reveal-once — THREAT MODEL, honestly:
  // The raw key already sits in plaintext in this machine's SQLite, and
  // POST /api/vault/consume already hands it to any same-machine caller
  // (localhost-only guard since r138; the doc records the LAN spoofing caveat).
  // A UI reveal therefore does NOT expand the programmatic attack surface —
  // the only new exposure is to EYES on screen (shoulder-surf, screen-share,
  // capture). Mitigations target exactly that: one deliberate click per
  // reveal, ~8s auto re-mask, immediate re-mask on second click / unmount /
  // re-store, no auto-copy, no reveal-state persistence (a reload re-masks),
  // and the raw key still never reaches logs or telemetry. NOT defended:
  // a screenshot taken inside the 8s window, or malicious client-side code —
  // the latter can already call consume directly. Only ONE slot is ever on
  // screen at a time: revealing another slot re-masks the first.
  async function revealSlot(provider: string) {
    if (revealed?.provider === provider) {
      maskNow();
      return;
    }
    setRevealingProvider(provider);
    try {
      const res = await fetch("/api/vault/consume", {
        method: "POST",
        headers: { "content-type": "application/json", "x-praison-csrf": "1" },
        body: JSON.stringify({ provider }),
      });
      if (res.status === 404) {
        toast.error("Nothing to reveal", {
          description: "The vault slot vanished — store a key first.",
        });
        maskNow();
        await load();
        return;
      }
      const json = (await res.json()) as { ok?: boolean; key?: string; error?: string };
      if (!res.ok || !json.ok || typeof json.key !== "string" || json.key.length === 0) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setRevealed({ provider, key: json.key });
      if (revealTimer.current) clearTimeout(revealTimer.current);
      revealTimer.current = setTimeout(maskNow, 8_000);
    } catch (e) {
      toast.error("Could not reveal the key", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setRevealingProvider(null);
    }
  }

  return (
    <div ref={rootRef}>
    <Card className="gap-4">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 shrink-0 text-cyan-500" aria-hidden />
          <CardTitle>Automation vault</CardTitle>
          <Badge variant="outline" className="border-cyan-500/40 text-cyan-600 dark:text-cyan-400">
            local-only
          </Badge>
        </div>
        <CardDescription>
          While a tab is open, schedules run in-browser with your own keys — they never
          leave the browser. When the tab is closed, the local server claims due schedules
          itself but dials only with a registry-provider key stored below; with no key,
          runs stay queued instead of falling back to anything implicit. Stored in local
          SQLite, never telemetered, displayed masked.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="lane-provider" className="text-xs text-muted-foreground">
            Server lane (closed-tab runs) — store a key for a registry provider
          </Label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              id="lane-provider"
              value={laneProvider}
              onChange={(e) => setLaneProvider(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              {FREE_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <Input
              type="password"
              value={laneKey}
              onChange={(e) => setLaneKey(e.target.value)}
              placeholder="paste the provider key for closed-tab runs"
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 font-mono text-xs"
            />
            <Button type="button" onClick={saveLane} disabled={laneSaving || !laneKey.trim()}>
              {laneSaving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <KeyRound className="h-3.5 w-3.5" aria-hidden />
              )}
              Store
            </Button>
          </div>
          {laneSlots.length > 0 ? (
            <ul className="space-y-1.5">
              {laneSlots.map((s) => {
                const resolvable = !!providerById(s.provider);
                const isDialSlot = dialSlot?.provider === s.provider;
                const slotName = providerById(s.provider)?.name ?? s.provider;
                const isRevealed = revealed?.provider === s.provider;
                return (
                <li key={s.provider} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <KeyRound className={cn("h-3 w-3 shrink-0", isDialSlot ? "text-cyan-400" : "text-cyan-500/60")} aria-hidden />
                  <span className="font-medium">{slotName}</span>
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
                    onClick={() => void revealSlot(s.provider)}
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
                    onClick={() => void testSlot(s.provider)}
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void removeSlot(s.provider)}
                    className="h-6 gap-1 px-1.5 text-[10px] text-red-500 hover:text-red-500"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden />
                    Remove
                  </Button>
                </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[10px] leading-relaxed text-muted-foreground/70">
              No registry-provider key stored — with the tab closed, the executor stands
              down and due schedules stay queued (honest no-op). The executor dials the
              OLDEST slot that pairs with a registry provider; builtin or unresolvable
              slots are skipped, so storing a new key promotes it without deleting old ones.
            </p>
          )}
        </div>

        {loading ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Reading vault…
          </p>
        ) : (
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
            {builtin ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <KeyRound className="h-3.5 w-3.5 shrink-0 text-cyan-500" aria-hidden />
                <span className="text-xs font-semibold">
                  {PROVIDER_LABELS[builtin.provider] ?? builtin.provider}
                </span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {revealed?.provider === "builtin" ? revealed.key : builtin.maskedKey}
                </span>
                <button
                  type="button"
                  onClick={() => void revealSlot("builtin")}
                  disabled={revealingProvider === "builtin"}
                  aria-label={
                    revealed?.provider === "builtin"
                      ? "Hide stored key"
                      : "Reveal stored key (auto-hides after 8 seconds)"
                  }
                  title="Deliberate reveal: shows the stored key for 8 seconds, then re-masks itself. Uses the same localhost-only handoff the headless scheduler uses — it changes who can see the key on screen, not who can already get it."
                  className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {revealingProvider === "builtin" ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  ) : revealed?.provider === "builtin" ? (
                    <EyeOff className="h-3 w-3" aria-hidden />
                  ) : (
                    <Eye className="h-3 w-3" aria-hidden />
                  )}
                </button>
                {revealed?.provider === "builtin" ? (
                  <span className="text-[10px] text-amber-600 dark:text-amber-400">
                    visible — auto-hides
                  </span>
                ) : null}
                <span className="text-[10px] text-muted-foreground/70">
                  {builtin.createdAt
                    ? `stored ${fmtSlotAge(builtin.createdAt)} (the executor skips this slot)`
                    : `updated ${new Date(builtin.updatedAt).toLocaleString()}`}
                </span>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No built-in slot stored — this legacy handoff is unused by the server
                lane; closed-tab runs dial with a registry-provider key above.
              </p>
            )}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="vault-key" className="text-xs text-muted-foreground">
            Key for the built-in engine lane
          </Label>
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Input
                id="vault-key"
                type={showKey ? "text" : "password"}
                value={key}
                onChange={(e) => {
                  setKey(e.target.value);
                  setConfirmRemove(false);
                }}
                placeholder="paste the gateway key for headless runs"
                autoComplete="off"
                spellCheck={false}
                className="pr-9 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? "Hide key" : "Show key"}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                {showKey ? (
                  <EyeOff className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <Eye className="h-3.5 w-3.5" aria-hidden />
                )}
              </button>
            </div>
            <Button
              type="button"
              onClick={save}
              disabled={saving || !key.trim()}
              className="shrink-0"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <KeyRound className="h-3.5 w-3.5" aria-hidden />
              )}
              {builtin ? "Update" : "Store"}
            </Button>
            {builtin ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void testSlot("builtin")}
                disabled={testingProvider !== null || saving}
                title="Dials /api/vault/consume exactly as the external headless scheduler would, and verifies the stored key comes back intact — the raw key is never shown."
                className="shrink-0 border-cyan-500/40 text-cyan-600 transition-colors hover:bg-cyan-500/10 hover:text-cyan-600 dark:text-cyan-400"
              >
                {testingProvider === "builtin" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <FlaskConical className="h-3.5 w-3.5" aria-hidden />
                )}
                Test key
              </Button>
            ) : null}
            {builtin ? (
              <Button
                type="button"
                variant="outline"
                onClick={remove}
                disabled={saving}
                className="shrink-0 border-red-500/40 text-red-500 hover:bg-red-500/10 hover:text-red-500"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                {confirmRemove ? "Confirm remove" : "Remove"}
              </Button>
            ) : null}
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground/70">
            Keys are written to this machine&apos;s SQLite DB only. The chat/agent BYOK
            keys in Providers above stay browser-side and are unaffected. Removing the
            server-lane key makes closed-tab runs stay queued until a new key is stored —
            the executor never falls back implicitly. The eye button reveals the stored
            built-in slot once for ~8 seconds, then re-masks.
          </p>
        </div>
      </CardContent>
    </Card>
    </div>
  );
}
