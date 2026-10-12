"use client";

import * as React from "react";
import { Download, ExternalLink, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, ThemeToggle } from "@/components/praison/atoms";
import { ThemePicker } from "@/components/praison/settings/theme-picker";
import { AutomationVaultCard } from "@/components/praison/settings/automation-vault-card";
import { DeepLinkShare } from "@/components/praison/settings/deep-link-share";
import { LocalModelsPanel } from "@/components/praison/settings/local-models";
import { ModelRelayCard } from "@/components/praison/settings/model-relay";
import { ProviderCard } from "@/components/praison/settings/provider-card";
import { ProviderGallery } from "@/components/praison/settings/provider-gallery";
import { ReferralCard } from "@/components/praison/settings/referral-card";
import { SetupWizard } from "@/components/praison/settings/setup-wizard";
import { StorageUsage } from "@/components/praison/settings/storage-usage";
import { UsageDashboard } from "@/components/praison/settings/usage-dashboard";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  APP_VERSION,
  DEFAULT_SETTINGS,
  DEFAULT_TTS_VOICE,
  GITHUB_URL,
  SPEECH_RATES,
  TTS_VOICES,
} from "@/lib/constants";
import { downloadJson } from "@/lib/helpers";
import { WhatsFixedSection } from "@/components/praison/settings/whats-fixed";

// ── r196 credential presence ──────────────────────────────────────────────
// r193 strips the three credential fields from every full-data export, so
// an absent/empty field in an import file means "the file cannot speak for
// this" — NOT "the exporting browser had none". applyPendingImport keeps
// this browser's value for any field the file is silent on, and the confirm
// dialog states the disposition instead of claiming keys come from the file.
type FileCredentialPresence = {
  apiKey: boolean;
  providerKeys: boolean;
  typesafeKey: boolean;
  any: boolean;
  all: boolean;
};

function fileCredentialPresence(
  raw: Record<string, unknown> | null | undefined,
): FileCredentialPresence {
  const apiKey = typeof raw?.apiKey === "string" && raw.apiKey.trim().length > 0;
  const providerKeys =
    !!raw?.providerKeys &&
    typeof raw.providerKeys === "object" &&
    !Array.isArray(raw.providerKeys) &&
    Object.keys(raw.providerKeys).length > 0;
  const typesafeKey =
    typeof raw?.typesafeKey === "string" && raw.typesafeKey.trim().length > 0;
  const any = apiKey || providerKeys || typesafeKey;
  return {
    apiKey,
    providerKeys,
    typesafeKey,
    any,
    all: apiKey && providerKeys && typesafeKey,
  };
}
import {
  useAgentsStore,
  useConversationsStore,
  useSettingsStore,
  useUiStore,
  useWorkflowsStore,
  trimImportBundle,
} from "@/lib/stores";
import type {
  Agent,
  ChatMessage,
  Conversation,
  Framework,
  SpawnProposal,
  Workflow,
} from "@/lib/types";
import { cn } from "@/lib/utils";

// ── r169 import doctrine (parity with the r165 vault restore) ──────────────
// Every imported entry is sanitized INDIVIDUALLY: junk is skipped and counted
// honestly instead of becoming live store state that can crash the app after
// reload (recoverable only by wiping everything). Identity + the load-bearing
// fields must hold; optional fields are kept untouched — the stores already
// tolerate their absence via defaults.
let importSeq = 0;

function sanitizeAgent(raw: unknown): Agent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.id !== "string" || !a.id.trim()) return null;
  if (typeof a.name !== "string" || typeof a.instructions !== "string") return null;
  return a as unknown as Agent;
}

function sanitizeMessage(raw: unknown, convId: string): ChatMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (m.role !== "user" && m.role !== "assistant") return null;
  if (typeof m.content !== "string") return null;
  if (typeof m.id !== "string" || !m.id.trim()) {
    // Real content with a missing id — synthesize one rather than drop it.
    importSeq += 1;
    m.id = `${convId}-imp-${Date.now().toString(36)}-${importSeq}`;
  }
  return m as unknown as ChatMessage;
}

