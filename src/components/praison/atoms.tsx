"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  BadgeCheck,
  Bot,
  Microscope,
  Moon,
  Sun,
  Zap,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Agent, AgentColor, PipelineDepth, ToolId } from "@/lib/types";
import { TOOL_META } from "@/lib/constants";
import { cn } from "@/lib/utils";

// ─── Agent avatar ────────────────────────────────────────────────────────────
const COLOR_GRADIENTS: Record<AgentColor, string> = {
  violet: "from-violet-500 to-purple-600 shadow-violet-500/25",
  emerald: "from-emerald-500 to-teal-600 shadow-emerald-500/25",
  amber: "from-amber-500 to-orange-600 shadow-amber-500/25",
  rose: "from-rose-500 to-pink-600 shadow-rose-500/25",
  cyan: "from-cyan-500 to-sky-600 shadow-cyan-500/25",
  fuchsia: "from-fuchsia-500 to-pink-600 shadow-fuchsia-500/25",
};

export function AgentAvatar({
  agent,
  size = "md",
  className,
}: {
  agent?: Pick<Agent, "emoji" | "color" | "name"> | null;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const sizes = {
    xs: "h-6 w-6 text-[11px] rounded-md",
    sm: "h-8 w-8 text-sm rounded-lg",
    md: "h-10 w-10 text-lg rounded-xl",
    lg: "h-14 w-14 text-2xl rounded-2xl",
  } as const;
  return (
    <div
      aria-hidden
      title={agent?.name}
      className={cn(
        "flex shrink-0 items-center justify-center bg-gradient-to-br text-white shadow-md ring-1 ring-white/10",
        COLOR_GRADIENTS[agent?.color ?? "violet"],
        sizes[size],
        className
      )}
    >
      <span className="leading-none">{agent?.emoji ?? <Bot className="h-1/2 w-1/2" />}</span>
    </div>
  );
}

// ─── Badges ──────────────────────────────────────────────────────────────────
export function ToolBadge({ tool, className }: { tool: ToolId; className?: string }) {
  const meta = TOOL_META[tool];
  if (!meta) return null;
  return (
    <Badge variant="secondary" className={cn("gap-1 font-normal", className)}>
      <span aria-hidden>{meta.emoji}</span>
      {meta.label}
    </Badge>
  );
}

export function ModelBadge({ model, className }: { model: string; className?: string }) {
  const isAuto = !model || model === "auto";
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 font-mono text-[10px] font-normal",
        isAuto ? "border-violet-500/40 text-violet-400" : "text-muted-foreground",
        className
      )}
    >
      <Zap className="h-3 w-3" />
      {isAuto ? "auto" : model}
    </Badge>
  );
}

// ─── Pipeline depth chip (r26) ──────────────────────────────────────────────
const DEPTH_META: Record<PipelineDepth, { label: string; icon: React.ElementType; hint: string }> = {
  quick: { label: "Quick", icon: Zap, hint: "Runs exactly as authored — no extra passes" },
  standard: { label: "Standard", icon: BadgeCheck, hint: "Adds a verification pass at the end" },
  deep: { label: "Deep", icon: Microscope, hint: "2 extra deep-research passes + verification" },
};

/** Muted chip showing a workflow's pipeline depth (missing = Standard). */
export function DepthChip({
  depth,
  className,
}: {
  depth?: PipelineDepth;
  className?: string;
}) {
  const meta = DEPTH_META[depth ?? "standard"];
  const Icon = meta.icon;
  return (
    <span
      title={`Pipeline depth: ${meta.label} — ${meta.hint}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground",
        className
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {meta.label}
    </span>
  );
}

// ─── Page header ─────────────────────────────────────────────────────────────
export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="relative flex flex-wrap items-end justify-between gap-3 border-b px-4 py-4 md:px-6">
      <div className="min-w-0">
        <h1 className="bg-gradient-to-r from-foreground via-foreground to-violet-400/80 bg-clip-text truncate text-lg font-semibold tracking-tight text-transparent md:text-xl">
          {title}
        </h1>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children ? <div className="flex items-center gap-2">{children}</div> : null}
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-violet-500/40 to-transparent"
      />
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────
export function EmptyState({
  emoji,
  title,
  description,
  action,
}: {
  emoji: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted text-3xl shadow-inner ring-1 ring-border/50">
        <span aria-hidden className="soft-pulse">{emoji}</span>
      </div>
      <div>
        <h3 className="font-semibold">{title}</h3>
        {description ? (
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </motion.div>
  );
}

// ─── Theme toggle ────────────────────────────────────────────────────────────
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      {mounted && resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}

// ─── Brand logo ──────────────────────────────────────────────────────────────
export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-lg shadow-violet-500/30">
        <Bot className="h-5 w-5 text-white" />
        <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-emerald-400" />
      </div>
      {!compact && (
        <div className="leading-tight">
          <div className="text-[15px] font-bold tracking-tight">
            Praison<span className="text-violet-400">AI</span>
          </div>
          <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Multi-Agent Platform
          </div>
        </div>
      )}
    </div>
  );
}
