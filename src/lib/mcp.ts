// ─── r38 MCP client — stateless-first (spec 2026-07-28 doctrine) ─────────────
// NO sessions, NO handshake persistence, NO SSE resumability. Every request is
// a self-contained JSON-RPC POST; the protocol version rides the ladder
// (2026-07-28 → 2025-11-25 → 2025-06-18) and the winner is cached per server.
//
// Transport doctrine:
//   • browser-direct (default) — fetch straight from the user's browser, so
//     BYOK auth headers never touch the app server. Live-verified CORS-open
//     servers: mcp.deepwiki.com, mcp.context7.com (2026-09-24).
//   • /api/mcp proxy (per-server opt-in) — for CORS-starved servers. Honest
//     tradeoff surfaced in the UI: headers transit the app server, which
//     SSRF-guards the URL and never persists anything.
//
// MCP tool output is UNTRUSTED DATA — it flows through the same fencing +
// injection scrubbing as every other tool result (fenceToolOutputForModel).

import {
  MAX_MCP_TOOL_DEFS,
  MAX_MCP_TOOLS_PER_SERVER,
  MCP_CALL_TIMEOUT_MS,
  MCP_DESC_MAX_CHARS,
  MCP_DISCOVER_TIMEOUT_MS,
  MCP_INPUT_MAX_ROUNDS,
  MCP_PROTOCOL_LADDER,
  MCP_SCHEMA_MAX_CHARS,
  MCP_SCHEMA_MAX_PROPS,
} from "./constants";
import type { McpInputRequest, McpInputResponse, McpServer, McpToolInfo, Settings } from "./types";
import type { ToolDef, ToolResult } from "./tools-defs";
import { mcpHealthHint, recordMcpToolOutcome } from "./mcp-health";
import { gateMcpInput, parseMcpInputRequests, resolveGateMode, summarizeInputRequests } from "./mcp-input";

// ─── Naming ──────────────────────────────────────────────────────────────────

/** Server name → def-name slug (a-z0-9, trimmed, collision-postfixed later). */
export function slugifyMcpName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return slug || "server";
}

/** The def name the model sees: mcp__<server-slug>__<tool-name>. */
export function mcpToolDefName(serverSlug: string, toolName: string): string {
  return `mcp__${serverSlug}__${toolName}`;
}

/** Inverse of mcpToolDefName — null for anything that is not an MCP def. */
export function parseMcpToolDefName(defName: string): { slug: string; toolName: string } | null {
  // Lazy slug so tool names containing "__" survive (slug itself never has "_").
  const m = /^mcp__(.+?)__(.+)$/.exec(defName);
  return m ? { slug: m[1], toolName: m[2] } : null;
}

// ─── Endpoint + schema hygiene ───────────────────────────────────────────────

/**
 * Accept flexible user input ("mcp.deepwiki.com", "mcp.deepwiki.com/mcp") and
 * return the real POST endpoint: https:// added when missing, /mcp appended
 * when the URL has no path at all. The result is shown in the UI before save.
 */
export function guessMcpEndpoint(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.pathname || u.pathname === "/") u.pathname = "/mcp";
    // One trailing slash is noise, never semantic for MCP endpoints.
    const out = u.toString();
    return out.length > 1 && out.endsWith("/") ? out.slice(0, -1) : out;
  } catch {
    return null;
  }
}

/**
 * Make a server-declared input schema safe to hand to the LLM: object-typed,
 * size-capped, injection-hardened (descriptions are trimmed; $schema and other
 * non-standard keys dropped). Never throws — a broken schema degrades to an
 * empty-object schema (the tool still works for no-arg calls).
 */