function sanitizeConversation(raw: unknown): Conversation | null {
  if (typeof raw !== "object" || raw === null) return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.id !== "string" || !c.id.trim() || !Array.isArray(c.messages)) return null;
  const convId = c.id; // property narrowing doesn't survive into closures
  const messages = (c.messages as unknown[])
    .map((m) => sanitizeMessage(m, convId))
    .filter((m): m is ChatMessage => m !== null);
  return { ...(c as unknown as Conversation), messages };
}

function sanitizeWorkflow(raw: unknown): Workflow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const w = raw as Record<string, unknown>;
  if (typeof w.id !== "string" || !w.id.trim()) return null;
  if (typeof w.name !== "string" || !Array.isArray(w.steps)) return null;
  // Non-object step slots are junk that would crash the runner's maps.
  const steps = w.steps.filter((s) => typeof s === "object" && s !== null);
  return {
    ...(w as unknown as Workflow),
    steps,
    runs: Array.isArray(w.runs) ? (w.runs as Workflow["runs"]) : [],
  };
}

// r460: proposals are OPTIONAL in an export (older files lack the field) — a
// dangling sourceWorkflowId is benign (every consumer filters by id, dismiss
// still works), so identity + the human-readable fields are the load-bearing
// checks, mirroring the store's own addProposal invariants.
function sanitizeProposal(raw: unknown): SpawnProposal | null {
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.id !== "string" || !p.id.trim()) return null;
  if (typeof p.goal !== "string" || typeof p.reason !== "string") return null;
  if (p.status !== "open" && p.status !== "accepted" && p.status !== "dismissed") return null;
  if (typeof p.createdAt !== "number" || !Number.isFinite(p.createdAt)) return null;
  return p as unknown as SpawnProposal;
}

/** Sticky section-nav — ids must match the wrapper elements below. */
const SETTINGS_SECTIONS = [
  { id: "whats-fixed", label: "What's fixed" },
  { id: "usage", label: "Usage" },
  { id: "providers", label: "Providers" },
  { id: "local-models", label: "Local models" },
  { id: "relay", label: "Model Relay" },
  { id: "vault", label: "Vault" },
  { id: "referrals", label: "Referrals" },
  { id: "behavior", label: "Behavior" },
  { id: "evolution", label: "Evolution" },
  { id: "profile", label: "Profile" },
  { id: "appearance", label: "Appearance" },
  { id: "data", label: "Your Data" },
] as const;

const FRAMEWORK_OPTIONS: { value: Framework; title: string; sub: string }[] = [
  {
    value: "sequential",
    title: "Sequential — CrewAI-style",
    sub: "Each agent receives a distilled handoff of previous step outputs",
  },
  {
    value: "conversational",
    title: "Conversational — AutoGen-style",
    sub: "Each agent sees the full transcript of the team conversation",
  },
];

// r243: human-readable build identity for the About panel — decodes the r189
// /api/version freshness stamp (bootId:mtimeMs) into "server boot" + "source
// last changed". Pairs with the stale-tab guard: after an amber-pill refresh,
// this line lets the user confirm the new build actually landed. One fetch
// per Settings open, same endpoint the guard already polls; a failed fetch
// renders nothing (honest absence, no fake stamp).
function BuildInfoLine() {
  const [info, setInfo] = React.useState<{ boot: string; changedMs: number } | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/version")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { stamp?: string } | null) => {
        if (cancelled || !data?.stamp) return;
        const [boot, mtime] = String(data.stamp).split(":");
        const ms = Number(mtime);
        if (!boot || !Number.isFinite(ms) || ms <= 0) return;
        setInfo({ boot, changedMs: ms });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  if (!info) return null;
  return (
    <p
      data-testid="build-info"
      data-boot={info.boot}
      data-changed-ms={info.changedMs}
      className="text-xs text-muted-foreground"
    >
      Build fingerprint: server boot{" "}
      <span className="font-mono text-[11px]">{info.boot}</span> · source last
      changed {new Date(info.changedMs).toLocaleString()}
    </p>
  );
}

