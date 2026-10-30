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
  Copy,
  Download,
  Eye,
  EyeOff,
  FileDown,
  FlaskConical,
  Globe,
  HardDrive,
  KeyRound,
  Loader2,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { apiJson } from "@/lib/api-fetch";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { DeepLinkShare } from "@/components/nexus/settings/deep-link-share";
import { FREE_PROVIDERS, isChatProvider, providerById } from "@/lib/providers";
import { ACQUISITION_PROVIDERS, acquisitionById } from "@/lib/acquisition-registry";
import { AcquisitionLanesPanel } from "@/components/nexus/settings/acquisition-lanes-panel";
import { MirrorCandidatesStrip } from "@/components/nexus/settings/mirror-candidates-strip";
import { LaneSlotsList } from "@/components/nexus/settings/lane-slots-list";
import { fmtSlotAge, pickExecutorSlot } from "@/lib/automation-lane";
import { useSettingsStore } from "@/lib/stores";
import { cn } from "@/lib/utils";
import { clearProviderLaneHealth } from "@/lib/relay";
import { resetProviderBreaker } from "@/lib/provider-breaker";
import { remirrorIfDrifted, slotIsDrifted } from "@/lib/vault-mirror";

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

/** r719: parse a backup document — either shape the Backup flow writes:
 *  { slots: […] } or a bare slots array. Shared by the file picker and the
 *  new paste-restore path (one mapping, two honest front doors). */
function parseBackupText(text: string): unknown[] | null {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return parsed && typeof parsed === "object" && Array.isArray((parsed as { slots?: unknown }).slots)
    ? ((parsed as { slots?: unknown[] }).slots ?? null)
    : Array.isArray(parsed)
      ? parsed
      : null;
}