export function sanitizeMcpInputSchema(schema: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = { type: "object", properties: {} };
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return out;
  const raw = schema as Record<string, unknown>;
  const props =
    raw.properties && typeof raw.properties === "object" && !Array.isArray(raw.properties)
      ? (raw.properties as Record<string, unknown>)
      : {};
  const required = Array.isArray(raw.required) ? raw.required.map(String).filter(Boolean) : [];
  const names = Object.keys(props).slice(0, MCP_SCHEMA_MAX_PROPS);
  const cleaned: Record<string, unknown> = {};
  let size = 2;
  for (const name of names) {
    const prop =
      props[name] && typeof props[name] === "object" && !Array.isArray(props[name])
        ? ({ ...(props[name] as Record<string, unknown>) } as Record<string, unknown>)
        : { type: "string" };
    if (typeof prop.description === "string" && prop.description.length > 200) {
      prop.description = `${prop.description.slice(0, 200)}…`;
    }
    const entry: Record<string, unknown> = { [name]: prop };
    const entrySize = JSON.stringify(entry).length;
    if (size + entrySize > MCP_SCHEMA_MAX_CHARS) break; // budget spent — drop the tail honestly
    cleaned[name] = prop;
    size += entrySize;
  }
  out.properties = cleaned;
  const req = required.filter((r) => r in cleaned);
  if (req.length > 0) out.required = req;
  return out;
}

function trimDesc(d: string | undefined): string | undefined {
  const s = (d ?? "").trim();
  if (!s) return undefined;
  return s.length > MCP_DESC_MAX_CHARS ? `${s.slice(0, MCP_DESC_MAX_CHARS)}…` : s;
}

// ─── Tool-def composition (the run-time registry bridge) ─────────────────────

export interface McpDefPlan {
  defs: ToolDef[];
  /** (server, tool) pairs actually offered, in offer order. */
  offered: { serverId: string; toolName: string; defName: string }[];
  /** How many enabled tools were dropped by the per-run cap. */
  dropped: number;
}

/**
 * Compose MCP tool defs for ONE run from the registry: enabled servers ×
 * enabled tools, description prefixed with provenance, capped by
 * MAX_MCP_TOOL_DEFS. Slugs are uniquified on collision (server-2).
 */
export function buildMcpToolPlan(servers: McpServer[]): McpDefPlan {
  const defs: ToolDef[] = [];
  const offered: McpDefPlan["offered"] = [];
  let dropped = 0;
  const slugSeen = new Map<string, number>();
  for (const server of servers) {
    if (!server.enabled) continue;
    let slug = slugifyMcpName(server.name);
    const n = (slugSeen.get(slug) ?? 0) + 1;
    slugSeen.set(slug, n);
    if (n > 1) slug = `${slug}-${n}`;
    for (const tool of server.tools ?? []) {
      if (!tool.enabled) continue;
      if (defs.length >= MAX_MCP_TOOL_DEFS) {
        dropped += 1;
        continue;
      }
      const defName = mcpToolDefName(slug, tool.name);
      // r39 health steering: after repeated failures the model-facing
      // description carries a short honest hint (relay-ledger analog).
      const hint = mcpHealthHint(defName);
      const fullDesc = `[MCP · ${server.name}] ${tool.description ?? tool.name}${hint}`;
      defs.push({
        type: "function",
        function: {
          name: defName,
          description: trimDesc(fullDesc) ?? tool.name,
          parameters: tool.inputSchema ?? { type: "object", properties: {} },
        },
      });
      offered.push({ serverId: server.id, toolName: tool.name, defName });
    }
  }
  return { defs, offered, dropped };
}

/**
 * The run-params seam: everything a caller must spread into runAgentChat for
 * MCP tools to ride along. Empty object when the registry is empty — zero
 * overhead for users who never touch MCP.
 */
export function mcpRunParams(settings: Settings): { mcpServers?: McpServer[] } {
  const servers = (settings.mcpServers ?? []).filter((s) => s.enabled);
  if (servers.length === 0) return {};
  const plan = buildMcpToolPlan(servers);
  if (plan.defs.length === 0) return {};
  return { mcpServers: servers };
}

// ─── JSON-RPC transport ──────────────────────────────────────────────────────

