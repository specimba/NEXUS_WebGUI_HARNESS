"use client";

// ─── MCP Servers card (r38, stateless-first client) ──────────────────────────
// Register Model Context Protocol servers (Streamable-HTTP POST endpoints);
// discover their tools statelessly (no handshake, no sessions — spec
// 2026-07-28 doctrine) and toggle which tools join chat + pipeline runs.
//
// Honest-by-design details:
//   • Browser-direct transport is the default — BYOK headers go from YOUR
//     browser straight to the MCP server and never touch the app server.
//   • "Route via app proxy" is per-server opt-in for CORS-starved servers;
//     when on, headers transit the app server (SSRF-guarded, never stored).
//   • A server demanding sessionful transport fails with an explicit error.
//   • Per-run MCP tool budget is capped (MAX_MCP_TOOL_DEFS) — shown live.

import * as React from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Globe,
  Loader2,
  Plug,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Waypoints,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useSettingsStore } from "@/lib/stores";
import {
  guessMcpEndpoint,
  mcpDiscoverTools,
  slugifyMcpName,
  McpError,
} from "@/lib/mcp";
import {
  getMcpToolHealth,
  resetMcpToolHealth,
  MCP_HEALTH_WINDOW,
  type McpToolHealth,
} from "@/lib/mcp-health";
import {
  MAX_MCP_SERVERS,
  MAX_MCP_TOOLS_PER_SERVER,
  MAX_MCP_TOOL_DEFS,
} from "@/lib/constants";
import { fmtRel, fmtMs, uid } from "@/lib/helpers";
import type { McpServer } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Live-verified stateless presets (curl-checked 2026-09-24, CORS-open). */
const MCP_PRESETS: { name: string; url: string; blurb: string; setup?: string }[] = [
  {
    name: "DeepWiki",
    url: "https://mcp.deepwiki.com/mcp",
    blurb: "Ask questions about any GitHub repo's codebase · stateless ✓",
  },
  {
    name: "Context7",
    url: "https://mcp.context7.com/mcp",
    blurb: "Up-to-date library docs for any package · stateless ✓",
  },
  {
    // r41: Bright Data's REMOTE MCP (mcp.brightdata.com) — token in the URL
    // query (BYOK: the token goes browser→Bright Data directly; CORS probe
    // 2026-09-24 returned access-control-allow-origin: * + POST allowed).
    name: "Bright Data",
    url: "https://mcp.brightdata.com/mcp?token=YOUR_BRIGHTDATA_TOKEN",
    blurb:
      "Web unlocker — search_engine, scrape_as_markdown, extract, scrape_batch · remote MCP · stateless ✓ · 1 credit/request free tier",
    setup:
      "Paste your Bright Data API token over YOUR_BRIGHTDATA_TOKEN in the endpoint's ?token= query param. Get it at brightdata.com/cp/mcp — free tier costs 1 credit per request.",
  },
];

/**
 * r39 tool-health chip: a per-tool outcome ledger (local-only) rendered as an
 * honest traffic light — emerald when calls land, amber streak ≥2, red ≥4,
 * nothing before the first executed call. `hint` marks the model-facing
 * steering state (the description the model sees now carries the flaky note).
 */
function ToolHealthChip({ health, defName }: { health?: McpToolHealth; defName: string }) {
  if (!health || health.calls === 0) return null;
  const okPct = Math.round((health.oks / health.calls) * 100);
  const streak = health.failStreak;
  const down = streak >= 4;
  const flaky = streak >= 2;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
        down
          ? "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400"
          : flaky
            ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
            : "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      )}
      title={
        `${health.calls} call${health.calls === 1 ? "" : "s"} · ${health.oks} ok / ${health.fails} failed (${okPct}%) · mean ${fmtMs(health.meanMs)} over the last ${MCP_HEALTH_WINDOW}` +
        (health.lastError ? ` · last error: ${health.lastError.slice(0, 140)}` : "") +
        (flaky ? " · the model's tool description now carries a flaky hint" : "") +
        ` · def ${defName}`
      }
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          down ? "bg-red-500" : flaky ? "bg-amber-500" : "bg-emerald-500",
          !down && !flaky && "soft-pulse"
        )}
        aria-hidden
      />
      {flaky
        ? `${streak} fail${streak === 1 ? "" : "s"} in a row`
        : `${okPct}% ok · ~${fmtMs(health.meanMs)}`}
    </span>
  );
}

