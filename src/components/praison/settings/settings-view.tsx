"use client";

import * as React from "react";
import { Download, ExternalLink, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, ThemeToggle } from "@/components/praison/atoms";
import { ThemePicker } from "@/components/praison/settings/theme-picker";
import { LocalModelsPanel } from "@/components/praison/settings/local-models";
import { ModelRelayCard } from "@/components/praison/settings/model-relay";
import { ProviderCard } from "@/components/praison/settings/provider-card";
import { ProviderGallery } from "@/components/praison/settings/provider-gallery";
import { ReferralCard } from "@/components/praison/settings/referral-card";
import { SetupWizard } from "@/components/praison/settings/setup-wizard";
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
import { Switch } from "@/components/ui/switch";
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
import { downloadJson, fmtIntervalShort, fmtRel } from "@/lib/helpers";
import {
  useAgentsStore,
  useConversationsStore,
  useSettingsStore,
  useSuitesStore,
  useUiStore,
  useWorkflowsStore,
} from "@/lib/stores";
import type { Conversation, Framework } from "@/lib/types";
import {
  describeMergeResult,
  looksLikeFullExport,
  looksLikeProviderVault,
  mergeProviderKeys,
} from "@/lib/vault-merge";
import { HARNESS_PRESETS, harnessById } from "@/lib/harness";
import { SkillsCard } from "@/components/praison/settings/skills-card";
import { McpCard } from "@/components/praison/settings/mcp-card";
import { ToolKeysCard } from "@/components/praison/settings/tool-keys-card";
import { cn } from "@/lib/utils";

const STORAGE_KEYS = [
  "praison-agents",
  "praison-conversations",
  "praison-workflows",
  "praison-settings",
  "praison-suites",
  "praison-ui",
] as const;