export class McpError extends Error {
  /** Machine-readable hint for the UI (e.g. "sessionful-transport"). */
  hint?: string;
  constructor(message: string, hint?: string) {
    super(message);
    this.name = "McpError";
    this.hint = hint;
  }
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

/** One POST's outcome: the parsed body + any `mcp-session-id` the server issued. */
interface JsonRpcExchange {
  parsed: JsonRpcResponse;
  sessionId?: string;
}

/** Parse a JSON-RPC response from either application/json or a single-shot SSE data frame. */
export function parseMcpResponseBody(text: string, contentType: string): JsonRpcResponse {
  const trimmed = text.trim();
  if (!trimmed) throw new McpError("Server returned an empty response.");
  if (/text\/event-stream/i.test(contentType)) {
    // Single-shot SSE framing: take the first parsable `data:` line (skip
    // comments/pings). Multi-frame streams are a stateful-server artifact —
    // we still parse the first message honestly instead of failing.
    for (const line of trimmed.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        return JSON.parse(payload) as JsonRpcResponse;
      } catch {
        /* keep scanning */
      }
    }
    throw new McpError("Server sent an event stream with no JSON-RPC message (stateful transport artifact).");
  }
  try {
    return JSON.parse(trimmed) as JsonRpcResponse;
  } catch {
    throw new McpError(`Server response was not JSON-RPC (content-type ${contentType || "unknown"}).`);
  }
}

const PROXY_BLOCKED_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "expect",
  "origin",
  "referer",
  "cookie",
  "accept-encoding",
]);

function buildHeaders(server: McpServer, protocolVersion: string, sessionId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": protocolVersion,
    ...(sessionId ? { "mcp-session-id": sessionId } : {}),
  };
  for (const [k, v] of Object.entries(server.headers ?? {})) {
    const name = k.trim();
    if (!name || PROXY_BLOCKED_HEADERS.has(name.toLowerCase())) continue;
    if (!/^[A-Za-z0-9-]+$/.test(name)) continue;
    if (!v) continue;
    headers[name] = v;
  }
  return headers;
}

/** One JSON-RPC POST. Resolves the parsed response + any session id the server issued. */
async function jsonRpcPost(
  server: McpServer,
  payload: Record<string, unknown>,
  protocolVersion: string,
  timeoutMs: number,
  signal?: AbortSignal,
  sessionId?: string
): Promise<JsonRpcExchange> {
  const body = JSON.stringify(payload);
  const via = server.useProxy ? "proxy" : "browser";
  let res: Response;
  try {
    if (via === "proxy") {
      res = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-praison-csrf": "1" },
        body: JSON.stringify({
          url: server.url,
          headers: buildHeaders(server, protocolVersion, sessionId),
          payload,
        }),
        signal: composeDeadline(timeoutMs, signal),
      });
    } else {
      res = await fetch(server.url, {
        method: "POST",
        headers: buildHeaders(server, protocolVersion, sessionId),
        body,
        signal: composeDeadline(timeoutMs, signal),
      });
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    const deadline = err instanceof DOMException && err.name === "TimeoutError";
    if (deadline) throw new McpError(`MCP ${via === "proxy" ? "proxy" : "server"} timed out after ${Math.round(timeoutMs / 1000)}s.`);
    // Browser-direct fetch to a CORS-starved server fails as TypeError.
    if (via === "browser" && err instanceof TypeError) {
      throw new McpError(
        "Browser could not reach the server directly (network error or missing CORS). Enable 'Route via app proxy' on this server to fall back through the SSRF-guarded proxy.",
        "cors"
      );
    }
    throw new McpError(err instanceof Error ? err.message : "Network request failed.");
  }
  let text: string;
  try {
    text = await res.text();
  } catch {
    throw new McpError(`Could not read the server response (HTTP ${res.status}).`);
  }
  if (!res.ok) {
    // Try to surface a JSON-RPC error body honestly; fall back to status text.
    let message = `HTTP ${res.status} ${res.statusText || ""}`.trim();
    try {
      const parsed = parseMcpResponseBody(text, res.headers.get("content-type") ?? "");
      if (parsed.error?.message) message = parsed.error.message;
    } catch {
      /* keep the HTTP-level message */
      if (text && text.length < 300) message = `${message} — ${text.trim()}`;
    }
    throw new McpError(message);
  }
  const parsed = parseMcpResponseBody(text, res.headers.get("content-type") ?? "");
  // r43: capture the session id streamable-HTTP servers issue on initialize —
  // read header access browser-direct depends on Access-Control-Expose-Headers;
  // the proxy passthrough always forwards it.
  const answeredSessionId = res.headers.get("mcp-session-id") ?? undefined;
  return { parsed, ...(answeredSessionId ? { sessionId: answeredSessionId } : {}) };
}

