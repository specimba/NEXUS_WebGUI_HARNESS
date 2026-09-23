"use client";

import * as React from "react";
import {
  Bot,
  ExternalLink,
  KeyRound,
  MessagesSquare,
  Plus,
  Radar as RadarIcon,
  Search,
  Settings2,
  Sheet as SheetIcon,
  Sparkles,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BrandMark, ThemeToggle } from "@/components/praison/atoms";
import { useConversationsStore, useSettingsStore, useSuitesStore, useUiStore, useWorkflowsStore } from "@/lib/stores";
import { resolveLlm } from "@/lib/llm-config";
import { FREE_PROVIDERS } from "@/lib/providers";
import { APP_VERSION, GITHUB_URL, AIHUBMIX_INTRO_FLAG, VYCE_INTRO_FLAG } from "@/lib/constants";
import { fmtRel } from "@/lib/helpers";
import type { View } from "@/lib/types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── r37: automation pulse (shared helpers) ──────────────────────────────────
// The r32 complaint — "the dashboard shows 0 cron" — must never be a silent
// mystery again. These helpers aggregate every in-app automation layer
// (workflow schedules + scheduled suite bake-offs) into one honest count.

function useAutomationCounts() {
  const workflows = useWorkflowsStore((s) => s.workflows);
  const suites = useSuitesStore((s) => s.suites);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  const armedPipelines = workflows.filter((w) => w.schedule?.enabled === true);
  const armedSuites = suites.filter((s) => s.schedule?.enabled === true && s.cases.length > 0);
  const nextFire = [...armedPipelines.map((w) => w.schedule!.nextRunAt), ...armedSuites.map((s) => s.schedule!.nextRunAt)]
    .filter((t): t is number => typeof t === "number")
    .sort((a, b) => a - b)[0];
  const anyPaused = armedPipelines.some((w) => (w.schedule!.failStreak ?? 0) >= 3);
  return {
    pipelines: armedPipelines.length,
    suites: armedSuites.length,
    total: armedPipelines.length + armedSuites.length,
    nextFire: nextFire != null ? Math.max(0, nextFire - now) : undefined,
    anyPaused,
  };
}

/** Sidebar pulse chip: glanceable automation status between nav and footer. */
function AutomationPulse({ onNavigate }: { onNavigate?: () => void }) {
  const { pipelines, suites, total, nextFire, anyPaused } = useAutomationCounts();
  const setView = useUiStore((s) => s.setView);
  const parts = [
    ...(pipelines > 0 ? [`${pipelines} pipeline${pipelines === 1 ? "" : "s"}`] : []),
    ...(suites > 0 ? [`${suites} bake-off${suites === 1 ? "" : "s"}`] : []),
  ];
  return (
    <button
      type="button"
      onClick={() => {
        setView("workflows");
        onNavigate?.();
      }}
      title={
        total > 0
          ? `${parts.join(" + ")} armed — next fire ${nextFire != null ? fmtRel(Date.now() + nextFire) : "pending"}. Click to open Workflows.`
          : "No in-app automation armed yet. Arm a pipeline schedule from a workflow's Run panel, or a suite bake-off from the Suites board."
      }
      className={cn(
        "group mx-3 mt-3 flex w-[calc(100%-1.5rem)] items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-xs transition-colors",
        total > 0
          ? "border-emerald-500/30 bg-gradient-to-r from-emerald-500/[0.08] to-transparent hover:border-emerald-500/50"
          : "border-dashed border-border/70 text-muted-foreground hover:border-violet-500/40 hover:text-foreground"
      )}
      aria-label={
        total > 0
          ? `Automation armed: ${parts.join(", ")}`
          : "Automation idle — nothing scheduled"
      }
    >
      <span
        aria-hidden
        className={cn(
          "h-2 w-2 shrink-0 rounded-full",
          total > 0 ? (anyPaused ? "bg-amber-400 soft-pulse" : "bg-emerald-400 soft-pulse") : "bg-muted-foreground/30"
        )}
      />
      {total > 0 ? (
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block font-medium text-foreground">{parts.join(" + ")} armed</span>
          <span className="block truncate tabular-nums text-[10px] text-muted-foreground">
            {anyPaused ? "⚠ breaker paused one schedule · " : ""}
            {nextFire != null ? `next ${fmtRel(Date.now() + nextFire)}` : "awaiting next slot"}
          </span>
        </span>
      ) : (
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block font-medium">Automation idle</span>
          <span className="block truncate text-[10px]">arm a schedule to go 24/7</span>
        </span>
      )}
    </button>
  );
}