/** Sticky section-nav — ids must match the wrapper elements below. */
const SETTINGS_SECTIONS = [
  { id: "usage", label: "Usage" },
  { id: "providers", label: "Providers" },
  { id: "local-models", label: "Local models" },
  { id: "relay", label: "Model Relay" },
  { id: "referrals", label: "Referrals" },
  { id: "harness", label: "Harness" },
  { id: "skills", label: "Skills" },
  { id: "mcp", label: "MCP" },
  { id: "tools", label: "Tools" },
  { id: "behavior", label: "Behavior" },
  { id: "automation", label: "Automation" },
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

export function SettingsView() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const agents = useAgentsStore((s) => s.agents);
  const conversations = useConversationsStore((s) => s.conversations);
  const workflows = useWorkflowsStore((s) => s.workflows);
  const suites = useSuitesStore((s) => s.suites);

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

  function handleExport() {
    try {
      downloadJson("praisonai-export.json", {
        exportedAt: new Date().toISOString(),
        settings,
        agents,
        conversations,
        workflows,
        suites, // r37: task suites are user-curated (cases, A/B rotations, schedules) — they ride along
      });
      toast.success("Export downloaded");
    } catch {
      toast.error("Export failed — could not serialize your data.");
    }
  }

  /**
   * r41-c: export JUST the provider vault lives in the provider gallery's
   * "Vault" button (same handler shape, provider-centric home). The Data card
   * keeps the kind-aware IMPORT + audit trail; vault-merge.ts is the shared
   * doctrine both doors use.
   */

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

      // ── r41-c branch 1: a provider VAULT (advisory-pack shape) ──────────
      // Lives-merges keys into the running store — fill-empty semantics,
      // never overwrites a locally-set key (BYOK paranoia), no reload.
      if (looksLikeProviderVault(parsed)) {
        const vault = parsed as {
          providerKeys?: unknown;
          activeProviderId?: unknown;
          defaultModel?: unknown;
        };
        const result = mergeProviderKeys(settings.providerKeys, vault.providerKeys);
        const patch: Record<string, unknown> = {
          providerKeys: result.merged,
          vaultImportedAt: new Date().toISOString(),
        };
        // Adopt the vault's active-provider hints ONLY when this profile has
        // none — a vault import must never silently re-point an armed profile.
        const localActive = (settings.activeProviderId ?? "").trim();
        if (!localActive && typeof vault.activeProviderId === "string" && vault.activeProviderId.trim()) {
          patch.activeProviderId = vault.activeProviderId.trim();
          if (typeof vault.defaultModel === "string" && vault.defaultModel.trim()) {
            patch.defaultModel = vault.defaultModel.trim();
          }
        }
        update(patch);
        const desc = describeMergeResult(result);
        if (result.conflicts.length > 0) {
          toast.warning("Vault merged with conflicts", { description: desc });
        } else {
          toast.success("Vault imported — keys armed", { description: desc });
        }
        return;
      }

      // ── branch 2: a FULL app export (agents/conversations/workflows) ────
      const bundle = (parsed ?? {}) as Record<string, unknown>;
      const valid = looksLikeFullExport(bundle);
      if (!valid) {
        toast.error("Invalid import file", {
          description:
            "Expected a PraisonAI export (agents, conversations, workflows) or a provider vault (kind: praison-provider-vault).",
        });
        return;
      }
      const conversations = bundle.conversations as Conversation[];
      // r41-c: providerKeys now MERGE per-key (fill-empty) instead of the old
      // shallow spread that wholesale-overwrote the local vault.
      const bundleSettings = (bundle.settings ?? {}) as Record<string, unknown>;
      const keyMerge = mergeProviderKeys(settings.providerKeys, bundleSettings.providerKeys);
      try {
        localStorage.setItem(
          "praison-agents",
          JSON.stringify({ state: { agents: bundle.agents }, version: 0 })
        );
        localStorage.setItem(
          "praison-conversations",
          JSON.stringify({
            state: { conversations, activeId: conversations[0]?.id ?? null },
            version: 0,
          })
        );
        localStorage.setItem(
          "praison-workflows",
          JSON.stringify({ state: { workflows: bundle.workflows }, version: 0 })
        );
        localStorage.setItem(
          "praison-settings",
          JSON.stringify({
            state: {
              settings: {
                ...DEFAULT_SETTINGS,
                ...bundleSettings,
                seeded: true,
                providerKeys: keyMerge.merged,
              },
            },
            version: 0,
          })
        );
        // r37: suites restore when present (older exports simply lack the key).
        if (Array.isArray(bundle.suites)) {
          localStorage.setItem(
            "praison-suites",
            JSON.stringify({ state: { suites: bundle.suites }, version: 0 })
          );
        }
      } catch {
        toast.error("Import failed — could not write to localStorage.");
        return;
      }
      const desc = describeMergeResult(keyMerge);
      toast.success(`Data imported — reloading… (${desc})`);
      location.reload();
    };
    reader.onerror = () => toast.error("Import failed — could not read the selected file.");
    reader.readAsText(file);
  }

  function handleClearAll() {
    try {
      for (const key of STORAGE_KEYS) localStorage.removeItem(key);
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
          <div id="referrals" className="scroll-mt-14">
            <ReferralCard />
          </div>
          <ProviderCard />

          {/* ── Harness selection (r34) ───────────────────────────────── */}
          <div id="harness" className="scroll-mt-14">
            <Card className="gap-4">
              <CardHeader className="pb-3">
                <CardTitle>Harness</CardTitle>
                <CardDescription>
                  One pick retunes the whole agentic stack — relay ordering, tool budget,
                  stall resilience, lessons and dreams — for chat turns AND pipeline runs
                  alike. Pipelines can override this per-workflow in their editor.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  role="radiogroup"
                  aria-label="Active harness"
                  className="grid gap-2 md:grid-cols-2"
                >
                  {HARNESS_PRESETS.map((p) => {
                    const selected = harnessById(settings.activeHarness).id === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => update({ activeHarness: p.id })}
                        className={cn(
                          "rounded-lg border p-3 text-left transition-all",
                          selected
                            ? "border-violet-500/60 bg-violet-500/10 ring-1 ring-violet-500/30"
                            : "border-border/70 hover:bg-muted/60"
                        )}
                      >
                        <span className="flex items-center gap-2 text-sm font-semibold">
                          <span aria-hidden className="text-base">{p.glyph}</span>
                          {p.name}
                          {selected && (
                            <Badge variant="secondary" className="ml-auto text-[9px] uppercase">
                              active
                            </Badge>
                          )}
                        </span>
                        <span className="mt-0.5 block text-[11px] font-medium text-violet-600 dark:text-violet-400">
                          {p.tagline}
                        </span>
                        <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
                          {p.description}
                        </span>
                        <span className="mt-2 flex flex-wrap gap-1">
                          {p.chips.map((chip) => (
                            <Badge
                              key={chip}
                              variant="outline"
                              className="px-1.5 py-0 text-[9px] font-normal text-muted-foreground"
                            >
                              {chip}
                            </Badge>
                          ))}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ── Skills gallery (r36, PraisonAI SKILL.md doctrine) ────── */}
          <div id="skills" className="scroll-mt-14">
            <SkillsCard />
          </div>

          {/* ── MCP servers (r38, stateless-first client) ────────────── */}
          <div id="mcp" className="scroll-mt-14">
            <McpCard />
          </div>

          {/* ── Tool keys (r41, BYOK keys for built-in tools) ─────────── */}
          <div id="tools" className="scroll-mt-14">
            <ToolKeysCard />
          </div>

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

              {/* r49: break reminders are OPT-IN — default OFF (the nag was removed). */}
              <div className="flex items-start justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 p-3">
                <div className="min-w-0">
                  <Label className="text-xs" htmlFor="break-nag-toggle">
                    Break reminders
                  </Label>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    Opt-in gentle nudge after long stretches of agent activity. Off by
                    default — you decide when to rest; the platform never interrupts
                    based on session length.
                  </p>
                </div>
                <Switch
                  id="break-nag-toggle"
                  aria-label="Toggle break reminders"
                  checked={settings.breakNag === true}
                  onCheckedChange={(v) => update({ breakNag: v })}
                  className="mt-0.5 shrink-0"
                />
              </div>
            </CardContent>
          </Card>

          </div>

          {/* ── Automation (r34): make every automation layer VISIBLE ── */}
          <div id="automation" className="scroll-mt-14">
            <Card className="gap-4">
              <CardHeader className="pb-3">
                <CardTitle>Automation</CardTitle>
                <CardDescription>
                  Everything that runs on its own — in-app schedules and the platform
                  heartbeat — in one honest view.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* In-app schedules (tab-open runners) */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Scheduled pipelines (run while the app is open)
                  </p>
                  {(() => {
                    const scheduled = workflows.filter((w) => w.schedule?.enabled);
                    if (scheduled.length === 0) {
                      return (
                        <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
                          No pipelines on a schedule. Open a workflow's Run panel → Scheduler
                          to arm one (30 min · hourly · 6 h · 12 h · daily).
                        </p>
                      );
                    }
                    return (
                      <ul className="space-y-1.5">
                        {scheduled.map((w) => {
                          const s = w.schedule!;
                          const paused = (s.failStreak ?? 0) >= 3;
                          return (
                            <li
                              key={w.id}
                              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs"
                            >
                              <span
                                aria-hidden
                                className={cn(
                                  "h-1.5 w-1.5 shrink-0 rounded-full",
                                  paused ? "bg-amber-400" : "bg-emerald-400 soft-pulse"
                                )}
                              />
                              <span className="min-w-0 flex-1 truncate font-medium">{w.name}</span>
                              <span className="shrink-0 text-muted-foreground">
                                {paused
                                  ? "paused by failure breaker"
                                  : s.nextRunAt
                                    ? `next run ${fmtRel(s.nextRunAt)}`
                                    : "awaiting next slot"}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    );
                  })()}
                </div>
                {/* r37: scheduled suite bake-offs (the A/B lab on a cadence) */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Scheduled bake-offs (suites, run while the app is open)
                  </p>
                  {(() => {
                    const armed = suites.filter((s) => s.schedule?.enabled === true && s.cases.length > 0);
                    if (armed.length === 0) {
                      return (
                        <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
                          No suites on a schedule. Open Workflows → Suites and arm a bake-off
                          cadence (30 min · hourly · 6 h · 12 h · daily) to keep fresh A/B verdicts.
                        </p>
                      );
                    }
                    return (
                      <ul className="space-y-1.5">
                        {armed.map((s) => {
                          const sched = s.schedule!;
                          return (
                            <li
                              key={s.id}
                              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs"
                            >
                              <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 soft-pulse" />
                              <span className="min-w-0 flex-1 truncate font-medium">🔬 {s.name}</span>
                              <span className="shrink-0 text-muted-foreground">
                                every {fmtIntervalShort(sched.intervalMs)} · {sched.repeats} repeat{sched.repeats === 1 ? "" : "s"}
                                {sched.nextRunAt ? ` · next ${fmtRel(sched.nextRunAt)}` : ""}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    );
                  })()}
                </div>
                {/* Platform heartbeat (external cron) */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Platform heartbeat (external cron)
                  </p>
                  <div className="rounded-lg border px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                    <p>
                      A <span className="font-medium text-foreground">web dev review</span> agent
                      loop runs <span className="font-medium text-foreground">hourly at :21</span>{" "}
                      (staggered off the busy :00/:15/:30/:45 tops) with the full review prompt:
                      worklog → browser QA → fixes or features → handover update.
                    </p>
                    <p className="mt-1.5">
                      Finding from r34: the platform exec-limits the{" "}
                      <span className="font-medium text-foreground">webDevReview job class</span>{" "}
                      itself after the cumulative 15-min runs of earlier rounds — any new
                      webDevReview cron is born disabled (“exec limits exceeded”), while an
                      agentTurn loop carrying the identical instructions stays enabled. Platform
                      cron jobs are also <span className="font-medium text-foreground">session-scoped</span>:
                      after a sandbox gap, <span className="font-medium text-foreground">cron list first, then recreate staggered</span>.
                    </p>
                  </div>
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

              {/* Export / Import — r41-c: kind-aware import + vault audit */}
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
                  type="file"
                  accept=".json,application/json"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden
                  onChange={handleImportFile}
                />
              </div>
              <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.04] px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                <p>
                  <span className="font-medium text-foreground">Import accepts two shapes</span> —
                  a full app export (agents, chats, workflows, suites) or a{" "}
                  <span className="font-medium text-violet-300">provider vault</span> file (
                  <code className="rounded bg-muted px-1 py-0.5 text-[10px]">
                    kind: praison-provider-vault
                  </code>
                  ). Vault keys merge with fill-empty semantics: empty local slots are armed, keys
                  you already set are <span className="font-medium text-foreground">never overwritten</span>{" "}
                  — differing keys stay local and get reported, so no surprise re-points.
                </p>
                {settings.vaultImportedAt ? (
                  <p className="mt-1.5 flex items-center gap-1.5">
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full bg-violet-400 shadow-[0_0_6px_rgba(167,139,250,0.8)]"
                      aria-hidden
                    />
                    Vault last imported {fmtRel(new Date(settings.vaultImportedAt).getTime())}
                  </p>
                ) : null}
              </div>

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