/** Parse "Key: value" lines into auth headers (first colon splits). */
function parseHeaderLines(text: string): { headers: Record<string, string>; errors: string[] } {
  const headers: Record<string, string> = {};
  const errors: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx <= 0) {
      errors.push(trimmed);
      continue;
    }
    const name = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!name || !value || !/^[A-Za-z0-9-]+$/.test(name)) {
      errors.push(trimmed);
      continue;
    }
    headers[name] = value;
  }
  return { headers, errors };
}

function headersToText(headers?: Record<string, string>): string {
  return Object.entries(headers ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

/** Preserve per-tool enable choices across re-discovery (name-keyed). */
function mergeCatalog(
  prevTools: McpServer["tools"],
  fresh: McpServer["tools"]
): McpServer["tools"] {
  const prevEnabled = new Map((prevTools ?? []).map((t) => [t.name, t.enabled]));
  return (fresh ?? []).map((t) => ({ ...t, enabled: prevEnabled.get(t.name) ?? true }));
}

export function McpCard() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const servers = settings.mcpServers ?? [];

  const [name, setName] = React.useState("");
  const [endpoint, setEndpoint] = React.useState("");
  const [headersText, setHeadersText] = React.useState("");
  const [addOpen, setAddOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [discovering, setDiscovering] = React.useState<string | null>(null);
  // r39: the health ledger writes from chat/pipeline turns outside React — a
  // gentle 5s tick (only while a server panel is open) keeps chips honest.
  const [healthTick, setHealthTick] = React.useState(0);
  React.useEffect(() => {
    if (!expanded) return;
    const t = setInterval(() => setHealthTick((n) => n + 1), 5_000);
    return () => clearInterval(t);
  }, [expanded]);

  const patchServer = React.useCallback(
    (id: string, patch: Partial<McpServer>) => {
      update({
        mcpServers: (settings.mcpServers ?? []).map((s) => (s.id === id ? { ...s, ...patch } : s)),
      });
    },
    [settings.mcpServers, update]
  );

  const offeredThisRun = servers.reduce(
    (n, s) => n + (s.enabled ? (s.tools ?? []).filter((t) => t.enabled).length : 0),
    0
  );

  const addServer = () => {
    if (!name.trim() || !endpoint.trim()) {
      toast.warning("Name and endpoint are both required");
      return;
    }
    if (servers.length >= MAX_MCP_SERVERS) {
      toast.warning(`MCP registry is full (max ${MAX_MCP_SERVERS} servers)`, {
        description: "Remove a server to add another — localStorage discipline.",
      });
      return;
    }
    const url = guessMcpEndpoint(endpoint);
    if (!url) {
      toast.error("That endpoint does not look like a URL", {
        description: "Example: https://mcp.deepwiki.com/mcp",
      });
      return;
    }
    // r41: catch a leftover credential placeholder (Bright Data preset) before
    // it becomes a server that can only fail discovery.
    if (/YOUR_[A-Z_]+(TOKEN|KEY)/.test(url)) {
      toast.error("The endpoint still carries a placeholder credential", {
        description: "Replace YOUR_…_TOKEN with your real token (Bright Data: brightdata.com/cp/mcp) before registering.",
      });
      return;
    }
    const { headers, errors } = parseHeaderLines(headersText);
    if (errors.length > 0) {
      toast.warning(`${errors.length} header line(s) ignored`, {
        description: "Use one \"Header-Name: value\" per line — names must be alphanumeric-dash.",
      });
    }
    const slugTaken = servers.some((s) => slugifyMcpName(s.name) === slugifyMcpName(name));
    const finalName = slugTaken ? `${name.trim()} 2` : name.trim();
    const row: McpServer = {
      id: uid("mcp"),
      name: finalName,
      url,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      enabled: true,
      addedAt: Date.now(),
    };
    update({ mcpServers: [...servers, row] });
    setName("");
    setEndpoint("");
    setHeadersText("");
    setAddOpen(false);
    toast.success(`MCP server "${row.name}" registered`, {
      description: "Run Discover to pull its tool catalog statelessly.",
      icon: "🔌",
    });
  };

  const discover = async (server: McpServer) => {
    setDiscovering(server.id);
    try {
      const d = await mcpDiscoverTools(server);
      patchServer(server.id, {
        tools: mergeCatalog(server.tools, d.tools),
        protocolVersion: d.protocolVersion,
        discoveredAt: Date.now(),
        lastError: undefined,
        lastVia: d.via,
      });
      toast.success(
        `${server.name}: ${d.tools.length} tool${d.tools.length === 1 ? "" : "s"} discovered`,
        {
          description: `Protocol ${d.protocolVersion} · ${d.via === "proxy" ? "via app proxy" : "browser-direct"}`,
          icon: "🛰️",
        }
      );
    } catch (err) {
      const message = err instanceof McpError || err instanceof Error ? err.message : "Discovery failed";
      patchServer(server.id, { lastError: message });
      toast.error(`${server.name}: discovery failed`, { description: message });
    } finally {
      setDiscovering(null);
    }
  };

  const removeServer = (server: McpServer) => {
    update({ mcpServers: servers.filter((s) => s.id !== server.id) });
    toast(`${server.name} removed`, { description: "Its tools no longer ride any run." });
  };

  const setToolEnabled = (server: McpServer, toolName: string, enabled: boolean) => {
    patchServer(server.id, {
      tools: (server.tools ?? []).map((t) => (t.name === toolName ? { ...t, enabled } : t)),
    });
  };

  const enabledCount = servers.filter((s) => s.enabled).length;

  return (
    <Card className="gap-4" id="mcp">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Waypoints className="size-4 text-violet-500" aria-hidden />
              MCP Servers
            </CardTitle>
            <CardDescription>
              Model Context Protocol tools — live-verified stateless client (spec 2026-07-28
              doctrine: no sessions, no handshake). Enabled tools join chat turns AND pipeline
              runs; every result is fenced as untrusted data before the model sees it.
            </CardDescription>
          </div>
          <Button size="sm" variant={addOpen ? "secondary" : "outline"} onClick={() => setAddOpen((v) => !v)}>
            <Plus className="size-3.5" aria-hidden />
            Add server
          </Button>
        </div>
        {servers.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs text-muted-foreground">
            <Badge variant="outline" className="gap-1 border-violet-500/40 bg-violet-500/5 font-normal">
              {servers.length} registered · {enabledCount} enabled
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                "gap-1 font-normal",
                offeredThisRun > 0
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : "border-dashed text-muted-foreground"
              )}
            >
              {offeredThisRun} tool{offeredThisRun === 1 ? "" : "s"} offered per run
              {offeredThisRun > MAX_MCP_TOOL_DEFS && ` (cap ${MAX_MCP_TOOL_DEFS})`}
            </Badge>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {/* ── Verified presets ─────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2">
          {MCP_PRESETS.map((p) => {
            const already = servers.some(
              (s) => s.url === p.url || slugifyMcpName(s.name) === slugifyMcpName(p.name)
            );
            return (
              <button
                key={p.url}
                type="button"
                disabled={already || servers.length >= MAX_MCP_SERVERS}
                onClick={() => {
                  // r41: presets whose URL carries a credential PLACEHOLDER
                  // (Bright Data's ?token=) prefill the add form instead of
                  // registering a dead endpoint — the user pastes their real
                  // token first, so discovery works on the very first try.
                  if (p.setup) {
                    setName(p.name);
                    setEndpoint(p.url);
                    setAddOpen(true);
                    toast.info(`${p.name} — one step left`, {
                      description: p.setup,
                      duration: 12_000,
                      icon: "🔑",
                    });
                    return;
                  }
                  const row: McpServer = {
                    id: uid("mcp"),
                    name: p.name,
                    url: p.url,
                    enabled: true,
                    addedAt: Date.now(),
                  };
                  update({ mcpServers: [...servers, row] });
                  toast.success(`"${p.name}" registered from the verified preset`, {
                    description: "Hit Discover to pull its tools.",
                    icon: "🔌",
                  });
                }}
                className={cn(
                  "group flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
                  already
                    ? "border-dashed text-muted-foreground opacity-60"
                    : "hover:border-violet-500/50 hover:bg-violet-500/5"
                )}
                title={p.setup ? `${p.setup}` : p.blurb}
              >
                <Globe className="mt-0.5 size-3.5 text-violet-500" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-xs font-medium">
                    {p.name}
                    {already && " · added"}
                  </span>
                  <span className="block text-[11px] leading-snug text-muted-foreground">{p.blurb}</span>
                  {p.setup && !already && (
                    <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/5 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                      paste token on click
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── Add form ─────────────────────────────────────────────────── */}
        {addOpen && (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="DeepWiki"
                  className="h-8"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Endpoint (POST)</Label>
                <Input
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="mcp.deepwiki.com/mcp"
                  className="h-8 font-mono text-xs"
                />
                {endpoint.trim() && guessMcpEndpoint(endpoint) && (
                  <p className="text-[11px] text-muted-foreground">
                    resolves to <span className="font-mono">{guessMcpEndpoint(endpoint)}</span>
                  </p>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Auth headers — optional, one per line (BYOK: stays in your browser)</Label>
              <textarea
                value={headersText}
                onChange={(e) => setHeadersText(e.target.value)}
                rows={2}
                placeholder={"Authorization: Bearer sk-…\nX-API-Key: …"}
                className="w-full rounded-md border bg-transparent px-3 py-2 font-mono text-xs placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-500/60"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={addServer}>
                <Plug className="size-3.5" aria-hidden />
                Register server
              </Button>
            </div>
          </div>
        )}

        {/* ── Server rows ──────────────────────────────────────────────── */}
        {servers.length === 0 && !addOpen && (
          <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
            No MCP servers registered yet — add one above or start from a verified preset.
            Tools stay OFF until you discover and enable them.
          </p>
        )}

        <div className="space-y-2">
          {servers.map((server) => {
            const toolCount = (server.tools ?? []).length;
            const enabledTools = (server.tools ?? []).filter((t) => t.enabled).length;
            const isOpen = expanded === server.id;
            return (
              <div
                key={server.id}
                className={cn(
                  "rounded-lg border transition-colors",
                  server.enabled ? "bg-card" : "bg-muted/30 opacity-80",
                  server.lastError && "border-amber-500/40"
                )}
              >
                <div className="flex flex-wrap items-center gap-2 p-3">
                  <Switch
                    checked={server.enabled}
                    onCheckedChange={(v) => patchServer(server.id, { enabled: v })}
                    aria-label={`Toggle ${server.name}`}
                  />
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => setExpanded(isOpen ? null : server.id)}
                  >
                    {isOpen ? (
                      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    ) : (
                      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{server.name}</span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">
                        {server.url}
                      </span>
                    </span>
                  </button>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {toolCount > 0 && (
                      <Badge
                        variant="outline"
                        className="font-normal text-[11px]"
                        title={`${enabledTools}/${toolCount} tools enabled`}
                      >
                        {enabledTools}/{toolCount} tools
                      </Badge>
                    )}
                    {server.protocolVersion && (
                      <Badge
                        variant="outline"
                        className="font-mono text-[10px] font-normal text-muted-foreground"
                        title={`Protocol version negotiated on the last discovery · ${
                          server.lastVia === "proxy" ? "via app proxy" : "browser-direct"
                        }`}
                      >
                        {server.protocolVersion}
                      </Badge>
                    )}
                    {server.discoveredAt && !server.lastError && (
                      <Badge
                        variant="outline"
                        className="border-emerald-500/40 bg-emerald-500/5 font-normal text-[11px]"
                        title="Last successful discovery"
                      >
                        seen {fmtRel(server.discoveredAt)}
                      </Badge>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 px-2 text-[11px]"
                      onClick={() => discover(server)}
                      disabled={discovering === server.id}
                    >
                      {discovering === server.id ? (
                        <Loader2 className="size-3 animate-spin" aria-hidden />
                      ) : (
                        <RefreshCw className="size-3" aria-hidden />
                      )}
                      Discover
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-muted-foreground hover:text-destructive"
                      onClick={() => removeServer(server)}
                      aria-label={`Remove ${server.name}`}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  </div>
                </div>

                {server.lastError && (
                  <p className="mx-3 mb-2 flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
                    <ShieldAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
                    {server.lastError}
                  </p>
                )}

                {isOpen && (
                  <div className="space-y-3 border-t px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[11px] text-muted-foreground">
                        Transport:{" "}
                        <span className="font-medium">
                          {server.useProxy ? "via app proxy (headers transit the server)" : "browser-direct (keys stay local)"}
                        </span>
                      </p>
                      <label className="flex cursor-pointer items-center gap-1.5 text-[11px]">
                        <Switch
                          checked={server.useProxy === true}
                          onCheckedChange={(v) => patchServer(server.id, { useProxy: v })}
                          aria-label="Route via app proxy"
                        />
                        Route via app proxy
                      </label>
                    </div>
                    <p className="rounded-md border border-dashed px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
                      {server.useProxy
                        ? "Fallback for CORS-starved servers: the SSRF-guarded /api/mcp relay POSTs for you. Auth headers ride through the app server (never logged, never persisted) — keep browser-direct on unless the server blocks CORS."
                        : "Your browser talks to the MCP server directly; auth headers never leave your machine. If the server refuses cross-origin browser calls (CORS), switch the proxy on."}
                    </p>

                    {Object.keys(server.headers ?? {}).length > 0 && (
                      <div className="text-[11px] text-muted-foreground">
                        <span className="font-medium">Auth headers (masked): </span>
                        <span className="font-mono">
                          {Object.keys(server.headers ?? {})
                            .map((k) => `${k}: ••••`)
                            .join("  ")}
                        </span>
                      </div>
                    )}

                    <div className="space-y-1">
                      <p className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-medium">
                        <span>
                          Tools — toggle what may ride chat + pipeline runs
                          {toolCount >= MAX_MCP_TOOLS_PER_SERVER && ` (catalog capped at ${MAX_MCP_TOOLS_PER_SERVER})`}
                        </span>
                        {/* r39 health ledger footer: honest scope + one-click reset. */}
                        {(() => {
                          void healthTick; // re-read on tick
                          const slug = slugifyMcpName(server.name);
                          const tracked = (server.tools ?? [])
                            .map((t) => getMcpToolHealth(`mcp__${slug}__${t.name}`))
                            .filter((h): h is McpToolHealth => !!h && h.calls > 0);
                          const totalCalls = tracked.reduce((a, h) => a + h.calls, 0);
                          if (tracked.length === 0) return null;
                          return (
                            <span className="flex items-center gap-1.5 text-[10px] font-normal text-muted-foreground">
                              <span
                                title="Executed-call outcomes recorded locally while tools ran in chat or pipelines"
                              >
                                health: {tracked.length} tracked · {totalCalls} call{totalCalls === 1 ? "" : "s"} · local-only
                              </span>
                              <button
                                type="button"
                                className="rounded px-1 text-[10px] underline-offset-2 hover:text-foreground hover:underline"
                                onClick={() => {
                                  for (const t of server.tools ?? []) {
                                    resetMcpToolHealth(`mcp__${slug}__${t.name}`);
                                  }
                                  setHealthTick((n) => n + 1);
                                  toast("Tool health cleared", {
                                    icon: "🧹",
                                    description: `Ledger rows for ${server.name} wiped — flaky hints leave the next tool descriptions too.`,
                                  });
                                }}
                              >
                                reset
                              </button>
                            </span>
                          );
                        })()}
                      </p>
                      {(server.tools ?? []).length === 0 && (
                        <p className="rounded-md border border-dashed px-2 py-2 text-[11px] text-muted-foreground">
                          No catalog yet — hit Discover.
                        </p>
                      )}
                      {(server.tools ?? []).map((tool) => {
                        const defName = `mcp__${slugifyMcpName(server.name)}__${tool.name}`;
                        void healthTick; // chips re-render on the liveness tick
                        const health = getMcpToolHealth(defName);
                        return (
                          <div
                            key={tool.name}
                            className={cn(
                              "flex items-start justify-between gap-2 rounded-md border px-2 py-1.5",
                              tool.enabled && server.enabled ? "bg-violet-500/5" : "opacity-70"
                            )}
                          >
                            <div className="min-w-0">
                              <p className="truncate font-mono text-[11px] font-medium">{tool.name}</p>
                              {tool.description && (
                                <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                                  {tool.description}
                                </p>
                              )}
                              <p className="truncate font-mono text-[10px] text-muted-foreground/70">
                                {defName}
                              </p>
                              <div className="mt-1">
                                <ToolHealthChip health={health} defName={defName} />
                              </div>
                            </div>
                            <Switch
                              checked={tool.enabled}
                              onCheckedChange={(v) => setToolEnabled(server, tool.name, v)}
                              aria-label={`Toggle tool ${tool.name}`}
                              className="mt-0.5"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