// ─── Nav items ───────────────────────────────────────────────────────────────
const NAV_ITEMS: { view: View; label: string; icon: React.ElementType; hint: string }[] = [
  { view: "chat", label: "Chat", icon: MessagesSquare, hint: "Talk to agents & workflows" },
  { view: "agents", label: "Agents", icon: Bot, hint: "Create & manage AI agents" },
  { view: "workflows", label: "Workflows", icon: WorkflowIcon, hint: "Multi-agent pipelines" },
  { view: "radar", label: "Radar", icon: RadarIcon, hint: "GitHub stars, HF trending & arXiv papers" },
  { view: "settings", label: "Settings", icon: Settings2, hint: "Provider, profile & data" },
];

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  // r37: an armed-automation count rides the Workflows nav item — the pulse
  // chip tells the story in words, the badge makes it glanceable at all times.
  const armedTotal = useAutomationCounts().total;
  return (
    <nav aria-label="Primary" className="flex flex-col gap-1 px-3">
      {NAV_ITEMS.map(({ view: v, label, icon: Icon, hint }) => {
        const active = view === v;
        const badge = v === "workflows" && armedTotal > 0 ? armedTotal : 0;
        return (
          <button
            key={v}
            type="button"
            onClick={() => {
              setView(v);
              onNavigate?.();
            }}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary/15 text-foreground ring-1 ring-primary/25"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            )}
          >
            {active && (
              <span
                aria-hidden
                className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-gradient-to-b from-violet-400 to-fuchsia-500"
              />
            )}
            <Icon className={cn("h-4 w-4 shrink-0", active ? "text-violet-400" : "")} />
            {label}
            {badge > 0 ? (
              <span
                className="ml-auto rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 text-[10px] font-bold tabular-nums text-emerald-600 dark:text-emerald-400"
                aria-label={`${badge} automations armed`}
              >
                {badge}
              </span>
            ) : null}
            {active && <span className={cn(badge > 0 ? "ml-1.5" : "ml-auto", "h-1.5 w-1.5 rounded-full bg-violet-400 soft-pulse")} />}
            {!active && <span className="sr-only">{hint}</span>}
          </button>
        );
      })}
    </nav>
  );
}

function NewChatButton({ onDone }: { onDone?: () => void }) {
  const create = useConversationsStore((s) => s.create);
  const activeAgentId = useUiStore((s) => s.activeAgentId);
  const setView = useUiStore((s) => s.setView);
  return (
    <Button
      className="mx-3 justify-start gap-2 bg-primary/90 text-white shadow-md shadow-violet-500/20 hover:bg-primary"
      onClick={() => {
        // create() sets activeId — the user lands directly in the fresh chat
        create(activeAgentId ?? undefined);
        setView("chat");
        onDone?.();
      }}
    >
      <Plus className="h-4 w-4" />
      New Chat
    </Button>
  );
}

// ─── Sidebar (desktop) ───────────────────────────────────────────────────────
export function AppSidebar() {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
      <div className="px-4 pb-3 pt-4">
        <BrandMark />
      </div>
      <NewChatButton />
      <div className="mt-3" />
      <NavList />
      <AutomationPulse />
      <div className="mt-auto px-3 pb-4">
        <Separator className="mb-3 opacity-60" />
        <div className="flex items-center justify-between px-1">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            PraisonAI repo
          </a>
          <ThemeToggle />
        </div>
        <div className="mt-2 px-1 text-[10px] text-muted-foreground">
          v{APP_VERSION} · local-first · BYOK
        </div>
      </div>
    </aside>
  );
}