/** Compose a hard deadline with the caller's abort signal. */
function composeDeadline(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const deadline = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined;
  if (!deadline) return signal ?? new AbortController().signal;
  if (!signal) return deadline;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([signal, deadline]);
  return deadline; // deadline-only fallback keeps the hard stop
}

function throwIfRpcError(parsed: JsonRpcResponse, context: string): void {
  if (!parsed.error) return;
  const msg = parsed.error.message ?? "Unknown JSON-RPC error";
  throw new McpError(`${context}: ${msg}`);
}

// ─── Session handshake (r43) ───────────────────────────────────────────────────
// The r38 doctrine was “NO sessions” — and Bright Data answered every
// tools/list with “Bad Request: No valid session ID provided”: streamable-HTTP
// servers built on the official SDK hand out a `mcp-session-id` on initialize
// and reject everything that doesn't carry it. The doctrine upgrade is
// IN-REQUEST sessions: handshake before the first call, cache the id in
// memory only (tab lifetime — nothing persists, BYOK discipline intact),
// re-handshake once when a server calls a session stale. Truly stateless
// servers are unaffected (initialize is a normal request to them too).

const MCP_CLIENT_INFO = { name: "PraisonAI Web", version: "1.0.0" };
/** Cache TTL — under typical server session TTLs; stale ids self-heal anyway. */
const MCP_SESSION_TTL_MS = 25 * 60_000;

interface McpSessionState {
  id: string;
  protocolVersion: string;
  at: number;
}

const mcpSessions = new Map<string, McpSessionState>();

/** Any server complaint about a session → one fresh handshake + retry. */
function isMcpSessionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : "";
  return /session/i.test(msg) && !/stateless/i.test(msg);
}

/**
 * initialize → notifications/initialized → session state (when the server
 * issues one). The notification is fire-and-forget (202, body ignored) —
 * some SDK servers require it before they accept tools/list.
 */
async function mcpHandshake(
  server: McpServer,
  version: string,
  signal?: AbortSignal
): Promise<McpSessionState | undefined> {
  const init = await jsonRpcPost(
    server,
    {
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: { protocolVersion: version, capabilities: {}, clientInfo: MCP_CLIENT_INFO },
    },
    version,
    MCP_DISCOVER_TIMEOUT_MS,
    signal
  );
  throwIfRpcError(init.parsed, "MCP initialize failed");
  const answered = (init.parsed.result as { protocolVersion?: string } | undefined)?.protocolVersion;
  try {
    await jsonRpcPost(
      server,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      version,
      Math.min(8_000, MCP_DISCOVER_TIMEOUT_MS),
      signal,
      init.sessionId
    );
  } catch {
    // 202-empty / SSE-without-data / anything — the notification is a courtesy.
  }
  return init.sessionId
    ? { id: init.sessionId, protocolVersion: answered ?? version, at: Date.now() }
    : undefined;
}

/** Cached session id (handshaking when absent/stale). force = re-handshake now. */
async function ensureMcpSession(
  server: McpServer,
  version: string,
  signal?: AbortSignal,
  force = false
): Promise<string | undefined> {
  const cached = mcpSessions.get(server.id);
  if (!force && cached && Date.now() - cached.at < MCP_SESSION_TTL_MS) return cached.id;
  const fresh = await mcpHandshake(server, version, signal);
  if (fresh) mcpSessions.set(server.id, fresh);
  else mcpSessions.delete(server.id);
  return fresh?.id;
}

// ─── Discovery ───────────────────────────────────────────────────────────────

export interface McpDiscovery {
  tools: McpToolInfo[];
  protocolVersion: string;
  via: "browser" | "proxy";
}

/**
 * tools/list over the protocol-version ladder (spec-latest first). r43: each
 * rung handshakes FIRST (initialize → session id) so streamable-HTTP servers
 * built on the official SDK accept the request; a stale-session rejection
 * gets ONE fresh-handshake retry before the next rung.
 */
