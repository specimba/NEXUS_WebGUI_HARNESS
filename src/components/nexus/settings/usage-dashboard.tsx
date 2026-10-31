"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Activity, Clock, Wrench, Flame } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AgentAvatar } from "@/components/nexus/atoms";
import { TOOL_META } from "@/lib/constants";
import { fmtMs, localDayKey } from "@/lib/helpers";
import { useAgentsStore, useConversationsStore } from "@/lib/stores";
import type { AgentColor, Conversation, ToolId } from "@/lib/types";
import { cn } from "@/lib/utils";

// ─── Usage dashboard — all stats computed locally from chat history ─────────

interface UsageStats {
  totalMessages: number;
  weekMessages: number;
  avgMs: number | null;
  toolCounts: { id: ToolId; label: string; emoji: string; count: number }[];
  totalToolRuns: number;
  perDay: { label: string; count: number; isToday: boolean }[];
  topAgents: { id: string; name: string; emoji: string; color: AgentColor; count: number }[];
  streak: number;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function computeUsage(conversations: Conversation[]): UsageStats {
  const msgs = conversations.flatMap((c) => c.messages);

  const now = new Date();

  // Last 7 days buckets (oldest → today), keyed by TRUE local calendar
  // midnights. r297 completes r267: `startOfToday - i * DAY_MS` drifts across
  // DST transitions (23/25-hour days shift every boundary by an hour), so
  // late-evening and early-morning messages could land in the wrong bucket —
  // the same defect class r267 fixed for the streak. Bucket boundaries are
  // now each day's actual local midnight, and the claim in r267's comment
  // that this chart "already buckets by local days" is finally true in
  // every zone, not just non-DST ones.
  const perDay: { label: string; count: number; isToday: boolean }[] = [];
  const dayStarts: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    dayStarts.push(d.getTime());
    perDay.push({
      label: i === 0 ? "Today" : DAY_LABELS[d.getDay()],
      count: 0,
      isToday: i === 0,
    });
  }
  for (const m of msgs) {
    const idx = dayStarts.findIndex(
      (s, i) => m.createdAt >= s && (i === 6 || m.createdAt < dayStarts[i + 1])
    );
    if (idx !== -1) perDay[idx].count++;
  }
  const weekMessages = perDay.reduce((n, d) => n + d.count, 0);

  // Avg assistant response time
  const durations = msgs.filter((m) => m.role === "assistant" && typeof m.durationMs === "number");
  const avgMs =
    durations.length > 0
      ? durations.reduce((n, m) => n + (m.durationMs ?? 0), 0) / durations.length
      : null;