export function SettingsView() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const agents = useAgentsStore((s) => s.agents);
  const conversations = useConversationsStore((s) => s.conversations);
  const workflows = useWorkflowsStore((s) => s.workflows);
  // r460: the spawn-proposal inbox rides the workflows store — export it so a
  // restore no longer starts from an empty board.
  const proposals = useWorkflowsStore((s) => s.proposals);

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // ── Sticky section nav ─────────────────────────────────────────────────
  const [activeSection, setActiveSection] = React.useState<string>("usage");
  React.useEffect(() => {
    const els = SETTINGS_SECTIONS.map((s) => document.getElementById(s.id)).filter(
      (el): el is HTMLElement => !!el
    );
    if (els.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveSection(visible[0].target.id);
      },
      // A narrow band just below the sticky chip bar decides "current".
      { rootMargin: "-64px 0px -70% 0px", threshold: 0 }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // Consume a deep-link scroll target (#/providers · #/local-models hash routes).
  const settingsAnchor = useUiStore((s) => s.settingsAnchor);
  const setSettingsAnchor = useUiStore((s) => s.setSettingsAnchor);
  React.useEffect(() => {
    if (!settingsAnchor) return;
    const t = setTimeout(() => {
      document
        .getElementById(settingsAnchor)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      setSettingsAnchor(null);
    }, 250);
    return () => clearTimeout(t);
  }, [settingsAnchor, setSettingsAnchor]);

  const messageCount = React.useMemo(
    () => conversations.reduce((n, c) => n + c.messages.length, 0),
    [conversations]
  );

  // r196: does THIS browser hold any credentials? Only shapes the import
  // dialog copy — the keep-behavior in applyPendingImport is unconditional.
  const localHasCredentials = Boolean(
    (settings.apiKey && settings.apiKey.trim().length > 0) ||
      (settings.providerKeys && Object.keys(settings.providerKeys).length > 0) ||
      (settings.typesafeKey && settings.typesafeKey.trim().length > 0),
  );

  // r173: a full-data import replaces every entity in this browser — and it
  // used to do that silently (the r169 deferred risk; r164 dirty-guard
  // doctrine says destructive replaces get a confirmation). The file is now
  // parsed AND sanitized on pick, and a dialog states BOTH sides of the
  // trade — what the browser holds now vs what the file would install —
  // before a single byte is written.
  const [pendingImport, setPendingImport] = React.useState<{
    cleanAgents: Agent[];
    cleanConversations: Conversation[];
    cleanWorkflows: Workflow[];
    cleanProposals: SpawnProposal[] | null;
    importedSettings: typeof DEFAULT_SETTINGS;
    skipped: number;
    // r196: which credential fields the FILE carries — r193 scrubbing makes
    // absence ambiguous, so the dialog must not read it as "no keys".
    fileCreds: FileCredentialPresence;
  } | null>(null);

  function handleExport() {
    try {
      // r193 (directive e): the full-data export is the file users attach to
      // bug reports and pass between machines — it must never carry
      // credentials. Strip the three known key fields from settings; the
      // provider vault backup (Settings → Providers) stays the sanctioned
      // way to move keys, and importing an OLD key-bearing export still
      // restores them (backward compatible).
      const { apiKey: _apiKey, providerKeys: _providerKeys, typesafeKey: _typesafeKey, ...exportSettings } = settings;
      downloadJson("praisonai-export.json", {
        exportedAt: new Date().toISOString(),
        settings: exportSettings,
        agents,
        conversations,
        workflows,
        proposals,
      });
      toast.success("Export downloaded — credentials excluded", {
        description: "API keys never leave in the full export. Use the provider vault backup to move keys between browsers.",
      });
    } catch {
      toast.error("Export failed — could not serialize your data.");
    }
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-importing the same file
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch {
        toast.error("Import failed — the file is not valid JSON.");
        return;
      }
      const bundle = (parsed ?? {}) as Record<string, unknown>;
      const valid =
        Array.isArray(bundle.agents) &&
        Array.isArray(bundle.conversations) &&
        Array.isArray(bundle.workflows);
      if (!valid) {
        toast.error("Invalid export file", {
          description:
            "Expected a PraisonAI export containing agents, conversations and workflows arrays.",
        });
        return;
      }
      // Per-entry sanitization with an honest skipped count (r165 doctrine).
      const agentsRaw = bundle.agents as unknown[];
      const conversationsRaw = bundle.conversations as unknown[];
      const workflowsRaw = bundle.workflows as unknown[];
      const cleanAgents = agentsRaw
        .map(sanitizeAgent)
        .filter((a): a is Agent => a !== null);
      const cleanConversations = conversationsRaw
        .map(sanitizeConversation)
        .filter((c): c is Conversation => c !== null);
      const cleanWorkflows = workflowsRaw
        .map(sanitizeWorkflow)
        .filter((w): w is Workflow => w !== null);
      // r460: proposals ride along when present — null for old exports, and
      // capped at the store's deep-trim tail (last 20) so the bundle can't
      // smuggle an unbounded board past the pre-flight measure.
      const proposalsRaw = Array.isArray(bundle.proposals)
        ? (bundle.proposals as unknown[])
        : null;
      const cleanProposals = proposalsRaw
        ? proposalsRaw
            .map(sanitizeProposal)
            .filter((p): p is SpawnProposal => p !== null)
            .slice(-20)
        : null;
      const skipped =
        agentsRaw.length - cleanAgents.length +
        (conversationsRaw.length - cleanConversations.length) +
        (workflowsRaw.length - cleanWorkflows.length) +
        (proposalsRaw ? proposalsRaw.length - (cleanProposals?.length ?? 0) : 0);
      // A malformed settings payload must not poison the store — merge only
      // real objects over the defaults.
      const rawSettings =
        bundle.settings && typeof bundle.settings === "object" && !Array.isArray(bundle.settings)
          ? (bundle.settings as Record<string, unknown>)
          : null;
      const importedSettings = { ...DEFAULT_SETTINGS, ...(rawSettings ?? {}), seeded: true };
      // r196: record which credential fields the file actually carries
      // BEFORE the dialog opens — a scrubbed export must not read as "no keys".
      const fileCreds = fileCredentialPresence(rawSettings);
      // Nothing is written yet — the confirm gate decides (r173).
      setPendingImport({
        cleanAgents,
        cleanConversations,
        cleanWorkflows,
        cleanProposals,
        importedSettings,
        skipped,
        fileCreds,
      });
    };
    reader.onerror = () => toast.error("Import failed — could not read the selected file.");
    reader.readAsText(file);
  }

  // r173: runs only after the user confirms the replace dialog.
  function applyPendingImport() {
    if (!pendingImport) return;
    const {
      cleanAgents,
      cleanConversations,
      cleanWorkflows,
      cleanProposals,
      importedSettings,
      skipped,
      fileCreds,
    } = pendingImport;
    // r196: a scrubbed export cannot speak for credentials — absence is an
    // artifact of r193 sanitization, not evidence the exporter had none.
    // Any credential field the file is silent on keeps this browser's value,
    // so importing a r193+ export no longer wipes the relay into AUTH errors.
    // Built as a FRESH object — pendingImport state is never mutated.
    const finalSettings: typeof DEFAULT_SETTINGS = {
      ...importedSettings,
      ...(!fileCreds.apiKey && { apiKey: settings.apiKey }),
      ...(!fileCreds.providerKeys && { providerKeys: settings.providerKeys }),
      ...(!fileCreds.typesafeKey && { typesafeKey: settings.typesafeKey }),
    };
    // r459: the SAME ladders the live stores use (r414/r455) run over the
    // bundle BEFORE any write — a heavy backup can no longer re-create
    // "Local storage is full" on import, and the trim says so honestly.
    const {
      conversations: trimmedConvs,
      workflows: trimmedWfs,
      deepTrimmed,
    } = trimImportBundle({
      conversations: cleanConversations,
      workflows: cleanWorkflows,
    });
    // Pre-flight: measure the four payloads; localStorage has no transaction,
    // so an over-budget bundle is refused BEFORE anything is written
    // (all-or-nothing at the gate instead of a silently mixed state).
    const payloads = {
      "praison-agents": JSON.stringify({ state: { agents: cleanAgents }, version: 0 }),
      "praison-conversations": JSON.stringify({
        state: {
          conversations: trimmedConvs,
          activeId: trimmedConvs[0]?.id ?? null,
        },
        version: 0,
      }),
      // r460: proposals ride INSIDE the existing workflows key — same shape
      // the live store's partialize persists ({ workflows, proposals }), so a
      // restore no longer boots the board empty. null (old export) keeps [] —
      // zustand's merge falls back to the fresh store's initial value.
      "praison-workflows": JSON.stringify({
        state: { workflows: trimmedWfs, proposals: cleanProposals ?? [] },
        version: 0,
      }),
      "praison-settings": JSON.stringify({ state: { settings: finalSettings }, version: 0 }),
    };
    const totalBytes = Object.values(payloads).reduce((n, s) => n + s.length, 0);
    // ~5MB per-origin quota; 4.5MB leaves headroom for the smaller keys
    // (tracker mirror, radar caches, relay health, intro flags).
    if (totalBytes > 4_500_000) {
      toast.error("Import refused — the backup exceeds browser storage even after trimming", {
        description: `${(totalBytes / 1_000_000).toFixed(1)}MB needed; the origin budget is ~5MB. Nothing was changed.`,
      });
      return;
    }
    const failedKeys: string[] = [];
    for (const [key, payload] of Object.entries(payloads)) {
      try {
        localStorage.setItem(key, payload);
      } catch {
        failedKeys.push(key.replace("praison-", ""));
      }
    }
    if (failedKeys.length > 0) {
      // Honest partial-write accounting — the old catch lied ("Import
      // failed") while some sections had already landed.
      toast.error("Import partially failed — browser storage refused some sections", {
        description: `Landed ${4 - failedKeys.length}/4 (${failedKeys.join(", ")} failed). Reload to load what landed, or Clear all and retry.`,
      });
      return;
    }
    if (deepTrimmed) {
      toast.info("Oversized backup trimmed to fit the storage budget", {
        description: "Old run outputs and older chats were deep-trimmed on the way in — full reports stay in the run archive tier.",
      });
    }
    toast.success("Data imported — reloading…", {
      description: `${cleanAgents.length} agents · ${trimmedConvs.length} conversations · ${trimmedWfs.length} workflows${
        cleanProposals && cleanProposals.length > 0
          ? ` · ${cleanProposals.length} proposals`
          : ""
      }${
        skipped > 0
          ? ` · ${skipped} malformed ${skipped === 1 ? "entry" : "entries"} skipped`
          : ""
      }${deepTrimmed ? " (trimmed to fit)" : ""}`,
    });
    // Reload almost immediately — but when entries were skipped, hold long
    // enough for the honest count to be readable before the toast dies.
    setTimeout(() => location.reload(), skipped > 0 ? 1800 : 250);
    setPendingImport(null);
  }

  function handleClearAll() {
    try {
      // Wipe EVERYTHING the app stores, not a hardcoded key list — the copy
      // promises "everything stored in this browser" (r169: relay health,
      // live catalogs, intro flags and the stall override used to survive).
      const doomed: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("praison-")) doomed.push(k);
      }
      for (const k of doomed) localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
    location.reload();
  }

  const temperature =
    typeof settings.temperature === "number" ? settings.temperature : 0.7;

  function scrollToSection(id: string) {
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const stats = [
    { label: "Agents", value: agents.length },
    { label: "Conversations", value: conversations.length },
    { label: "Messages", value: messageCount },
    { label: "Workflows", value: workflows.length },
  ];

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Settings"
        description="Providers, local models, behavior, appearance and your local data."
      />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-5 p-4 md:p-6">
          {/* ── Sticky section nav ──────────────────────────────────── */}
          <nav
            aria-label="Settings sections"
            className="sticky top-0 z-20 -mx-4 -mt-1 border-b bg-background/90 px-4 py-2 backdrop-blur md:-mx-6 md:px-6"
          >
            <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {SETTINGS_SECTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => scrollToSection(s.id)}
                  aria-current={activeSection === s.id ? "true" : undefined}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1 text-xs transition-colors",
                    activeSection === s.id
                      ? "border-violet-500/40 bg-violet-500/10 font-medium text-violet-600 dark:text-violet-400"
                      : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </nav>

          {/* ── Usage dashboard ──────────────────────────────────────── */}
          <div id="whats-fixed" className="scroll-mt-14">
            <WhatsFixedSection />
          </div>

          <div id="usage" className="scroll-mt-14">
            <UsageDashboard />
          </div>

          {/* ── Provider: free frontier gallery + advanced custom endpoint ── */}
          <div id="providers" className="scroll-mt-14">
            <ProviderGallery />
          </div>
          <div id="local-models" className="scroll-mt-14">
            <LocalModelsPanel />
          </div>
          <div id="relay" className="scroll-mt-14">
            <ModelRelayCard />
          </div>
          <div id="vault" className="scroll-mt-14">
            <AutomationVaultCard />
          </div>
          <div id="referrals" className="scroll-mt-14">
            <ReferralCard />
          </div>
          <ProviderCard />

          {/* ── Behavior ─────────────────────────────────────────────── */}
          <div id="behavior" className="scroll-mt-14">
          <Card className="gap-4">
            <CardHeader className="pb-3">
              <CardTitle>Agent Behavior</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs">Workflow framework</Label>
                <RadioGroup
                  value={settings.framework}
                  onValueChange={(v) => update({ framework: v as Framework })}
                  className="gap-3"
                >
                  {FRAMEWORK_OPTIONS.map((opt) => {
                    const selected = settings.framework === opt.value;
                    return (
                      <Label
                        key={opt.value}
                        htmlFor={`framework-${opt.value}`}
                        className={cn(
                          "flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal transition-colors",
                          selected
                            ? "border-violet-500/60 bg-violet-500/5"
                            : "hover:border-violet-500/30 hover:bg-muted/50"
                        )}
                      >
                        <RadioGroupItem
                          id={`framework-${opt.value}`}
                          value={opt.value}
                          className="mt-0.5"
                        />
                        <span className="min-w-0 space-y-0.5">
                          <span className="block text-sm font-medium">{opt.title}</span>
                          <span className="block text-xs leading-relaxed text-muted-foreground">
                            {opt.sub}
                          </span>
                        </span>
                      </Label>
                    );
                  })}
                </RadioGroup>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Default temperature</Label>
                  <Badge variant="outline" className="font-mono text-[11px]">
                    {temperature.toFixed(1)}
                  </Badge>
                </div>
                <Slider
                  aria-label="Default temperature"
                  min={0}
                  max={1.5}
                  step={0.1}
                  value={[temperature]}
                  onValueChange={(vals) => update({ temperature: vals[0] ?? 0.7 })}
                />
                <p className="text-xs text-muted-foreground">
                  Used as fallback when an agent doesn&apos;t specify its own.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Read-aloud voice</Label>
                <Select
                  value={settings.voice || DEFAULT_TTS_VOICE}
                  onValueChange={(v) => update({ voice: v })}
                >
                  <SelectTrigger aria-label="Read-aloud voice" className="h-9">
                    <SelectValue placeholder="Voice" />
                  </SelectTrigger>
                  <SelectContent>
                    {TTS_VOICES.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        <span className="font-medium">{v.label}</span>
                        <span className="ml-1.5 text-xs text-muted-foreground">{v.note}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Used by the 🔊 button on assistant replies to read them out loud.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Playback speed</Label>
                <div
                  role="radiogroup"
                  aria-label="Read-aloud playback speed"
                  className="flex flex-wrap gap-1.5"
                >
                  {SPEECH_RATES.map((r) => {
                    const active = (settings.speechRate ?? 1) === r;
                    return (
                      <button
                        key={r}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => update({ speechRate: r })}
                        className={cn(
                          "min-w-11 rounded-lg border px-2 py-1.5 text-xs font-semibold tabular-nums transition-all",
                          active
                            ? "border-violet-500/50 bg-violet-500/15 text-violet-400 shadow-[0_0_0_3px_oklch(0.606_0.25_292.717/0.10)]"
                            : "border-border bg-muted/30 text-muted-foreground hover:border-violet-500/40 hover:text-foreground"
                        )}
                      >
                        {r}×
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  Applies instantly to any reply currently being read aloud.
                </p>
              </div>
            </CardContent>
          </Card>

          </div>

          {/* ── Evolution ─────────────────────────────────────────────── */}
          <div id="evolution" className="scroll-mt-14">
          <Card className="gap-4">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <CardTitle>Evolution</CardTitle>
                <DeepLinkShare anchor="evolution" label="the Evolution proposals panel" />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Novelty stall threshold</Label>
                  <span
                    title="Finished runs scoring novelty below this value propose a variation to the Evolution Inbox"
                    className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-violet-600 dark:text-violet-400"
                  >
                    {settings.noveltySpawnThreshold ?? 35}%
                  </span>
                </div>
                <Slider
                  min={10}
                  max={90}
                  step={5}
                  value={[settings.noveltySpawnThreshold ?? 35]}
                  onValueChange={(vals) =>
                    update({ noveltySpawnThreshold: vals[0] ?? 35 })
                  }
                  aria-label="Novelty stall threshold"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>10% · strict originality</span>
                  <span>35% · default</span>
                  <span>90% · lenient</span>
                </div>
                <div
                  title="Live preview of the current stall rule"
                  className="flex items-start gap-2 rounded-md border border-violet-500/20 bg-violet-500/5 px-2.5 py-1.5 text-[11px] leading-relaxed text-muted-foreground"
                >
                  <span aria-hidden className="shrink-0">🧬</span>
                  <span>
                    Runs scoring below{" "}
                    <span className="font-semibold tabular-nums text-violet-600 dark:text-violet-400">
                      {settings.noveltySpawnThreshold ?? 35}%
                    </span>{" "}
                    novelty will propose variations ·{" "}
                    {(settings.noveltySpawnThreshold ?? 35) === 35
                      ? "default sensitivity"
                      : "customized sensitivity"}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Finished runs scoring novelty below this threshold count as
                  near-duplicates: the runner proposes a variation to the
                  Evolution Inbox and ledger novelty chips turn amber. Lower it
                  to demand more originality; raise it if your pipelines
                  legitimately produce similar output.
                </p>
                <button
                  type="button"
                  onClick={() => update({ noveltySpawnThreshold: 35 })}
                  className="text-[11px] font-medium text-violet-600 underline-offset-2 hover:underline dark:text-violet-400"
                >
                  Reset to default (35%)
                </button>
              </div>
            </CardContent>
          </Card>
          </div>

          {/* ── Profile ──────────────────────────────────────────────── */}
          <div id="profile" className="scroll-mt-14">
          <Card className="gap-4">
            <CardHeader className="pb-3">
              <CardTitle>Profile</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="display-name" className="text-xs">
                  Display name
                </Label>
                <Input
                  id="display-name"
                  value={settings.displayName}
                  onChange={(e) => update({ displayName: e.target.value })}
                  placeholder="You"
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  Shown for your messages in chat.
                </p>
              </div>
            </CardContent>
          </Card>

          </div>

          {/* ── Appearance ───────────────────────────────────────────── */}
          <div id="appearance" className="scroll-mt-14">
          <Card className="gap-4">
            <CardHeader className="pb-3">
              <CardTitle>Accent theme</CardTitle>
              <CardDescription>
                Four hand-tuned dark-line identities — every glow, badge, chart and scrollbar follows.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ThemePicker />
              <div className="flex items-center gap-3">
                <ThemeToggle />
                <p className="text-sm text-muted-foreground">
                  Dark mode recommended for the full PraisonAI vibe.
                </p>
              </div>
            </CardContent>
          </Card>

          </div>

          {/* ── Data ─────────────────────────────────────────────────── */}
          <div id="data" className="scroll-mt-14">
          <Card className="gap-4">
            <CardHeader className="pb-3">
              <CardTitle>Your Data</CardTitle>
              <CardDescription>
                Everything lives in your browser&apos;s localStorage — no accounts, no cloud.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Stats */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {stats.map((s) => (
                  <div key={s.label} className="rounded-lg border p-3 text-center">
                    <div className="text-xl font-bold">{s.value}</div>
                    <div className="text-[11px] text-muted-foreground">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* r415: where the ~5 MB goes — the honest companion to the
                  guarded-storage quota work. Users saw "exceeded the quota"
                  errors with zero visibility into what filled the budget. */}
              <StorageUsage />

              {/* Export / Import */}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={handleExport}>
                  <Download className="h-4 w-4" aria-hidden />
                  Export
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-4 w-4" aria-hidden />
                  Import
                </Button>
                <input
                  ref={fileInputRef}
                  data-testid="full-import-input"
                  type="file"
                  accept=".json,application/json"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden
                  onChange={handleImportFile}
                />
              </div>

              {/* r173: import confirm gate — states both sides of the trade */}
              <AlertDialog
                open={pendingImport !== null}
                onOpenChange={(o) => {
                  if (!o) setPendingImport(null);
                }}
              >
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Replace current data with this import?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This browser currently holds {agents.length}{" "}
                      {agents.length === 1 ? "agent" : "agents"} · {conversations.length}{" "}
                      {conversations.length === 1 ? "chat" : "chats"} ({messageCount}{" "}
                      {messageCount === 1 ? "message" : "messages"}) · {workflows.length}{" "}
                      {workflows.length === 1 ? "workflow" : "workflows"}. The file contains{" "}
                      {pendingImport?.cleanAgents.length ?? 0}{" "}
                      {pendingImport?.cleanAgents.length === 1 ? "agent" : "agents"} ·{" "}
                      {pendingImport?.cleanConversations.length ?? 0} chats ·{" "}
                      {pendingImport?.cleanWorkflows.length ?? 0} workflows
                      {pendingImport && pendingImport.skipped > 0
                        ? ` (${pendingImport.skipped} malformed ${
                            pendingImport.skipped === 1 ? "entry" : "entries"
                          } will be skipped)`
                        : ""}
                      . Importing replaces all of it — nothing is merged or backed up — and
                      settings and relay order come from the file.{" "}
                      {pendingImport &&
                        (pendingImport.fileCreds.any
                          ? pendingImport.fileCreds.all
                            ? "Provider keys also come from the file."
                            : "Credential fields missing from the file keep this browser's values."
                          : "Provider keys in this browser are kept — the export carries none.")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  {pendingImport && !pendingImport.fileCreds.any && (
                    <p
                      role="note"
                      className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400"
                    >
                      <span className="font-medium">No credentials in this export. </span>
                      r193+ exports strip API keys
                      {localHasCredentials
                        ? " — your provider keys here are preserved."
                        : " — and this browser has none configured yet."}{" "}
                      To move keys between browsers, use the provider vault backup (Settings →
                      Providers) — it is the only export that carries keys.
                    </p>
                  )}
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={applyPendingImport}>
                      Replace &amp; reload
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              {/* Danger zone */}
              <div className="rounded-lg border border-destructive/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Danger zone</p>
                    <p className="text-xs text-muted-foreground">
                      Permanently delete everything stored in this browser.
                    </p>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button type="button" variant="destructive" size="sm">
                        <Trash2 className="h-4 w-4" aria-hidden />
                        Clear all data
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Clear all data?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This wipes all agents, chats, workflows and settings from this
                          browser. This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleClearAll}
                          className={buttonVariants({ variant: "destructive" })}
                        >
                          Yes, wipe everything
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </CardContent>
          </Card>

          </div>

          {/* ── About ────────────────────────────────────────────────── */}
          <Card className="gap-4">
            <CardHeader className="pb-3">
              <CardTitle>About</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">PraisonAI Web v{APP_VERSION}</span>
                <Badge variant="secondary" className="text-[10px] font-normal">
                  local-first
                </Badge>
                <Badge variant="secondary" className="text-[10px] font-normal">
                  BYOK
                </Badge>
              </div>
              <BuildInfoLine />
              <div>
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-violet-400 transition-colors hover:text-violet-300 hover:underline"
                >
                  github.com/specimba/PraisonAI
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              </div>
              <p className="text-xs text-muted-foreground">
                A local-first multi-agent platform inspired by the open-source PraisonAI
                project. Not affiliated — rebuilt from scratch as a web app.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
      {/* Guided "free frontier key" wizard — opened from the gallery, header
          picker, command palette or the #/setup · #/guide/<provider> routes. */}
      <SetupWizard />
    </div>
  );
}