export async function mcpDiscoverTools(server: McpServer, signal?: AbortSignal): Promise<McpDiscovery> {
  const versions = server.protocolVersion
    ? [server.protocolVersion, ...MCP_PROTOCOL_LADDER.filter((v) => v !== server.protocolVersion)]
    : [...MCP_PROTOCOL_LADDER];
  let lastError: unknown = null;
  for (const version of versions) {
    try {
      let sessionId = await ensureMcpSession(server, version, signal);
      let parsed: JsonRpcResponse;
      try {
        parsed = (
          await jsonRpcPost(
            server,
            { jsonrpc: "2.0", id: 1, method: "tools/list" },
            version,
            MCP_DISCOVER_TIMEOUT_MS,
            signal,
            sessionId
          )
        ).parsed;
      } catch (err) {
        if (!isMcpSessionError(err)) throw err;
        // Server called our session invalid/stale — one fresh handshake + retry.
        sessionId = await ensureMcpSession(server, version, signal, true);
        parsed = (
          await jsonRpcPost(
            server,
            { jsonrpc: "2.0", id: 1, method: "tools/list" },
            version,
            MCP_DISCOVER_TIMEOUT_MS,
            signal,
            sessionId
          )
        ).parsed;
      }
      throwIfRpcError(parsed, "Discovery failed");
      const result = (parsed.result ?? {}) as { tools?: unknown };
      const rawTools = Array.isArray(result.tools) ? result.tools : [];
      const tools: McpToolInfo[] = [];
      for (const raw of rawTools.slice(0, MAX_MCP_TOOLS_PER_SERVER)) {
        if (!raw || typeof raw !== "object") continue;
        const t = raw as Record<string, unknown>;
        const name = typeof t.name === "string" ? t.name.trim() : "";
        if (!name) continue;
        tools.push({
          name,
          serverName: server.name,
          description: trimDesc(typeof t.description === "string" ? t.description : undefined),
          inputSchema: sanitizeMcpInputSchema(t.inputSchema),
          enabled: true,
        });
      }
      return {
        tools,
        protocolVersion: mcpSessions.get(server.id)?.protocolVersion ?? version,
        via: server.useProxy ? "proxy" : "browser",
      };
    } catch (err) {
      lastError = err;
      // CORS hints and timeouts are terminal — retrying other protocol
      // versions cannot help. Session rejections were already retried once
      // with a fresh handshake above; past that, the next rung may still work.
      const hint = err instanceof McpError ? err.hint : undefined;
      const msg = err instanceof Error ? err.message : "";
      if (hint === "cors" || /timed out/i.test(msg)) throw err;
      // "Unsupported protocol version" → try the next rung.
    }
  }
  throw lastError instanceof Error ? lastError : new McpError("Discovery failed on every protocol version.");
}

// ─── Tool calls ──────────────────────────────────────────────────────────────

/**
 * Stateless tools/call. Content blocks are joined into one text payload —
 * text verbatim, resources as "uri → text" lines, images as an honest
 * placeholder (binary is deliberately not inlined into context, mirroring the
 * image_generate doctrine). isError is honored as ok:false.
 *
 * r40 MRTR: when `inputResponses` is provided (the human answered an
 * input_required round), the ORIGINAL request is retried with them attached.
 * A result carrying `resultType: "input_required"` is returned with its
 * `inputRequests` parsed — the CALLER decides how to gate (dialog vs decline).
 */
export interface McpCallOutcome extends ToolResult {
  /** Present when the server returned InputRequiredResult (call NOT complete). */
  inputRequests?: McpInputRequest[];
}