  // Tool-call mix
  const counts = new Map<ToolId, number>();
  for (const m of msgs) {
    for (const tc of m.toolCalls ?? []) {
      const id = tc.name as ToolId;
      if (TOOL_META[id]) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const toolCounts = (Object.keys(TOOL_META) as ToolId[])
    .map((id) => ({
      id,
      label: TOOL_META[id].label,
      emoji: TOOL_META[id].emoji,
      count: counts.get(id) ?? 0,
    }))
    .sort((a, b) => b.count - a.count);
  const totalToolRuns = toolCounts.reduce((n, t) => n + t.count, 0);

  // Activity streak (consecutive days ending today or yesterday with ≥1 message).
  // r267: keyed by LOCAL calendar day via localDayKey — the raw UTC day index
  // silently shifted the streak by the zone offset (a daily 02:30-local chatter
  // in UTC+3 straddled UTC midnight and showed a broken streak) and disagreed
  // with the perDay chart above, which already buckets by local days.
  const daysWithMsgs = new Set<number>();
  for (const m of msgs) daysWithMsgs.add(localDayKey(m.createdAt));
  let streak = 0;
  let cursor = localDayKey(Date.now());
  if (!daysWithMsgs.has(cursor)) cursor -= 1; // streak survives if yesterday had activity
  while (daysWithMsgs.has(cursor)) {
    streak++;
    cursor -= 1;
  }

  // (Top agents are resolved against the live roster in the component)

  return {
    totalMessages: msgs.length,
    weekMessages,
    avgMs,
    toolCounts,
    totalToolRuns,
    perDay,
    topAgents: [],
    streak,
  };
}

export function UsageDashboard() {
  const conversations = useConversationsStore((s) => s.conversations);
  const agents = useAgentsStore((s) => s.agents);

  const stats = React.useMemo(() => {
    const base = computeUsage(conversations);
    // Top agents resolved against the live roster
    const byAgent = new Map<string, number>();
    for (const c of conversations) {
      for (const m of c.messages) {
        if (m.role === "assistant" && m.agentId) {
          byAgent.set(m.agentId, (byAgent.get(m.agentId) ?? 0) + 1);
        }
      }
    }
    base.topAgents = [...byAgent.entries()]
      .map(([id, count]) => {
        const a = agents.find((x) => x.id === id);
        return a
          ? { id, name: a.name, emoji: a.emoji, color: a.color, count }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    return base;
  }, [conversations, agents]);

  const maxDay = Math.max(1, ...stats.perDay.map((d) => d.count));
  const maxTool = Math.max(1, ...stats.toolCounts.map((t) => t.count));
  const maxAgent = Math.max(1, ...stats.topAgents.map((a) => a.count));
  // r297: zero-count tool rows are suppressed — a wall of unused tools is
  // noise — and the suppression is stated OUT LOUD below the mix instead of
  // being silent (same honesty doctrine as the signals-cap line, r273/r283).
  const usedTools = stats.toolCounts.filter((t) => t.count > 0);
  const unusedToolCount = stats.toolCounts.length - usedTools.length;

  const tiles = [
    {
      label: "Messages · 7d",
      value: String(stats.weekMessages),
      icon: Activity,
      tint: "text-violet-400",
    },
    {
      label: "Avg response",
      value: stats.avgMs != null ? fmtMs(stats.avgMs) : "—",
      icon: Clock,
      tint: "text-emerald-400",
    },
    {
      label: "Tool runs",
      value: String(stats.totalToolRuns),
      icon: Wrench,
      tint: "text-amber-400",
    },
    {
      label: "Day streak",
      value: stats.streak > 0 ? `${stats.streak}🔥` : "—",
      icon: Flame,
      tint: "text-rose-400",
    },
  ];

  return (
    <Card className="gap-4">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          Usage
          <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-400">
            local
          </span>
        </CardTitle>
        <CardDescription>
          Computed on the fly from your chat history — never leaves this browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {stats.totalMessages === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
            No activity yet — chat with an agent and your stats will light up here.
          </p>
        ) : (
          <>
            {/* Stat tiles */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {tiles.map((t) => (
                <div
                  key={t.label}
                  className="rounded-lg border bg-muted/30 p-3 transition-colors hover:border-violet-500/30"
                >
                  <t.icon className={cn("mb-1.5 h-3.5 w-3.5", t.tint)} aria-hidden />
                  <div className="text-lg font-bold tabular-nums leading-tight">{t.value}</div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t.label}
                  </div>
                </div>
              ))}
            </div>

            {/* 7-day activity chart */}
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Last 7 days
              </div>
              <div className="flex h-24 items-end gap-2" role="img" aria-label="Messages per day, last 7 days">
                {stats.perDay.map((d, i) => (
                  <div key={d.label + i} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                    <span
                      className={cn(
                        "text-[10px] font-semibold tabular-nums",
                        d.count === 0 ? "text-muted-foreground/40" : "text-violet-400"
                      )}
                    >
                      {d.count}
                    </span>
                    <div className="flex w-full flex-1 items-end">
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${Math.max(4, (d.count / maxDay) * 100)}%` }}
                        transition={{ duration: 0.4, delay: i * 0.05, ease: "easeOut" }}
                        title={`${d.count} message${d.count === 1 ? "" : "s"} · ${d.label}`}
                        className={cn(
                          "w-full rounded-t-md transition-colors",
                          d.count === 0
                            ? "bg-muted"
                            : d.isToday
                              ? "bg-gradient-to-t from-violet-600 to-fuchsia-400 shadow-md shadow-violet-500/25"
                              : "bg-gradient-to-t from-violet-600/70 to-violet-400/70 hover:from-violet-600 hover:to-violet-400"
                        )}
                      />
                    </div>
                    <span
                      className={cn(
                        "text-[10px]",
                        d.isToday ? "font-semibold text-violet-400" : "text-muted-foreground"
                      )}
                    >
                      {d.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              {/* Tool mix */}
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Tool mix
                </div>
                {usedTools.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No tool runs yet.</p>
                ) : (
                  <div className="space-y-2" role="list" aria-label="Tool mix — runs per tool">
                    {usedTools.map((t) => (
                      <div
                        key={t.id}
                        role="listitem"
                        aria-label={`${t.label} — ${t.count} run${t.count === 1 ? "" : "s"}`}
                        className="flex items-center gap-2 rounded px-1 transition-colors hover:bg-muted/30"
                      >
                        <span className="w-24 shrink-0 truncate text-xs" aria-hidden>
                          {t.emoji} {t.label}
                        </span>
                        <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${(t.count / maxTool) * 100}%` }}
                            transition={{ duration: 0.5, ease: "easeOut" }}
                            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400"
                          />
                        </div>
                        <span className="w-6 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground" aria-hidden>
                          {t.count}
                        </span>
                      </div>
                    ))}
                    {unusedToolCount > 0 ? (
                      <p className="text-[10px] text-muted-foreground">
                        {unusedToolCount} of {stats.toolCounts.length} tool types unused.
                      </p>
                    ) : null}
                  </div>
                )}
              </div>

              {/* Top agents */}
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Busiest agents
                </div>
                {stats.topAgents.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No agent replies yet.</p>
                ) : (
                  <div className="space-y-2.5" role="list" aria-label="Busiest agents — replies per agent">
                    {stats.topAgents.map((a) => (
                      <div
                        key={a.id}
                        role="listitem"
                        aria-label={`${a.name} — ${a.count} repl${a.count === 1 ? "y" : "ies"}`}
                        className="flex items-center gap-2.5 rounded px-1 transition-colors hover:bg-muted/30"
                      >
                        <AgentAvatar
                          agent={{ emoji: a.emoji, color: a.color, name: a.name }}
                          size="xs"
                        />
                        <span className="w-24 shrink-0 truncate text-xs font-medium" aria-hidden>{a.name}</span>
                        <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${(a.count / maxAgent) * 100}%` }}
                            transition={{ duration: 0.5, ease: "easeOut" }}
                            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400"
                          />
                        </div>
                        <span className="w-6 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground" aria-hidden>
                          {a.count}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