export function AutomationVaultCard() {
  const [slots, setSlots] = React.useState<VaultSlot[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [key, setKey] = React.useState("");
  const [showKey, setShowKey] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  // r413: the GET can FAIL (server down, db error) — the route answers
  // 500 {vault: [], error} and an empty array is indistinguishable from a
  // truly empty vault. Rendering "no key stored" over a failed read is the
  // r411 falsehood class: empty-state claims must be gated on a read that
  // actually succeeded.
  const [loadFailed, setLoadFailed] = React.useState(false);
  // r218: per-slot affordances — WHICH slot is under test / on screen, not a
  // single card-wide flag. The executor-facing registry slots get the same
  // verify + reveal machinery the legacy builtin slot always had (the doc
  // already promised "per slot"; the UI now delivers it).
  const [testingProvider, setTestingProvider] = React.useState<string | null>(null);
  const [dialingProvider, setDialingProvider] = React.useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  // r420: per-slot Remove now arms the same deliberate two-click confirm the
  // builtin lane has always had (confirmRemove above). Before this, one
  // accidental click on a slot's Remove instantly DELETEd the server-lane key
  // — closed-tab runs then queue silently (honest no-op) until the user
  // notices and re-stores. Destructive affordances must be deliberate, and
  // the lanes the executor actually dials with deserve at least the same
  // guard the legacy builtin box gets.
  const [revealed, setRevealed] = React.useState<{ provider: string; key: string } | null>(null);
  // r551: live acquisition key-source readout — the /api/vault GET now serves
  // the probeSlotDial-resolved source per acquisition registry provider (source
  // only, never a key). Rendered as one honest chip beside the acquisition note.
  const [acqLanes, setAcqLanes] = React.useState<
    { provider: string; label: string; envFallback: string; source: "vault" | "env" | null }[]
  >([]);
  const [revealingProvider, setRevealingProvider] = React.useState<string | null>(null);
  const [confirmRemoveProvider, setConfirmRemoveProvider] = React.useState<string | null>(null);
  // r655: Backup/Restore — the r380 GET/POST /api/vault/backup round trip
  // finally gets UI (F2/F3, VAULT-RSI-REVIEW §3). Backup is a two-click
  // deliberate download of a PLAINTEXT key document (the route's trust model
  // says so; the confirm dialog and toast repeat it); Restore reads that same
  // document back, POSTs it, and reloads the card. Errors surface verbatim.
  const [backingUp, setBackingUp] = React.useState(false);
  const [restoring, setRestoring] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
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
      const res = await fetch("/api/vault", {
        cache: "no-store",
        headers: { "x-nexus-csrf": "1" },
      });
      const json = (await res.json()) as {
        vault?: VaultSlot[];
        acquisition?: {
          provider: string;
          label: string;
          envFallback: string;
          source: "vault" | "env" | null;
        }[];
        error?: string;
      };
      // r413: a 500 answer carries vault:[] + error — swallowing res.ok would
      // render "no key stored" over a read that never succeeded (r411 class).
      // Keep last known slots on screen (r219 no-flicker) but flag the read.
      if (!res.ok) {
        setLoadFailed(true);
        return;
      }
      setSlots(Array.isArray(json.vault) ? json.vault : []);
      setAcqLanes(Array.isArray(json.acquisition) ? json.acquisition : []);
      setLoadFailed(false);
    } catch {
      /* local server briefly unreachable — keep last known slots, flag it */
      setLoadFailed(true);
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

  // ─── r655: vault Backup / Restore (VAULT-RSI-REVIEW §3 F2/F3) ───────────
  // No new API — both buttons drive the existing localGuard'd round trip.
  // Backup: confirm-gate (the exported FILE is plaintext JSON holding every
  // key — the route header's trust model, repeated in the dialog and toast),
  // then a deliberate two-click download. An empty vault exports nothing and
  // says so. Restore: strict-but-kind parse (export document or bare slots
  // array, anything else refused with the reason), POST, honest imported/
  // skipped toast, card reload. Every failure surfaces; nothing is swallowed
  // (r411 class — a silent restore is a vault that looks restored but isn't).
  // r719: the export round trip moved in-app — window.confirm AND anchor
  // downloads are both silently swallowed by sandboxed preview iframes (the
  // third wipe's keys left with no file ever arriving while the success
  // toast still fired). The confirm dialog and the copyable backup text
  // need neither the browser's modal nor its download lane.
  const [askBackup, setAskBackup] = React.useState(false);
  const [backupText, setBackupText] = React.useState<string | null>(null);
  const [restoreText, setRestoreText] = React.useState("");
  const backupTextRef = React.useRef<HTMLTextAreaElement | null>(null);
  const backupVault = React.useCallback(async () => {
    // r719: the confirm moved in-app (the askBackup dialog) — window.confirm
    // is silently blocked in sandboxed preview iframes and returns false,
    // which killed the export before it ever ran.
    setAskBackup(false);
    setBackingUp(true);
    try {
      const res = await fetch("/api/vault/backup", {
        cache: "no-store",
        headers: { "x-nexus-csrf": "1" },
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        slots?: unknown[];
        error?: string;
      } | null;
      if (!res.ok || !json?.ok || !Array.isArray(json.slots)) {
        toast.error(json?.error ?? "Vault export failed — the server didn't answer.");
        return;
      }
      if (json.slots.length === 0) {
        toast.info("The vault is empty — nothing to back up yet.");
        return;
      }
      const text = JSON.stringify(json, null, 2);
      // File download stays best-effort: the preview iframe can swallow it
      // silently — the copyable dialog is the road that always works.
      try {
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
        const blob = new Blob([text], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `nexus-vault-backup-${stamp}.json`;
        document.body.appendChild(a);
        a.remove();
        URL.revokeObjectURL(url);
      } catch {
        /* the dialog below is the guaranteed road */
      }
      setBackupText(text);
      toast.success(
        `Backed up ${json.slots.length} slot${json.slots.length === 1 ? "" : "s"} — if no file arrived, the dialog holds the plaintext to copy.`,
      );
    } catch {
      toast.error("Vault export failed — the server didn't answer.");
    } finally {
      setBackingUp(false);
    }
  }, []);

  // r719: the POST half of restore, shared by the file picker and the
  // paste-restore path — one mapping for the write, two honest front doors.
  const postRestoreSlots = React.useCallback(
    async (slots: unknown[]) => {
      setRestoring(true);
      try {
        const res = await fetch("/api/vault/backup", {
          method: "POST",
          headers: { "content-type": "application/json", "x-nexus-csrf": "1" },
          body: JSON.stringify({ slots }),
        });
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean;
          imported?: number;
          skipped?: number;
          error?: string;
        } | null;
        if (!res.ok || !json?.ok) {
          toast.error(json?.error ?? "Vault import failed — the server didn't answer.");
          return;
        }
        toast.success(
          `Restored ${json.imported ?? 0} slot${json.imported === 1 ? "" : "s"}${
            json.skipped ? `, ${json.skipped} malformed skipped` : ""
          }.`,
        );
        void load();
      } catch {
        toast.error("Vault import failed — the server didn't answer.");
      } finally {
        setRestoring(false);
      }
    },
    [load],
  );

  const restoreVaultFile = React.useCallback(
    async (file: File) => {
      try {
        const slots = parseBackupText(await file.text());
        if (!slots) {
          toast.error(
            "That file isn't a vault backup (no slots array / bad JSON) — pick one made by the Backup button.",
          );
          return;
        }
        await postRestoreSlots(slots);
      } catch {
        toast.error("Vault import failed — the file couldn't be read.");
      }
    },
    [postRestoreSlots],
  );

  // r719: paste-restore — file pickers can be iframe-hostile in the preview
  // panel exactly like downloads; pasted text needs neither.
  const restoreVaultText = React.useCallback(
    async (text: string) => {
      const slots = parseBackupText(text);
      if (!slots) {
        toast.error("That pasted text isn't a vault backup (no slots array / bad JSON).");
        return;
      }
      await postRestoreSlots(slots);
    },
    [postRestoreSlots],
  );

  const onRestoreFile = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] ?? null;
      e.target.value = ""; // re-picking the same file must re-fire change
      if (file) void restoreVaultFile(file);
    },
    [restoreVaultFile],
  );

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
  // r555: the fleet-strip chips are one-click storage affordances — clicking
  // a chip selects that lane AND puts the cursor in this input, so "awaiting
  // token" → stored key is one click + one paste.
  const laneKeyRef = React.useRef<HTMLInputElement>(null);
  const [laneSaving, setLaneSaving] = React.useState(false);
  // r210: display slots in DIAL order (oldest first — the executor's actual
  // scan order, not the API's provider-asc order) and mark the winner.
  const laneSlots = slots
    .filter((s) => s.provider !== "builtin")
    .sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime());
  const dialSlot = React.useMemo(
    // r536: acquisition slots (Exa) are never the executor's dial — the
    // winner marker must agree with probeSlotDial's refusal.
    () => pickExecutorSlot(slots, (p) => isChatProvider(providerById(p))),
    [slots],
  );
  // r337: browser-saved provider keys NOT yet mirrored to the server vault —
  // the r335 recheck round witnessed this exact gap (the user's Vyce key
  // lived in the browser vault only; the recheck answered "no-server-key"
  // and every closed-tab schedule ran keyless). The mirror is EXPLICIT
  // opt-in — the vault's doctrine is opt-in storage, so nothing ever
  // copies silently — but it removes the re-paste friction entirely.
  const settings = useSettingsStore((s) => s.settings);
  const [mirroringProvider, setMirroringProvider] = React.useState<string | null>(null);
  const [mirroringAll, setMirroringAll] = React.useState(false);
  const mirrorCandidates = [
    ...FREE_PROVIDERS.filter(
      (p) =>
        settings.providerKeys?.[p.id]?.key?.trim() &&
        !slots.some((s) => s.provider === p.id),
    ).map((p) => ({ id: p.id, name: p.name })),
    // r707: acquisition lanes join the mirror list (the Owner's ask — the
    // Exa / Bright Data / Webshare tokens were server-only, and this
    // machine's database has reverted twice; a browser copy in providerKeys
    // (saveLane writes it below) means the lane survives a reset with one
    // click — the SAME r337 bridge the LLM lanes have — and the r340 drift
    // heal covers key rotation for these lanes too.
    ...ACQUISITION_PROVIDERS.filter(
      (p) =>
        settings.providerKeys?.[p.id]?.key?.trim() &&
        !slots.some((s) => s.provider === p.id),
    ).map((p) => ({ id: p.id, name: p.label })),
  ];

  // r340: KEY DRIFT — a mirrored slot whose provider ALSO has a browser-saved
  // key can silently fall behind: the user rotates the key in Providers,
  // mirrorCandidates excludes the provider (a slot already exists), the r337
  // strip disappears, and closed-tab runs keep dialing with the OLD key —
  // with no hint anywhere in the card. Detectable without exposing anything:
  // mask the browser key with the exact server algorithm (maskOf above — the
  // same function the r135/r218 Test round-trip is verified against) and
  // compare with the slot's masked preview. Mismatch = drift; the fix is one
  // click (mirrorProvider re-upserts by provider id, idempotent). No browser
  // key → nothing to compare → no drift claim (the slot may be intentionally
  // manual; a deleted browser key must not nag). Short keys (≤12 chars) mask
  // to all dots on BOTH sides, so they can never false-positive drift.
  const slotDrifted = (s: VaultSlot): boolean => {
    const browserKey = settings.providerKeys?.[s.provider]?.key?.trim();
    return !!browserKey && maskOf(browserKey) !== s.maskedKey;
  };

  // OWN-b: loop-readiness summary — derived EXCLUSIVELY from state this card
  // already renders (no new fetches, no new claims). The drift census reuses
  // the EXACT row-chip condition (resolvable && drifted) so the strip can
  // never disagree with the list; the acquisition census reuses the r562
  // formula (source !== null over the full registry denominator).
  const driftCount = laneSlots.filter(
    (s) => !!providerById(s.provider) && slotDrifted(s),
  ).length;
  const dialSlotName = dialSlot
    ? (providerById(dialSlot.provider)?.name ?? null)
    : null;
  const acqKeyed = acqLanes.filter((a) => a.source !== null).length;

  // ─── r654: DRIFT AUTO-HEAL — the vault card heals its own drift on sight.
  // The Owner's Vyce slot (the server lane's FIRST dial) sat on "key drifted —
  // re-mirror" while the browser key had already been re-validated: closed-tab
  // schedules kept dialing the OLD key from SQLite. When this card becomes
  // visible and a resolvable chat slot's mask disagrees with the browser key,
  // re-upsert the FRESH key (opt-in doctrine intact: a provider with no slot
  // is NEVER auto-created; a deleted browser key never nags). Healed slots
  // re-load and the amber chip vanishes because the drift is GONE — visible
  // zero, not attributed. Failures leave the manual chip as the fallback.
  const healInFlightRef = React.useRef(false);
  React.useEffect(() => {
    if (loading || loadFailed) return;
    if (healInFlightRef.current) return;
    const drifted = slots.filter((s) => {
      if (!providerById(s.provider)) return false;
      const browserKey = useSettingsStore.getState().settings.providerKeys?.[s.provider]?.key;
      return slotIsDrifted(browserKey, s.maskedKey);
    });
    if (drifted.length === 0) {
      healInFlightRef.current = false;
      return;
    }
    healInFlightRef.current = true;
    void (async () => {
      let healed = 0;
      for (const s of drifted) {
        const browserKey = useSettingsStore.getState().settings.providerKeys?.[s.provider]?.key;
        const r = await remirrorIfDrifted(s.provider, browserKey);
        if (r === "healed") healed += 1;
      }
      if (healed > 0) {
        toast.success(
          healed === 1
            ? "Drifted key auto re-mirrored — the closed-tab lane dials the fresh key now"
            : `${healed} drifted slots auto re-mirrored — the closed-tab lane dials the fresh keys now`,
          { description: "Healed from your saved provider keys (drift heal). Local SQLite only, nothing leaves this machine." },
        );
        void load();
      } else {
        // server down / races — the manual amber chip stays; retry on the
        // card's next visibility episode (the r218 observer refetches).
        healInFlightRef.current = false;
      }
    })();
  }, [slots, loading, loadFailed, load]);

  async function save() {
    if (!key.trim()) {
      toast.error("Paste a key first — the vault stores exactly what you paste.");
      return;
    }
    setSaving(true);
    try {
      const { res, json } = await apiJson<{ ok?: boolean; error?: string }>("/api/vault", {
        method: "POST",
        headers: { "content-type": "application/json", "x-nexus-csrf": "1" },
        body: JSON.stringify({ provider: "builtin", key: key.trim() }),
      });
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
      const { res, json } = await apiJson<{ ok?: boolean; error?: string }>("/api/vault?provider=builtin", {
        method: "DELETE",
        headers: { "x-nexus-csrf": "1" },
      });
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
      const { res, json } = await apiJson<{ ok?: boolean; error?: string }>("/api/vault", {
        method: "POST",
        headers: { "content-type": "application/json", "x-nexus-csrf": "1" },
        body: JSON.stringify({ provider: laneProvider, key: laneKey.trim() }),
      });
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setLaneKey("");
      await load();
      // r707: keep the browser-side copy too — acquisition keys were
      // server-only, and a db reset took them twice (the rollback class this
      // vault has witnessed). providerKeys is the mirror strip's source, so
      // the lane comes back with one click after any reset. Best-effort: the
      // server slot above already succeeded; a failed browser write must not
      // fail the store toast.
      try {
        const cur = useSettingsStore.getState().settings;
        useSettingsStore.getState().update({
          providerKeys: {
            ...cur.providerKeys,
            [laneProvider]: {
              ...(cur.providerKeys?.[laneProvider] ?? {}),
              key: laneKey.trim(),
            },
          },
        });
      } catch {
        /* browser copy is best-effort — the server slot is the source of truth */
      }
      // r548 realignment heal (browser half): the fresh key must not inherit
      // the old key's lane-health/breaker stamps — clear THIS provider's
      // browser dial memory so it re-enters every wire immediately.
      clearProviderLaneHealth(laneProvider);
      resetProviderBreaker(laneProvider);
      // r556: the toast must not out-promise the lane — a chat slot dials
      // closed-tab runs; a live acquisition slot feeds the radar probe; a
      // DORMANT acquisition slot is honest guard-resolved capacity only
      // (no dial exists yet — "can dial now" would be a lie).
      const acq = acquisitionById(laneProvider);
      const laneName = acq?.label ?? providerById(laneProvider)?.name ?? laneProvider;
      toast.success(
        acq?.status === "dormant"
          ? `Token stored — ${laneName}'s lane stays dormant until its dial dialect ships.`
          : acq
            ? "Acquisition key stored — the lane picks it up on its next probe."
            : "Server-lane key stored — closed-tab runs can dial now.",
        {
          description: acq
            ? acq.status === "dormant"
              ? "The guard resolves it today (fleet chip: key stored — dial pending); the lane lights up the moment the dialect lands. Local SQLite only, nothing leaves this machine."
              : "Acquisition lanes are data probes — the executor never dials them as LLM steps. Local SQLite only, nothing leaves this machine. A browser copy is kept — the mirror strip (this card) restores the lane after any reset."
            : "Local SQLite only, nothing leaves this machine.",
        },
      );
    } catch (e) {
      toast.error("Could not store the server-lane key", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLaneSaving(false);
    }
  }

  // r337: one-click mirror of a BROWSER-saved key into the server vault —
  // same POST contract as saveLane (upsert by provider id, CSRF-gated),
  // labeled honestly so the slot's provenance shows in the card.
  async function mirrorProvider(providerId: string) {
    const savedKey = settings.providerKeys?.[providerId]?.key?.trim();
    if (!savedKey) return;
    setMirroringProvider(providerId);
    try {
      const { res, json } = await apiJson<{ ok?: boolean; error?: string }>("/api/vault", {
        method: "POST",
        headers: { "content-type": "application/json", "x-nexus-csrf": "1" },
        body: JSON.stringify({
          provider: providerId,
          key: savedKey,
          label: "mirrored from saved provider keys",
        }),
      });
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      await load();
      // r548: the mirror just replaced the credential — the BROWSER dial
      // memory (lane health + provider breaker in localStorage) must not pin
      // the old key's 429/fail stamps. Clear this provider's entries so the
      // fresh key re-enters every browser wire immediately; the server half
      // of the heal is the r335 recheck below.
      const clearedBrowser = clearProviderLaneHealth(providerId);
      resetProviderBreaker(providerId);
      // r341: the mirror just REPLACED the server slot's credential — but the
      // executor's server-process rotation map still skips this provider for
      // up to 6h after an old billing 403 (its memory heals only on a proven
      // dial FROM that lane, which the skip itself prevents — the r332
      // chicken-and-egg). Fire the r335 recheck now: it probes the FRESH slot
      // key for free (account endpoint / models liveness) and clears the
      // server lane on any HTTP 200, so a rotated key works for closed-tab
      // runs immediately instead of after the quarantine expires. Never
      // blocks or fails the mirror; failure just means the server lane heals
      // on its next proven dial or a later recheck.
      let healNote = "";
      try {
        const rec = await fetch("/api/providers/recheck", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerId }),
        });
        const rd = (await rec.json()) as {
          ok?: boolean;
          cleared?: { billingLeftMs: number; cooldownLeftMs: number };
        };
        if (rd.ok && rd.cleared && (rd.cleared.billingLeftMs > 0 || rd.cleared.cooldownLeftMs > 0)) {
          healNote = " The server lane was quarantined from an older failure — cleared just now.";
        }
      } catch {
        /* cosmetic server-lane heal — the mirror itself already succeeded */
      }
      if (clearedBrowser > 0) {
        healNote += " Browser dial memory carried the old key's failure stamps — cleared; the fresh key dials immediately.";
      }
      toast.success("Key mirrored to the server lane", {
        description: `${providerById(providerId)?.name ?? providerId} · closed-tab schedules can dial with it now. Local SQLite only, nothing leaves this machine.${healNote}`,
      });
    } catch (e) {
      toast.error("Mirror failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setMirroringProvider(null);
    }
  }

  // r720: the third wipe's recovery road. The r719 handoff's instruction was
  // "click the 17 waiting Mirror buttons" — with more than a handful of
  // candidates that is N clicks of a mechanical loop. Mirror all (n) runs the
  // SAME mirrorProvider seam sequentially — same toasts, same drift heal,
  // same single write path — so the bulk action introduces no second mapping.
  async function mirrorAllCandidates() {
    if (mirroringAll || mirroringProvider) return;
    setMirroringAll(true);
    try {
      for (const c of mirrorCandidates) {
        await mirrorProvider(c.id);
      }
    } finally {
      setMirroringAll(false);
    }
  }

  async function removeSlot(provider: string) {
    // r420: first click ARMS — the second click is the one that deletes.
    // Clicking Remove on a different slot re-arms onto that slot (the
    // previous one's label reverts naturally, one armed slot at a time).
    if (confirmRemoveProvider !== provider) {
      setConfirmRemoveProvider(provider);
      return;
    }
    try {
      const res = await fetch(`/api/vault?provider=${encodeURIComponent(provider)}`, {
        method: "DELETE",
        headers: { "x-nexus-csrf": "1" },
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      maskNow(); // a revealed key must not linger past its slot's death
      await load();
      toast.success("Server-lane key removed — closed-tab runs stay queued until a key is stored again.", {
        description: "Nothing dials implicitly; the executor never falls back.",
      });
    } catch (e) {
      toast.error("Could not remove the key", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setConfirmRemoveProvider(null);
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
        headers: { "content-type": "application/json", "x-nexus-csrf": "1" },
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
      // r556: honest dial expectation per lane class — acquisition slots
      // are never closed-tab LLM dials; dormant ones have no dial at all yet.
      const acqTest = acquisitionById(provider);
      const dialNote = acqTest
        ? acqTest.status === "dormant"
          ? ` — ${acqTest.label}'s dial dialect is still dormant; the guard resolves it, the lane dials when it ships.`
          : " — the acquisition lane consumes it through the guard."
        : " — closed-tab runs will dial with it.";
      toast.success(`${name} key verified`, {
        description: `The headless handoff returns it intact (${masked})${dialNote}`,
      });
    } catch (e) {
      toast.error("Key test failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setTestingProvider(null);
    }
  }

  // r276 finally wired (r413): the LIVE-DIAL verdict the storage Test never
  // gave. The endpoint loads the slot server-side and dials the provider's
  // allowlisted models endpoint with the stored raw key — the key never
  // leaves the server, the response is a verdict + HTTP status only. Four
  // verdicts (the endpoint's honest vocabulary, r276): verified / rejected /
  // inconclusive (region-IP block — key unjudged) / unreachable.
  async function liveDial(provider: string) {
    setDialingProvider(provider);
    try {
      const res = await fetch("/api/vault/test-dial", {
        method: "POST",
        headers: { "content-type": "application/json", "x-nexus-csrf": "1" },
        body: JSON.stringify({ provider }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        verdict?: string;
        httpStatus?: number;
        error?: string;
      };
      if (res.status === 400) {
        toast.error("No dial target for this provider", {
          description:
            json.error ?? "This provider has no allowlisted endpoint the server can dial.",
        });
        return;
      }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      const name = providerById(provider)?.name ?? provider;
      const status =
        typeof json.httpStatus === "number" ? ` (HTTP ${json.httpStatus})` : "";
      if (json.verdict === "verified") {
        toast.success(`${name} key accepted by the provider${status}`, {
          description:
            "Live dial verified — closed-tab runs can dial with this key.",
        });
      } else if (json.verdict === "rejected") {
        toast.error(`${name} rejected this key${status}`, {
          description:
            "The provider refused the stored credential — rotate the key and re-store it.",
        });
      } else if (json.verdict === "inconclusive") {
        toast.warning(`${name} dial inconclusive${status}`, {
          description:
            "A region/IP block answered, not the provider's auth — the key itself was NOT judged.",
        });
      } else {
        toast.warning(`${name} unreachable${status}`, {
          description:
            "The dial never reached the provider — the key was not exercised. Retry when the network recovers.",
        });
      }
    } catch (e) {
      toast.error("Live dial failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setDialingProvider(null);
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
        headers: { "content-type": "application/json", "x-nexus-csrf": "1" },
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
        <div className="flex flex-wrap items-center gap-2">
          <ShieldCheck className="h-4 w-4 shrink-0 text-cyan-500" aria-hidden />
          <CardTitle>Automation vault</CardTitle>
          <Badge variant="outline" className="border-cyan-500/40 text-cyan-600 dark:text-cyan-400">
            local-only
          </Badge>
          <Badge
            variant="outline"
            className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
            title="Keys are encrypted at rest with AES-256-GCM before they touch local SQLite (machine-held master key). A copied DB file alone no longer yields usable keys."
          >
            AES-256-GCM at rest
          </Badge>
          <DeepLinkShare anchor="vault" label="the Automation vault" />
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 px-2.5 text-xs"
              onClick={() => setAskBackup(true)}
              disabled={backingUp || restoring}
              title="Download every stored slot as a versioned JSON backup. The file is plaintext by design — the confirm dialog says so before anything is written."
            >
              {backingUp ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Download className="h-3.5 w-3.5" aria-hidden />
              )}
              Backup
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 px-2.5 text-xs"
              onClick={() => fileInputRef.current?.click()}
              disabled={backingUp || restoring}
              title="Restore slots from a backup JSON (the same document Backup downloads). Import upserts each slot with normal save semantics."
            >
              {restoring ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Upload className="h-3.5 w-3.5" aria-hidden />
              )}
              Restore
            </Button>
          </div>
        </div>
        {/* OWN-b: loop-readiness strip — one honest row built from the same
            state the card renders below; hidden entirely while the read is
            in flight or failed (no counts over a dead read, r413 class). */}
        {!loading && !loadFailed ? (
          <div
            className="flex flex-wrap items-center gap-1.5"
            data-testid="vault-readiness-strip"
            aria-label={`Vault loop readiness: ${laneSlots.length} lanes stored${dialSlotName ? `, dials ${dialSlotName} first` : ""}${driftCount > 0 ? `, ${driftCount} drifted` : ""}${acqLanes.length > 0 ? `, acquisition ${acqKeyed}/${ACQUISITION_PROVIDERS.length} keyed` : ""}`}
          >
            <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-px text-[10px] font-medium tabular-nums text-sky-600 dark:text-sky-400">
              <span aria-hidden="true">⟐ </span>
              {laneSlots.length} lanes stored
            </span>
            {dialSlotName ? (
              <span
                className={cn(
                  "rounded-full border px-2 py-px text-[10px] font-medium tabular-nums",
                  driftCount > 0
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                    : "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                )}
              >
                dials {dialSlotName} first
              </span>
            ) : null}
            {driftCount > 0 ? (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-px text-[10px] font-medium tabular-nums text-amber-600 dark:text-amber-400">
                {driftCount} drifted
              </span>
            ) : null}
            {acqLanes.length > 0 ? (
              <span className="rounded-full border border-border/60 bg-muted/40 px-2 py-px text-[10px] font-medium tabular-nums text-muted-foreground">
                acquisition {acqKeyed}/{ACQUISITION_PROVIDERS.length} keyed
              </span>
            ) : null}
          </div>
        ) : null}
        <CardDescription>
          While a tab is open, schedules run in-browser with your own keys — they never
          leave the browser. When the tab is closed, the local server claims due schedules
          itself but dials only with a registry-provider key stored below; with no key,
          runs stay queued instead of falling back to anything implicit. Stored in local
          SQLite, encrypted at rest (AES-256-GCM), never telemetered, displayed masked.
        </CardDescription>
      </CardHeader>
      {/* r655: hidden file picker for Restore — lives outside the buttons so
          both header and empty-state affordances drive the same input. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={onRestoreFile}
        tabIndex={-1}
        aria-hidden="true"
      />
      <CardContent className="space-y-4">
        {loadFailed && !loading ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-red-500/30 bg-red-500/5 px-2.5 py-2 text-xs text-red-600 dark:text-red-400">
            <span className="font-medium">
              Couldn&apos;t read the vault — the server didn&apos;t answer.
            </span>
            <span className="text-[10.5px] text-muted-foreground">
              Slots shown (if any) are the last known state — &ldquo;no key
              stored&rdquo; below may be false.
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void load()}
              className="ml-auto h-6 border-red-500/40 px-2 text-[10px] text-red-600 hover:bg-red-500/10 dark:text-red-400"
            >
              Retry
            </Button>
          </div>
        ) : null}
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
                  {p.lane === "acquisition" ? " — acquisition lane" : ""}
                </option>
              ))}
              {/* r554: registry rows the chat picker doesn't carry (dormant
                  acquisition providers) are storable anyway — the guard
                  resolves them today (fleet chip flips to "key stored — dial
                  pending") and the executor skips them as dial targets
                  (unknown to the chat registry ⇒ no-resolvable-provider). */}
              {ACQUISITION_PROVIDERS.filter((p) => !providerById(p.id)).map((p) => (
                <option key={`acq-${p.id}`} value={p.id}>
                  {p.label} — acquisition lane (dial pending)
                </option>
              ))}
            </select>
            <Input
              ref={laneKeyRef}
              type="password"
              value={laneKey}
              onChange={(e) => setLaneKey(e.target.value)}
              placeholder="paste the provider key for closed-tab runs"
              // r419 audit: placeholders are not reliable accessible names —
              // this password field had no label plumbing at all.
              aria-label="Lane provider key for closed-tab runs"
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
          {/* r562: the acquisition cluster is now its own component —
              the visual seam r561 drew, made modular (acquisition-lanes-panel.tsx). */}
          <AcquisitionLanesPanel
            acqLanes={acqLanes}
            laneProvider={laneProvider}
            setLaneProvider={setLaneProvider}
            laneKeyRef={laneKeyRef}
          />
          {/* r564: the browser→server mirror strip is its own component
              (mirror-candidates-strip.tsx) — same seam doctrine as r562's
              acquisition panel; the card computes candidates and owns the
              busy state (shared with the drift re-mirror buttons below). */}
          <MirrorCandidatesStrip
            candidates={mirrorCandidates}
            bulkBusy={mirroringAll}
            onMirrorAll={() => void mirrorAllCandidates()}
            busy={mirroringProvider}
            onMirror={mirrorProvider}
          />
          {(loadFailed && laneSlots.length === 0) ? null : (
            <LaneSlotsList
              slots={laneSlots}
              dialProvider={dialSlot?.provider ?? null}
              revealed={revealed}
              revealingProvider={revealingProvider}
              testingProvider={testingProvider}
              mirroringProvider={mirroringProvider}
              dialingProvider={dialingProvider}
              confirmRemoveProvider={confirmRemoveProvider}
              drifted={slotDrifted}
              onReveal={revealSlot}
              onTest={testSlot}
              onLiveDial={liveDial}
              onMirror={mirrorProvider}
              onRemove={removeSlot}
            />
          )}
          {/* r720: the container mounts in BOTH vault states — the
              backup road used to vanish exactly when keys existed. */}
          {!loading && !loadFailed ? (
            <div className="mt-1.5 space-y-1.5">
              {/* r720: empty-vault prose + durability ledger stay
                  empty-only — they explain a vault with nothing in it. */}
              {slots.length === 0 ? (
                <>
              <p className="text-[10px] leading-relaxed text-muted-foreground/70">
                Empty vault — restore a backup file made by the Backup button, or key a lane
                from the acquisition lanes below. The executor dials only with a key stored
                here: an empty vault is an honest no-op, never an implicit fallback.
              </p>
              {/* r698: the durability ledger — the in-UI answer to "my stored
                  settings vanished". An empty vault after a sandbox rebuild is
                  indistinguishable from a never-used one unless the page says
                  where each layer lives and what it survives: browser storage
                  dies with the profile/origin, this machine's SQLite dies with
                  a sandbox rebuild (the rollback class the patrol has
                  witnessed empty this very table), and only the backup file
                  travels. The kicker is the r567 forensic made visible: no
                  background cleanup exists, so a vanished key means the
                  database was reverted — never the app deleting it. */}
              <div
                data-testid="vault-durability-ledger"
                className="space-y-1.5 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2"
              >
                <p className="text-[10px] font-medium text-muted-foreground">
                  Where keys live — and what each layer survives:
                </p>
                <ul className="space-y-1">
                  <li
                    className="group flex cursor-help items-start gap-1.5"
                    title="Browser-saved keys never leave the browser — while a tab is open, schedules dial with them in-page. They do not follow you to a new browser profile or a rebuilt sandbox."
                  >
                    <Globe
                      className="mt-0.5 h-3 w-3 shrink-0 text-cyan-500 opacity-70 transition-opacity duration-500 group-hover:opacity-100"
                      aria-hidden
                    />
                    <span className="text-[10px] leading-relaxed text-muted-foreground/80 transition-colors duration-500 group-hover:text-muted-foreground">
                      <strong className="font-medium text-muted-foreground">
                        Browser-saved
                      </strong>{" "}
                      — this browser&apos;s storage; survives tab closes, lost when the
                      browser profile or sandbox origin resets (the waiting mirror
                      candidates above live here).
                    </span>
                  </li>
                  <li
                    className="group flex cursor-help items-start gap-1.5"
                    title="Encrypted at rest (AES-256-GCM), masked in the UI, never telemetered. The closed-tab executor dials only with a key stored here — and no background cleanup ever removes one. This vault has come back empty after three database rebuilds (Oct 27, 28 and 29, 2026) — the backup file below is the bridge."
                  >
                    <HardDrive
                      className="mt-0.5 h-3 w-3 shrink-0 text-amber-500 opacity-70 transition-opacity duration-500 group-hover:opacity-100"
                      aria-hidden
                    />
                    <span className="text-[10px] leading-relaxed text-muted-foreground/80 transition-colors duration-500 group-hover:text-muted-foreground">
                      <strong className="font-medium text-muted-foreground">
                        Stored here
                      </strong>{" "}
                      — this machine&apos;s SQLite; survives browser resets, but a sandbox
                      rebuild reverts the database file itself — keys here have vanished
                      that way three times now.
                    </span>
                  </li>
                  <li
                    className="group flex cursor-help items-start gap-1.5"
                    title="The Backup button exports the plaintext key file; Restore (below) or bun scripts/seedwrite.ts --import re-populates the vault from it."
                  >
                    <FileDown
                      className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500 opacity-70 transition-opacity duration-500 group-hover:opacity-100"
                      aria-hidden
                    />
                    <span className="text-[10px] leading-relaxed text-muted-foreground/80 transition-colors duration-500 group-hover:text-muted-foreground">
                      <strong className="font-medium text-muted-foreground">
                        Backup file
                      </strong>{" "}
                      — the only layer that travels: export plaintext, keep it safe,
                      restore below after any reset.
                    </span>
                    {/* r705: the row's own action — the prose pointed at the card's
                        Backup button; the bridge is now clickable in place. Same
                        r655 flow (confirm → plaintext JSON download), honest empty
                        toast included; hover arms ride the r690 fade clock. */}
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid="vault-ledger-backup"
                      className="ml-auto h-5 shrink-0 gap-1 self-start px-1.5 text-[10px] font-medium text-emerald-600 transition-colors duration-500 hover:bg-emerald-500/15 hover:text-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-500/20 dark:hover:text-emerald-300"
                      onClick={() => setAskBackup(true)}
                      disabled={backingUp || restoring}
                      title="Back up now — the same export flow as the card's Backup button: an in-app confirm, then the plaintext JSON as a file download AND a copyable dialog (the preview panel can silently block file downloads — an empty vault honestly says so)."
                    >
                      {backingUp ? (
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                      ) : (
                        <FileDown className="h-3 w-3" aria-hidden />
                      )}
                      Back up now
                    </Button>
                  </li>
                </ul>
                <p className="text-[10px] leading-relaxed text-muted-foreground/70">
                  No background cleanup ever touches this vault — a vanished key means the
                  machine&apos;s database was reverted, not deleted by the app. Code and
                  history live in version control and survive resets; this database does
                  not — the backup file is the bridge for keys.
                </p>
              </div>
                </>
              ) : null}
              {/* r721: the always-mounted cluster gained its name — r720 made
                  it visible in both vault states but it floated unlabeled
                  between the slot list and the CLI note. */}
              <div className="flex items-center gap-2 pt-0.5">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
                  Backup &amp; restore
                </span>
                <span className="h-px flex-1 bg-border/60" aria-hidden />
              </div>
              {/* r720: the populated-state twin of the ledger's r705 row —
                  both open the ONE askBackup confirm; no second mapping. */}
              <div className="flex items-center justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="vault-backup-populated"
                  className="h-5 gap-1 px-1.5 text-[10px] font-medium text-emerald-600 transition-colors duration-500 hover:bg-emerald-500/15 hover:text-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-500/20 dark:hover:text-emerald-300"
                  onClick={() => setAskBackup(true)}
                  disabled={backingUp || restoring}
                  title="Back up now — an in-app confirm, then the plaintext JSON as a file download AND a copyable dialog (the preview panel can silently block file downloads — the dialog always shows the text to copy). Keep the text outside the sandbox."
                >
                  {backingUp ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  ) : (
                    <FileDown className="h-3 w-3" aria-hidden />
                  )}
                  Back up now
                </Button>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 px-2.5 text-xs"
                onClick={() => fileInputRef.current?.click()}
                disabled={restoring}
              >
                {restoring ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Upload className="h-3.5 w-3.5" aria-hidden />
                )}
                Restore a backup
              </Button>
              {/* r719: paste-restore — the third road: no file picker, no
                  download, just text through the same POST. */}
              <div className="mt-1.5 flex flex-col gap-1.5">
                <Textarea
                  aria-label="Paste a backup JSON to restore"
                  placeholder="Or paste a backup JSON here (the same document the Backup dialog shows) — no file picker needed"
                  className="min-h-[52px] font-mono text-[10.5px]"
                  value={restoreText}
                  onChange={(e) => setRestoreText(e.target.value)}
                  spellCheck={false}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-fit gap-1.5 px-2.5 text-xs"
                  onClick={() => void restoreVaultText(restoreText)}
                  disabled={restoring || !restoreText.trim()}
                >
                  {restoring ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Upload className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Restore from pasted text
                </Button>
              </div>
              {/* r719: in-app confirm — window.confirm is silently blocked
                  (returns false) inside sandboxed preview iframes, which
                  killed the export before it ever ran. */}
              <Dialog open={askBackup} onOpenChange={setAskBackup}>
                <DialogContent className="max-w-sm">
                  <DialogHeader>
                    <DialogTitle>Export the vault backup?</DialogTitle>
                    <DialogDescription>
                      The backup holds every stored key UNENCRYPTED. The file download can be
                      silently blocked inside the preview panel — the next dialog always shows
                      the plaintext to copy, so the backup travels even then.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setAskBackup(false)}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={() => void backupVault()} disabled={backingUp}>
                      {backingUp ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : null}
                      Export backup
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
              <Dialog open={backupText !== null} onOpenChange={(o) => !o && setBackupText(null)}>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Vault backup — copy it somewhere safe</DialogTitle>
                    <DialogDescription>
                      Plaintext keys below. If the file download never arrived (the preview
                      panel can block it silently), this text IS the backup — copy it out and
                      keep it outside the sandbox.
                    </DialogDescription>
                  </DialogHeader>
                  <Textarea
                    readOnly
                    data-testid="export-plaintext"
                    aria-label="Vault backup JSON"
                    className="max-h-72 min-h-[120px] font-mono text-[10.5px]"
                    value={backupText ?? ""}
                    ref={backupTextRef}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-muted-foreground">
                      plaintext · restore via the paste box above
                    </span>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setBackupText(null)}>
                        Close
                      </Button>
                      <Button
                        size="sm"
                        onClick={async () => {
                          if (!backupText) return;
                          try {
                            await navigator.clipboard.writeText(backupText);
                            toast.success("Backup copied to the clipboard.");
                          } catch {
                            backupTextRef.current?.focus();
                            toast.info("Clipboard blocked — the text is selected, press Ctrl+C / ⌘C.");
                          }
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" aria-hidden />
                        Copy
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
              <p className="text-[10px] leading-relaxed text-muted-foreground/70">
                Prefer the CLI?{" "}
                <code className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[9.5px]">
                  bun scripts/seedwrite.ts --import
                </code>{" "}
                re-populates without a restart (writes through the AES-256-GCM vault;{" "}
                <code className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[9.5px]">
                  bun scripts/seedwrite.ts
                </code>{" "}
                exports the plaintext backup).
              </p>
            </div>
          ) : null}
        </div>

        {loading ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Reading vault…
          </p>
        ) : builtin ? (
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
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
          </div>
        ) : null}

        {builtin ? (
        <div className="space-y-2">
          <Label htmlFor="vault-key" className="text-xs text-muted-foreground">
            Key for the built-in engine lane (legacy slot — stored keys can be updated or removed here)
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
        ) : (
          <p className="text-[11px] leading-relaxed text-muted-foreground/70">
            <span className="font-medium">Vestigial built-in lane — nothing to do here.</span> This
            handoff predates the registry-provider vault and is unused by the server lane;
            closed-tab runs dial the registry-provider slots above. No key is stored, so
            the legacy input stays out of your way (it only reappears if a legacy slot
            ever exists to remove).
          </p>
        )}
      </CardContent>
    </Card>
    </div>
  );
}