export async function mcpCallTool(
  server: McpServer,
  toolName: string,
  argsJson: string,
  signal?: AbortSignal,
  inputResponses?: McpInputResponse[]
): Promise<McpCallOutcome> {
  const started = Date.now();
  let args: unknown = {};
  const raw = (argsJson ?? "").trim();
  if (raw) {
    try {
      args = JSON.parse(raw);
    } catch {
      return {
        ok: false,
        content: `MCP tool error: arguments for "${toolName}" are not valid JSON.`,
        ms: 0,
      };
    }
  }
  const version =
    mcpSessions.get(server.id)?.protocolVersion ?? server.protocolVersion ?? MCP_PROTOCOL_LADDER[1];
  try {
    let sessionId: string | undefined;
    try {
      sessionId = await ensureMcpSession(server, version, signal);
    } catch {
      // Handshake itself failed — try the call bare (stateless servers work).
    }
    let parsed: JsonRpcResponse;
    try {
      parsed = (
        await jsonRpcPost(
          server,
          {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: {
              name: toolName,
              arguments: args,
              ...(inputResponses ? { inputResponses } : {}),
            },
          },
          version,
          MCP_CALL_TIMEOUT_MS,
          signal,
          sessionId
        )
      ).parsed;
    } catch (err) {
      if (!isMcpSessionError(err)) throw err;
      // Stale/unknown session — one fresh handshake + retry.
      sessionId = await ensureMcpSession(server, version, signal, true);
      parsed = (
        await jsonRpcPost(
          server,
          {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: {
              name: toolName,
              arguments: args,
              ...(inputResponses ? { inputResponses } : {}),
            },
          },
          version,
          MCP_CALL_TIMEOUT_MS,
          signal,
          sessionId
        )
      ).parsed;
    }
    throwIfRpcError(parsed, `MCP tool "${toolName}" failed`);
    const result = (parsed.result ?? {}) as {
      content?: unknown;
      isError?: unknown;
      structuredContent?: unknown;
      resultType?: unknown;
      inputRequests?: unknown;
    };
    // r40 MRTR envelope: every result carries resultType ("complete" |
    // "input_required"); absent = pre-MRTR server ("complete" semantics).
    const resultType = typeof result.resultType === "string" ? result.resultType : "complete";
    if (resultType === "input_required") {
      const requests = parseMcpInputRequests(result.inputRequests);
      return {
        ok: false,
        ms: Date.now() - started,
        content: `MCP tool "${toolName}" needs human input before it can continue (${requests.length} request${requests.length === 1 ? "" : "s"}).`,
        inputRequests: requests,
      };
    }
    const blocks = Array.isArray(result.content) ? result.content : [];
    const parts: string[] = [];
    for (const block of blocks) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string") {
        parts.push(b.text);
      } else if (b.type === "resource" && b.resource && typeof b.resource === "object") {
        const r = b.resource as Record<string, unknown>;
        const uri = typeof r.uri === "string" ? r.uri : "(resource)";
        const text = typeof r.text === "string" ? r.text : JSON.stringify(r).slice(0, 2000);
        parts.push(`${uri}\n${text}`);
      } else if (b.type === "image") {
        parts.push("(image block omitted — open the MCP server UI to view it)");
      } else {
        parts.push(JSON.stringify(b).slice(0, 2000));
      }
    }
    if (parts.length === 0 && result.structuredContent) {
      parts.push(JSON.stringify(result.structuredContent).slice(0, 4000));
    }
    const content = parts.join("\n\n").slice(0, 32_000) || "(empty result)";
    return { ok: result.isError !== true, content, ms: Date.now() - started };
  } catch (err) {
    if (signal?.aborted) throw err;
    return {
      ok: false,
      content: `MCP tool error: ${err instanceof Error ? err.message : "call failed"}`,
      ms: Date.now() - started,
    };
  }
}

/**
 * Route an executed mcp__ def name to its server and call it.
 *
 * r40 MRTR: when the server answers `input_required`, INTERACTIVE lanes
 * (chat, playground) pause on the human gate — answers retry the original
 * request with `inputResponses` — while HEADLESS lanes (pipelines, bake-offs,
 * heartbeat) decline honestly so the model can adapt without a dialog.
 * One human round per call (MCP_INPUT_MAX_ROUNDS); a second input_required
 * after answers stops the loop with an honest message. The health ledger only
 * records COMPLETED outcomes — a declined gate is not the tool's fault.
 */