// ─── Mobile nav (Sheet) ──────────────────────────────────────────────────────
export function MobileNav() {
  const open = useUiStore((s) => s.mobileNavOpen);
  const setOpen = useUiStore((s) => s.setMobileNavOpen);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="left" className="w-64 bg-sidebar p-0">
        <SheetHeader className="px-4 pb-3 pt-4">
          <SheetTitle asChild>
            <div>
              <BrandMark />
            </div>
          </SheetTitle>
        </SheetHeader>
        <NewChatButton onDone={() => setOpen(false)} />
        <div className="mt-3" />
        <NavList onNavigate={() => setOpen(false)} />
        <AutomationPulse onNavigate={() => setOpen(false)} />
        <div className="mt-auto px-4 pb-6 pt-4">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            PraisonAI repo
          </a>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Top bar ─────────────────────────────────────────────────────────────────
const VIEW_TITLES: Record<View, { title: string; subtitle: string }> = {
  chat: { title: "Chat", subtitle: "Converse with your agents" },
  agents: { title: "Agents", subtitle: "Build your AI workforce" },
  workflows: { title: "Workflows", subtitle: "Orchestrate agent pipelines" },
  radar: { title: "Trend Radar", subtitle: "GitHub stars · HF trending · arXiv papers" },
  settings: { title: "Settings", subtitle: "Configure providers & preferences" },
};

export function TopBar() {
  const view = useUiStore((s) => s.view);
  const setMobileNavOpen = useUiStore((s) => s.setMobileNavOpen);
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const meta = VIEW_TITLES[view];

  // One-time "Vyce AI is here" intro (r18): pre-seeded key landed in the vault;
  // offer existing users a one-click switch instead of silently changing brains.
  React.useEffect(() => {
    try {
      if (localStorage.getItem(VYCE_INTRO_FLAG)) return;
      localStorage.setItem(VYCE_INTRO_FLAG, "1");
      const s = useSettingsStore.getState().settings;
      if (s.provider === "custom" && s.activeProviderId === "vyce") return;
      toast("Vyce AI added — $10/day free credits", {
        description: "DeepSeek V4.1 is pre-loaded with your key and ready to chat.",
        action: {
          label: "Use Vyce",
          onClick: () => useSettingsStore.getState().update({ provider: "custom", activeProviderId: "vyce" }),
        },
        duration: 15_000,
      });
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  // One-time "AIHubMix is here" intro (r30): 45 free lanes + frontier; the
  // key is preseeded but the active brain is NOT switched (unlike Vyce r18).
  React.useEffect(() => {
    try {
      if (localStorage.getItem(AIHUBMIX_INTRO_FLAG)) return;
      localStorage.setItem(AIHUBMIX_INTRO_FLAG, "1");
      const s = useSettingsStore.getState().settings;
      if (s.providerKeys?.aihubmix?.key) {
        toast("AIHubMix added — 45 free model lanes", {
          description: "coding-glm-5.3-free (1M ctx, tools) is pre-loaded in the vault — pick it from any model picker.",
          duration: 15_000,
        });
      }
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  // r31 landmine fix companion: the debounced storage layer now DISPATCHES
  // praison:storage-quota instead of silently swallowing quota errors — the
  // user hears about it once per session, with an actionable hint.
  React.useEffect(() => {
    let shown = false;
    const onQuota = () => {
      if (shown) return;
      shown = true;
      toast.warning("Browser storage is full", {
        icon: "\u{1F4BE}",
        description:
          "Old chats keep their text but heavy attachments were dropped to keep saving. Delete old conversations in Chat to free space.",
      });
    };
    window.addEventListener("praison:storage-quota", onQuota);
    return () => window.removeEventListener("praison:storage-quota", onQuota);
  }, []);

  // Resolve the active provider for the badge + quick-switch dropdown.
  const resolved = React.useMemo(() => resolveLlm(settings), [settings]);
  const registryReady = React.useMemo(
    () =>
      FREE_PROVIDERS.map((p) => ({
        p,
        ready: p.noKey || !!settings.providerKeys?.[p.id]?.key?.trim(),
      })),
    [settings.providerKeys]
  );
  let legacyHost = "custom";
  try {
    legacyHost = new URL(settings.baseUrl).hostname.replace("api.", "");
  } catch {
    /* keep default */
  }
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background/60 px-3 backdrop-blur-md md:px-5">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        aria-label="Open navigation"
        onClick={() => setMobileNavOpen(true)}
      >
        <SheetIcon className="h-5 w-5" />
      </Button>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold leading-tight">{meta.title}</h2>
        <p className="truncate text-xs text-muted-foreground">{meta.subtitle}</p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setPaletteOpen(true)}
        aria-label="Open command palette"
        className="h-8 gap-2 rounded-full border-border/70 text-muted-foreground shadow-sm hover:text-foreground"
      >
        <Search className="h-3.5 w-3.5" aria-hidden />
        <span className="hidden sm:inline">Search…</span>
        <kbd className="pointer-events-none hidden rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-block">
          ⌘K
        </kbd>
      </Button>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Badge
                  variant="outline"
                  className={cn(
                    "hidden cursor-pointer gap-1.5 font-normal transition-colors hover:bg-muted/60 sm:flex",
                    resolved.providerId === "auto"
                      ? "border-emerald-500/40 text-emerald-400"
                      : "border-violet-500/40 text-violet-400"
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      resolved.providerId === "auto" ? "bg-emerald-400" : "bg-violet-400"
                    )}
                  />
                  {resolved.label}
                </Badge>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="text-[11px] text-muted-foreground">
                  LLM provider — switch instantly
                </DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => update({ provider: "auto", activeProviderId: undefined })}
                  className={cn(resolved.providerId === "auto" && "bg-accent")}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
                  <span className="flex-1">Auto · built-in GLM</span>
                  {resolved.providerId === "auto" && <span className="text-xs">✓</span>}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10px] tracking-wide text-muted-foreground uppercase">
                  Free frontier providers
                </DropdownMenuLabel>
                {registryReady.map(({ p, ready }) => {
                  const active = resolved.providerId === p.id;
                  return (
                    <DropdownMenuItem
                      key={p.id}
                      onClick={() =>
                        ready
                          ? update({ provider: "custom", activeProviderId: p.id })
                          : setPaletteOpen(false)
                      }
                      className={cn(active && "bg-accent")}
                      {...(ready
                        ? {}
                        : { title: `Add your ${p.name} key in Settings → Free frontier providers` })}
                    >
                      <span aria-hidden className="w-4 text-center text-sm">
                        {p.glyph}
                      </span>
                      <span className={cn("flex-1 truncate", !ready && "text-muted-foreground")}>
                        {p.name}
                        {!ready && <span className="ml-1 text-[10px]">no key</span>}
                      </span>
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          ready ? "bg-emerald-400" : "bg-muted-foreground/30"
                        )}
                        aria-hidden
                      />
                      {active && <span className="text-xs">✓</span>}
                    </DropdownMenuItem>
                  );
                })}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => update({ provider: "custom", activeProviderId: "custom" })}
                  className={cn(resolved.providerId === "custom" && "bg-accent")}
                >
                  <KeyRound className="h-3.5 w-3.5" aria-hidden />
                  <span className="flex-1 truncate">Custom endpoint · {legacyHost}</span>
                  {resolved.providerId === "custom" && <span className="text-xs">✓</span>}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    history.replaceState(null, "", "#/setup");
                    useUiStore.getState().openSetupWizard();
                  }}
                  className="text-violet-400"
                >
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />
                  <span className="flex-1">Get a free frontier key — guided setup</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Click to switch LLM provider — resolved: {resolved.label}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <ThemeToggle />
    </header>
  );
}

// ─── Splash (pre-hydration, accent-themed art backdrop) ─────────────────────
export function Splash() {
  return (
    <div className="relative flex h-dvh flex-col items-center justify-center gap-4 overflow-hidden bg-background">
      <div className="theme-art opacity-70" aria-hidden />
      <div className="theme-art-veil" aria-hidden />
      <div className="soft-pulse relative z-10">
        <BrandMark />
      </div>
      <p className="shimmer-text relative z-10 text-sm font-medium">spinning up your agents…</p>
    </div>
  );
}
