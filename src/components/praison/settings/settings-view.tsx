"use client";

import * as React from "react";
import { Download, ExternalLink, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, ThemeToggle } from "@/components/praison/atoms";
import { ThemePicker } from "@/components/praison/settings/theme-picker";
import { ProviderCard } from "@/components/praison/settings/provider-card";
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
import {
  useAgentsStore,
  useConversationsStore,
  useSettingsStore,
  useWorkflowsStore,
} from "@/lib/stores";
import type { Conversation, Framework } from "@/lib/types";
import { cn } from "@/lib/utils";

const STORAGE_KEYS = [
  "praison-agents",
  "praison-conversations",
  "praison-workflows",
  "praison-settings",
  "praison-ui",
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

  const fileInputRef = React.useRef<HTMLInputElement>(null);

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
      });
      toast.success("Export downloaded");
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
      const conversations = bundle.conversations as Conversation[];
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
              settings: { ...DEFAULT_SETTINGS, ...(bundle.settings ?? {}), seeded: true },
            },
            version: 0,
          })
        );
      } catch {
        toast.error("Import failed — could not write to localStorage.");
        return;
      }
      toast.success("Data imported — reloading…");
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
        description="Provider, behavior, appearance and your local data."
      />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-5 p-4 md:p-6">
          {/* ── Usage dashboard ──────────────────────────────────────── */}
          <UsageDashboard />

          {/* ── Provider ─────────────────────────────────────────────── */}
          <ProviderCard />

          {/* ── Behavior ─────────────────────────────────────────────── */}
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

          {/* ── Profile ──────────────────────────────────────────────── */}
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

          {/* ── Appearance ───────────────────────────────────────────── */}
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

          {/* ── Data ─────────────────────────────────────────────────── */}
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
                  type="file"
                  accept=".json,application/json"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden
                  onChange={handleImportFile}
                />
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
    </div>
  );
}