export async function executeMcpDefCall(
  servers: McpServer[],
  defName: string,
  argsJson: string,
  signal?: AbortSignal,
  interactive = false
): Promise<ToolResult> {
  const parsed = parseMcpToolDefName(defName);
  if (!parsed) {
    return { ok: false, content: `MCP tool error: "${defName}" is not a valid MCP tool name.`, ms: 0 };
  }
  const slug = parsed.slug;
  const candidates = servers.filter(
    (s) => s.enabled && (slugifyMcpName(s.name) === slug || slug.startsWith(`${slugifyMcpName(s.name)}-`))
  );
  const server = candidates.find((s) => s.tools?.some((t) => t.enabled && t.name === parsed.toolName));
  if (!server) {
    return {
      ok: false,
      content: `MCP tool error: no enabled server owns "${defName}". Re-discover the server in Settings → MCP.`,
      ms: 0,
    };
  }

  let outcome = await mcpCallTool(server, parsed.toolName, argsJson, signal);
  // r42 per-server gate preference: interactive lane + server allows → the
  // dialog may open; anything else declines honestly (reason names the switch).
  const gateMode = resolveGateMode(interactive, server.allowInputGates);
  let rounds = 0;
  while (outcome.inputRequests && rounds < MCP_INPUT_MAX_ROUNDS) {
    rounds += 1;
    const requests = outcome.inputRequests;
    const resolution = gateMode.open
      ? await gateMcpInput({
          interactive: true,
          defName,
          serverName: server.name,
          toolName: parsed.toolName,
          requests,
          signal,
        })
      : null;
    if (resolution?.action === "answered" && resolution.responses) {
      const retry = await mcpCallTool(server, parsed.toolName, argsJson, signal, resolution.responses);
      if (!retry.inputRequests) {
        // Human round completed the call — tell the model a human stepped in.
        outcome = {
          ...retry,
          content: `(the requested inputs were provided by the user)\n\n${retry.content}`,
        };
        continue; // loop re-checks: still no inputRequests → exits
      }
      outcome = {
        ok: false,
        ms: (outcome.ms ?? 0) + retry.ms,
        content:
          `MCP tool "${parsed.toolName}" answered the first input round, but the server requested MORE input afterward — ` +
          `stopped after ${MCP_INPUT_MAX_ROUNDS} human round to avoid a loop. Pending requests: ${summarizeInputRequests(retry.inputRequests)}`,
      };
    } else {
      // Closed lane (headless / per-server switch), user decline, deadline,
      // or abort — all honest declines with the truest reason available.
      const why =
        resolution?.action === "declined"
          ? resolution.reason ?? "declined"
          : gateMode.declineReason ?? "human input is unavailable in this run (autonomous lane)";
      outcome = {
        ok: false,
        ms: outcome.ms,
        content:
          `MCP tool "${parsed.toolName}" required human input and it was NOT provided (${why}). ` +
          `It asked: ${summarizeInputRequests(requests)}. Proceed without this data, use another tool, or tell the user to run this interactively.`,
      };
    }
  }
  if (outcome.inputRequests) {
    // Defensive: while-loop exhausted without resolving (should not happen
    // with MCP_INPUT_MAX_ROUNDS = 1, but never leak the marker type).
    outcome = {
      ok: false,
      ms: outcome.ms,
      content: `MCP tool "${parsed.toolName}" is still waiting for human input after ${rounds} round(s) — stopped honestly.`,
    };
  }

  // r39 health ledger: only COMPLETED outcomes count — a declined input gate
  // is not the tool failing, and must not poison the flaky hint.
  recordMcpToolOutcome(defName, outcome.ok, outcome.ms ?? 0, outcome.ok ? undefined : outcome.content);
  return { ok: outcome.ok, content: outcome.content, ms: outcome.ms };
}

/**
 * r40 audit receipt helper: the MCP tool surface one run will see (def names
 * in offer order + how many the per-run cap dropped). Used by the pipeline
 * runner to stamp run rows; recomputes the (tiny) plan rather than threading
 * it through every caller.
 */
export function mcpOfferedTools(settings: Settings): { names: string[]; dropped: number } {
  const servers = (settings.mcpServers ?? []).filter((s) => s.enabled);
  if (servers.length === 0) return { names: [], dropped: 0 };
  const plan = buildMcpToolPlan(servers);
  return { names: plan.offered.map((o) => o.defName), dropped: plan.dropped };
}
