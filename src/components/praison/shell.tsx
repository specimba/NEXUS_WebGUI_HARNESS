"use client";

import * as React from "react";
import {
  Bot,
  ExternalLink,
  MessagesSquare,
  Plus,
  Search,
  Settings2,
  Sheet as SheetIcon,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { BrandMark, ThemeToggle } from "@/components/praison/atoms";
import { useConversationsStore, useSettingsStore, useUiStore } from "@/lib/stores";
import { APP_VERSION, GITHUB_URL } from "@/lib/constants";
import type { View } from "@/lib/types";
import { cn } from "@/lib/utils";

// ─── Nav items ───────────────────────────────────────────────────────────────
const NAV_ITEMS: { view: View; label: string; icon: React.ElementType; hint: string }[] = [
  { view: "chat", label: "Chat", icon: MessagesSquare, hint: "Talk to agents & workflows" },
  { view: "agents", label: "Agents", icon: Bot, hint: "Create & manage AI agents" },
  { view: "workflows", label: "Workflows", icon: WorkflowIcon, hint: "Multi-agent pipelines" },
  { view: "settings", label: "Settings", icon: Settings2, hint: "Provider, profile & data" },
];

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  return (
    <nav aria-label="Primary" className="flex flex-col gap-1 px-3">
      {NAV_ITEMS.map(({ view: v, label, icon: Icon, hint }) => {
        const active = view === v;
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
            {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-violet-400 soft-pulse" />}
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
  settings: { title: "Settings", subtitle: "Configure providers & preferences" },
};

export function TopBar() {
  const view = useUiStore((s) => s.view);
  const setMobileNavOpen = useUiStore((s) => s.setMobileNavOpen);
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const provider = useSettingsStore((s) => s.settings.provider);
  const baseUrl = useSettingsStore((s) => s.settings.baseUrl);
  const meta = VIEW_TITLES[view];
  let host = "groq";
  try {
    host = new URL(baseUrl).hostname.replace("api.", "");
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
            <Badge
              variant="outline"
              className={cn(
                "hidden cursor-default gap-1.5 font-normal sm:flex",
                provider === "auto" ? "border-emerald-500/40 text-emerald-400" : "border-violet-500/40 text-violet-400"
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  provider === "auto" ? "bg-emerald-400" : "bg-violet-400"
                )}
              />
              {provider === "auto" ? "Auto · built-in LLM" : `BYOK · ${host}`}
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {provider === "auto"
              ? "Using the built-in LLM — zero config"
              : `Using your own OpenAI-compatible endpoint (${host})`}
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
