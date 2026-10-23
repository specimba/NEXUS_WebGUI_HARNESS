// ─── Egress proxy layer (server-only, dependency-free) — r514 ────────────────
// Ported (faithfully, transport code untouched) from the NEXUS_BOT egress
// layer (task 12-a) and adapted to this platform's conventions: the Webshare
// token + routing map live in the PlatformSetting KV (no encrypted vault here
// yet), modes are "direct"|"pool", and every UI-facing surface returns only
// counts/country codes.
//
// Purpose: route outbound HTTP to specific upstreams through the owner's paid
// Webshare proxy pool (authenticated DIRECT proxies) instead of the sandbox
// egress IP. Motivation [MEASURED, source project 2026-10-23]: some upstreams
// (api.groq.com) WAF-block the sandbox egress IP with 403 while accepting the
// same request path from a pool proxy (401 = key-level answer ⇒ WAF
// bypassed). Per-upstream decisions live in the `egress.routing`
// PlatformSetting, default DIRECT.
//
// Transport strategy (resolved once per process, in this order):
//   1. undici ProxyAgent as fetch dispatcher (only if the `undici` package is
//      importable at runtime — it is NOT bundled in this project today).
//   2. Bun-native fetch `proxy` option (only under the Bun runtime) [MEASURED].
//   3. Hand-rolled HTTP CONNECT tunnel + raw HTTP/1.1 over node:net/node:tls —
//      dependency-free, works under the Node runtime that runs next-server
//      [MEASURED 2026-10-23: groq via pool proxy → 401 invalid_api_key while
//      direct → 403 WAF].
// If none can be used, callers get a typed PROXY_TRANSPORT_UNAVAILABLE failure
// — never a fake success.
//
// Secrets discipline (P7, inherited): proxy URLs (http://user:pass@host:port)
// exist ONLY in process memory for the lifetime of a request (pool cache
// ≤60 s). They are never logged, never serialized into API responses, never
// written to disk. Pool rows contain owner credentials — only
// counts/booleans/country codes may leave the process. The Webshare token is
// never echoed back (masked last-4 previews only). Failure messages are
// static strings — never upstream bodies, hosts or credentials (the
// upstash-connector idiom: surface error CODES, not fetch internals).
// Classification rule: a WAF/unreachable upstream is never reported as KEY
// REJECTED (401 means the upstream itself answered and rejected auth).

import net from "node:net";
import tls from "node:tls";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type EgressTransportName = "undici" | "bun" | "tunnel";

/** One pool proxy, reduced to its in-memory connection URL. SERVER-ONLY. */
export type EgressProxy = {
  id: string;
  /** http://user:pass@host:port — in-memory only (P7): never log/serialize/store. */
  url: string;
  port: number;
  country: string | null;
  valid: boolean | null;
};

export type EgressMode = "direct" | "pool";

/** Known upstreams — the routing UI rows AND the relay-hook host mapping. */
export const EGRESS_UPSTREAMS = ["groq", "vyce", "openai", "generic"] as const;
export type EgressUpstreamKey = (typeof EGRESS_UPSTREAMS)[number];

export type EgressErrorCode =
  | "NOT_CONFIGURED"
  | "SETTING_UNREADABLE"
  | "PROXY_TRANSPORT_UNAVAILABLE"
  | "PROXY_CONNECT_REFUSED"
  | "PROXY_AUTH_REJECTED"
  | "PROXY_TIMEOUT"
  | "TUNNEL_TLS_FAILED"
  | "UPSTREAM_BAD_RESPONSE"
  | "UPSTREAM_TIMEOUT"
  | "UNREACHABLE_FROM_SANDBOX"
  | "PROXY_POOL_FAILED"
  // Webshare API codes (inlined connector — static messages only)
  | "NETWORK_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "API_ERROR"
  | "BAD_RESPONSE";

export type EgressHttpResponse = {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
  via: "direct" | EgressTransportName;
};

export type EgressHttpFailure = {
  code: EgressErrorCode;
  message: string;
  via: "direct" | EgressTransportName | null;
  /** Status the PROXY itself returned on CONNECT (when applicable), not the upstream. */
  proxyStatus?: number;
};

export type EgressClassification =
  | "OK"
  | "KEY_REJECTED"
  | "UNREACHABLE_WAF"
  | "UNREACHABLE_FROM_SANDBOX"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR"
  | "NOT_FOUND"
  | "HTTP_OTHER"
  | "PROXY_FAILED"
  | "PROXY_POOL_FAILED";

/** Honest hint for the 403-WAF case — surfaced by the settings card + relay error mapping. */
export const EGRESS_WAF_HINT = "route this upstream through the egress pool (Settings → Egress)";

export const EGRESS_ROUTING_KEY = "egress.routing";
export const EGRESS_TOKEN_KEY = "egress.webshare.token";

/**
 * Probe targets. `generic` parses the Cloudflare trace `loc=` ONLY (the
 * `ip=` line and everything else is discarded, never echoed — P7). `groq`
 * is the measured WAF-bypass witness (direct 403 → pool 401).
 */
export const EGRESS_PROBE_TARGETS = {
  generic: { url: "https://www.cloudflare.com/cdn-cgi/trace", kind: "country" as const },
  groq: { url: "https://api.groq.com/openai/v1/models", kind: "status" as const },
} as const;

export type EgressProbeTarget = keyof typeof EGRESS_PROBE_TARGETS;

/** Body cap for tunnel reads — probes only ever need statuses / tiny bodies. */
const MAX_BODY_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Webshare connector (inlined from connectors/webshare.ts — same measured facts)
// ---------------------------------------------------------------------------

const WEBSHARE_API_BASE = "https://proxy.webshare.io/api/v2";
/** [MEASURED] `mode` is REQUIRED on /proxy/list/ — omitting it is an instant 400. */
const WEBSHARE_PROXY_LIST_MODE = "direct";
/** Proxy-list endpoints are rate-limited at 60 req/min per Webshare apidocs. */
const WEBSHARE_PROBE_TIMEOUT_MS = 10_000;
/** Pagination cap: 10 pages × 100 = 1000 proxies, far above a 30-proxy pool. */
const WEBSHARE_MAX_POOL_PAGES = 10;

/** SERVER-ONLY pool row (carries the proxy password). Never serialize/log/store. */
type WebshareProxyCredential = {
  id: string;
  proxyAddress?: string;
  port?: number;
  username?: string;
  country?: string;
  valid?: boolean;
  password?: string;
};

type RawProxyEnvelope = {
  count?: unknown;
  next?: unknown;
  previous?: unknown;
  results?: unknown;
};

function mapProxyCredential(raw: unknown): WebshareProxyCredential | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  // id is the only hard requirement; everything else degrades to undefined.
  if (r.id === undefined || r.id === null) return null;
  return {
    id: String(r.id),
    proxyAddress: typeof r.proxy_address === "string" ? r.proxy_address : undefined,
    port: typeof r.port === "number" ? r.port : undefined,
    username: typeof r.username === "string" ? r.username : undefined,
    country: typeof r.country_code === "string" ? r.country_code : undefined,
    valid: typeof r.valid === "boolean" ? r.valid : undefined,
    password: typeof r.password === "string" ? r.password : undefined,
  };
}

function webshareFailure(
  httpStatus: number | null,
  code: EgressErrorCode,
  message: string,
): { ok: false; httpStatus: number | null; code: EgressErrorCode; message: string } {
  // Static messages only — never forward upstream body text or the token (P7).
  return { ok: false, httpStatus, code, message };
}

function buildListUrl(page: number, pageSize: number): string {
  const qs = new URLSearchParams({
    mode: WEBSHARE_PROXY_LIST_MODE,
    page: String(page),
    page_size: String(pageSize),
  });
  return `${WEBSHARE_API_BASE}/proxy/list/?${qs.toString()}`;
}

async function fetchListPage(
  apiToken: string,
  page: number,
  pageSize: number,
): Promise<
  | { ok: true; count: number | null; next: string | null; results: WebshareProxyCredential[] }
  | { ok: false; httpStatus: number | null; code: EgressErrorCode; message: string }
> {
  let res: Response;
  try {
    res = await fetch(buildListUrl(page, pageSize), {
      headers: {
        // [MEASURED]: the Token scheme is recognized; Bearer is IGNORED by this API.
        Authorization: `Token ${apiToken}`,
        Accept: "application/json",
        "User-Agent": "NEXUS-WebGUI/0.2 (+egress layer r514)",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(WEBSHARE_PROBE_TIMEOUT_MS),
    });
  } catch {
    return webshareFailure(null, "NETWORK_ERROR", "Webshare API unreachable from this machine (network/timeout).");
  }

  if (res.status === 401) {
    return webshareFailure(401, "UNAUTHORIZED", "Webshare rejected the token (invalid or revoked).");
  }
  if (res.status === 403) {
    return webshareFailure(403, "FORBIDDEN", "Webshare refused access (suspended account or forbidden scope).");
  }
  if (res.status === 429) {
    return webshareFailure(429, "RATE_LIMITED", "Webshare rate limit hit (proxy-list endpoints: 60/min) — retry in ~60s.");
  }
  if (!res.ok) {
    // Includes 400: request-shape rejected upstream (e.g. a required query param).
    return webshareFailure(res.status, "API_ERROR", `Webshare API returned HTTP ${res.status}.`);
  }

  let body: RawProxyEnvelope;
  try {
    body = (await res.json()) as RawProxyEnvelope;
  } catch {
    return webshareFailure(res.status, "BAD_RESPONSE", "Webshare API replied 2xx but with an undecodable body.");
  }

  if (!Array.isArray(body.results)) {
    return webshareFailure(res.status, "BAD_RESPONSE", "Webshare API response has no results array — shape may have changed.");
  }

  const results = body.results
    .map(mapProxyCredential)
    .filter((p): p is WebshareProxyCredential => p !== null);

  return {
    ok: true,
    count: typeof body.count === "number" ? body.count : null,
    next: typeof body.next === "string" && body.next.length > 0 ? body.next : null,
    results,
  };
}

/**
 * SERVER-ONLY: page through the FULL pool (password included on each row) for
 * egress use. page_size=100 — [MEASURED] a 30-proxy pool arrives in one page.
 * Follows the `next` envelope up to WEBSHARE_MAX_POOL_PAGES. Aborts honestly
 * on the first failed page — no partial-pool success. Never throws.
 */
async function listAllProxies(
  apiToken: string,
): Promise<{ ok: true; count: number | null; results: WebshareProxyCredential[]; unusable: number } | { ok: false; code: EgressErrorCode; message: string }> {
  const pageSize = 100;
  const all: WebshareProxyCredential[] = [];
  let unusable = 0;
  let count: number | null = null;
  let next: string | null = null;

  for (let page = 1; page <= WEBSHARE_MAX_POOL_PAGES; page++) {
    const res = await fetchListPage(apiToken, page, pageSize);
    if (!res.ok) return { ok: false, code: res.code, message: res.message };

    count = res.count;
    next = res.next;
    for (const row of res.results) {
      // A row is only usable for egress when ALL connection fields exist.
      if (
        typeof row.proxyAddress === "string" &&
        typeof row.port === "number" &&
        typeof row.username === "string" &&
        typeof row.password === "string" &&
        row.proxyAddress.length > 0 &&
        row.username.length > 0
      ) {
        all.push(row);
      } else {
        unusable += 1;
      }
    }

    if (next === null) break; // envelope exhausted
  }

  return { ok: true, count, results: all, unusable };
}

// ---------------------------------------------------------------------------
// Token + routing KV (PlatformSetting)
// ---------------------------------------------------------------------------

/** Paste hygiene — shared by the card and the token route: trim + strip ONE wrapping-quote pair. */
export function sanitizePastedToken(raw: string): string {
  let t = raw.trim();
  if (t.length >= 2) {
    const first = t[0];
    const last = t[t.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      t = t.slice(1, -1).trim();
    }
  }
  return t;
}

async function readSetting(key: string): Promise<string | null> {
  try {
    const row = await db.platformSetting.findUnique({ where: { id: key } });
    return row?.value ?? null;
  } catch {
    return null;
  }
}

async function writeSetting(key: string, value: string): Promise<boolean> {
  try {
    await db.platformSetting.upsert({
      where: { id: key },
      update: { value },
      create: { id: key, value },
    });
    return true;
  } catch {
    return false;
  }
}

async function deleteSetting(key: string): Promise<void> {
  try {
    await db.platformSetting.deleteMany({ where: { id: key } });
  } catch {
    /* absent row = already cleared */
  }
}

/** SERVER-ONLY: the stored Webshare token, or null. Never leaves the process. */
export async function getWebshareToken(): Promise<string | null> {
  const raw = await readSetting(EGRESS_TOKEN_KEY);
  return raw && raw.length > 0 ? raw : null;
}

/** SERVER-ONLY: persist the (already paste-hygienic) token. False = write failed. */
export async function writeToken(token: string): Promise<boolean> {
  return writeSetting(EGRESS_TOKEN_KEY, token);
}

/** SERVER-ONLY: clear the stored token. */
export async function clearToken(): Promise<void> {
  await deleteSetting(EGRESS_TOKEN_KEY);
}

/** Masked last-4 preview — the ONLY token-shaped string any API may return. */
export function maskTokenPreview(token: string): string {
  const t = token.trim();
  return t.length >= 4 ? `••••${t.slice(-4)}` : "••••";
}

// ---------------------------------------------------------------------------
// Transport resolution
// ---------------------------------------------------------------------------

let transportPromise: Promise<EgressTransportName | null> | null = null;

async function detectTransport(): Promise<EgressTransportName | null> {
  // 1. undici package (Node runtimes that ship it as a dependency would use it).
  //    The specifier is built at runtime on purpose: TS must not resolve it
  //    (the package is optional and NOT installed in this project) and the
  //    bundler must not try to bundle it.
  try {
    const undiciSpecifier = ["un", "dici"].join("");
    const mod = (await import(undiciSpecifier)) as unknown as { ProxyAgent?: unknown };
    if (typeof mod.ProxyAgent === "function") return "undici";
  } catch {
    // not installed — expected on this project; fall through
  }
  // 2. Bun-native fetch with `proxy` option [MEASURED working against the pool].
  const bunGlobal = (globalThis as { Bun?: { fetch?: unknown } }).Bun;
  if (bunGlobal && typeof bunGlobal.fetch === "function") return "bun";
  // 3. node:net/node:tls CONNECT tunnel (always available under Node).
  if (typeof net.connect === "function" && typeof tls.connect === "function") return "tunnel";
  return null;
}

function resolveTransport(): Promise<EgressTransportName | null> {
  if (!transportPromise) transportPromise = detectTransport();
  return transportPromise;
}

/** Transport name for the status card — not a secret, purely operational honesty. */
export async function egressTransportName(): Promise<EgressTransportName | null> {
  return resolveTransport();
}

// ---------------------------------------------------------------------------
// CONNECT tunnel + raw HTTP/1.1 (the transport that actually runs under Node)
// ---------------------------------------------------------------------------

function parseChunkedBody(raw: string): string {
  // Minimal chunked decoder: hex size lines + data; stops at 0-chunk. Best-effort.
  let out = "";
  let i = 0;
  while (i < raw.length) {
    const lineEnd = raw.indexOf("\r\n", i);
    if (lineEnd === -1) break;
    const size = parseInt(raw.slice(i, lineEnd).split(";")[0].trim(), 16);
    if (!Number.isFinite(size) || size <= 0) break;
    out += raw.slice(lineEnd + 2, lineEnd + 2 + size);
    i = lineEnd + 2 + size + 2; // skip data + CRLF
  }
  return out;
}

function connectThroughProxy(
  proxy: EgressProxy,
  targetHost: string,
  targetPort: number,
  timeoutMs: number,
): Promise<net.Socket> {
  const parsed = new URL(proxy.url); // in-memory only; never logged (P7)
  const username = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);

  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: parsed.hostname, port: Number(parsed.port) || 80 });
    socket.setNoDelay(true);
    let buf = "";
    let settled = false;
    const auth = Buffer.from(`${username}:${password}`).toString("base64");

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      socket.setTimeout(0);
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
      socket.off("data", onData);
      fn();
    };
    const onError = (e: Error) => finish(() => { socket.destroy(); reject(e); });
    const onTimeout = () => finish(() => {
      socket.destroy();
      reject(Object.assign(new Error("proxy connect timed out"), { egressCode: "PROXY_TIMEOUT" as EgressErrorCode }));
    });
    const onData = (chunk: Buffer) => {
      buf += chunk.toString("latin1");
      const idx = buf.indexOf("\r\n\r\n");
      if (idx === -1) return;
      const statusLine = buf.slice(0, buf.indexOf("\r\n"));
      const m = /^HTTP\/1\.[01] (\d{3})/.exec(statusLine);
      const code = m ? Number(m[1]) : 0;
      if (!m) {
        finish(() => {
          socket.destroy();
          reject(Object.assign(new Error("unparseable proxy CONNECT response"), { egressCode: "UPSTREAM_BAD_RESPONSE" as EgressErrorCode }));
        });
        return;
      }
      if (code === 407) {
        finish(() => {
          socket.destroy();
          reject(Object.assign(new Error("proxy rejected credentials (CONNECT 407)"), { egressCode: "PROXY_AUTH_REJECTED" as EgressErrorCode, proxyStatus: code }));
        });
        return;
      }
      if (code !== 200) {
        finish(() => {
          socket.destroy();
          reject(Object.assign(new Error(`proxy refused CONNECT (status ${code})`), { egressCode: "PROXY_CONNECT_REFUSED" as EgressErrorCode, proxyStatus: code }));
        });
        return;
      }
      finish(() => resolve(socket));
    };

    socket.on("error", onError);
    socket.on("timeout", onTimeout);
    socket.on("data", onData);
    socket.on("connect", () => {
      socket.setTimeout(timeoutMs);
      socket.write(
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
          `Host: ${targetHost}:${targetPort}\r\n` +
          `Proxy-Authorization: Basic ${auth}\r\n\r\n`,
      );
    });
  });
}

type RawResponse = { status: number; headers: Record<string, string>; bodyText: string };

function sendRawOverSocket(socket: net.Socket, target: URL, init: EgressFetchInit, timeoutMs: number): Promise<RawResponse> {
  const body = typeof init.body === "string" ? init.body : "";
  const headers: Record<string, string> = {
    Host: target.host,
    Accept: "*/*",
    "User-Agent": "NEXUS-WebGUI/0.2 (+egress layer r514)",
    Connection: "close",
    ...(init.headers ?? {}),
  };
  if (body.length > 0 && !Object.keys(headers).some((h) => h.toLowerCase() === "content-length")) {
    headers["Content-Length"] = String(Buffer.byteLength(body, "utf8"));
  }

  const head =
    `${(init.method ?? "GET").toUpperCase()} ${target.pathname}${target.search} HTTP/1.1\r\n` +
    Object.entries(headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\r\n") +
    "\r\n\r\n";

  return new Promise((resolve, reject) => {
    let raw = "";
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      socket.setTimeout(0);
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
      fn();
    };
    const onError = (e: Error) => finish(() => {
      socket.destroy();
      reject(Object.assign(new Error("tunnel read failed"), { cause: e.message, egressCode: "UPSTREAM_BAD_RESPONSE" as EgressErrorCode }));
    });
    const onTimeout = () => finish(() => {
      socket.destroy();
      reject(Object.assign(new Error("upstream timed out over tunnel"), { egressCode: "UPSTREAM_TIMEOUT" as EgressErrorCode }));
    });
    const onData = (chunk: Buffer) => {
      raw += chunk.toString("latin1");
      if (raw.length > MAX_BODY_BYTES) finish(() => {
        socket.destroy();
        reject(Object.assign(new Error("upstream response exceeded body cap"), { egressCode: "UPSTREAM_BAD_RESPONSE" as EgressErrorCode }));
      });
    };

    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("timeout", onTimeout);
    socket.once("close", () => {
      finish(() => {
        const sep = raw.indexOf("\r\n\r\n");
        if (sep === -1) {
          reject(Object.assign(new Error("no HTTP response received over tunnel"), { egressCode: "UPSTREAM_BAD_RESPONSE" as EgressErrorCode }));
          return;
        }
        const headBlock = raw.slice(0, sep);
        const lines = headBlock.split("\r\n");
        const status = Number((/^HTTP\/1\.[01] (\d{3})/.exec(lines[0] ?? "") ?? [])[1] ?? 0);
        if (!status) {
          reject(Object.assign(new Error("unparseable upstream status line"), { egressCode: "UPSTREAM_BAD_RESPONSE" as EgressErrorCode }));
          return;
        }
        const headers: Record<string, string> = {};
        for (const line of lines.slice(1)) {
          const c = line.indexOf(":");
          if (c > 0) headers[line.slice(0, c).trim().toLowerCase()] = line.slice(c + 1).trim();
        }
        let bodyText = raw.slice(sep + 4);
        if ((headers["transfer-encoding"] ?? "").includes("chunked")) bodyText = parseChunkedBody(bodyText);
        resolve({ status, headers, bodyText });
      });
    });

    socket.setTimeout(timeoutMs);
    socket.write(head + body);
  });
}

async function tunnelFetch(
  proxy: EgressProxy,
  target: URL,
  init: EgressFetchInit,
  timeoutMs: number,
): Promise<EgressHttpResponse> {
  const isTls = target.protocol === "https:";
  const port = Number(target.port) || (isTls ? 443 : 80);
  const socket = await connectThroughProxy(proxy, target.hostname, port, timeoutMs);

  try {
    if (!isTls) {
      // Plain-HTTP target: the tunnel already ends at the target — send raw HTTP.
      const r = await sendRawOverSocket(socket, target, init, timeoutMs);
      return { ...r, via: "tunnel" };
    }

    return await new Promise<EgressHttpResponse>((resolve, reject) => {
      const tlsSocket = tls.connect({
        socket,
        servername: target.hostname,
        rejectUnauthorized: true,
        ALPNProtocols: ["http/1.1"],
      });
      const tlsFail = (e: Error) => {
        socket.destroy();
        tlsSocket.destroy();
        reject(Object.assign(new Error("TLS through tunnel failed"), { cause: e.message, egressCode: "TUNNEL_TLS_FAILED" as EgressErrorCode }));
      };
      tlsSocket.once("error", tlsFail);
      tlsSocket.once("secureConnect", () => {
        tlsSocket.off("error", tlsFail);
        sendRawOverSocket(tlsSocket, target, init, timeoutMs)
          .then((r) => {
            tlsSocket.destroy();
            socket.destroy();
            resolve({ ...r, via: "tunnel" });
          })
          .catch((e: Error & { egressCode?: EgressErrorCode }) => {
            tlsSocket.destroy();
            socket.destroy();
            reject(Object.assign(e, { egressCode: e.egressCode ?? "UPSTREAM_BAD_RESPONSE" }));
          });
      });
    });
  } catch (e) {
    socket.destroy();
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Streaming tunnel transport (r514) — SSE-capable Response over the CONNECT
// tunnel. The buffered tunnelFetch above is probe-grade (256KB cap, whole-body
// decode); LLM dials need incremental streaming, so this variant reuses the
// PROVEN connectThroughProxy, then streams the raw HTTP/1.1 body through an
// on-the-fly chunked decoder into a web ReadableStream. Dependency-free.
// ---------------------------------------------------------------------------

/** Hard ceiling for a streamed tunnel body (runaway-upstream guard). */
const MAX_STREAM_BYTES = 8 * 1024 * 1024;

type TunnelHead = { status: number; headers: Record<string, string>; rest: Buffer };

function readTunnelHead(socket: net.Socket, timeoutMs: number): Promise<TunnelHead> {
  return new Promise<TunnelHead>((resolve, reject) => {
    let buf = Buffer.alloc(0);
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      socket.setTimeout(0);
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
      fn();
    };
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const sep = buf.indexOf("\r\n\r\n");
      if (sep === -1) {
        if (buf.length > 256 * 1024) {
          finish(() => {
            socket.destroy();
            reject(new Error("tunnel header block exceeded 256KB"));
          });
        }
        return;
      }
      const headText = buf.slice(0, sep).toString("latin1");
      const rest = buf.slice(sep + 4);
      const lines = headText.split("\r\n");
      const status = Number((/^HTTP\/1\.[01] (\d{3})/.exec(lines[0] ?? "") ?? [])[1] ?? 0);
      if (!status) {
        finish(() => {
          socket.destroy();
          reject(new Error("unparseable upstream status line over tunnel"));
        });
        return;
      }
      const headers: Record<string, string> = {};
      for (const line of lines.slice(1)) {
        const c = line.indexOf(":");
        if (c > 0) headers[line.slice(0, c).trim().toLowerCase()] = line.slice(c + 1).trim();
      }
      finish(() => resolve({ status, headers, rest }));
    };
    const onError = (e: Error) => finish(() => {
      socket.destroy();
      reject(Object.assign(new Error("tunnel read failed before headers"), { cause: e.message }));
    });
    const onClose = () => finish(() => {
      socket.destroy();
      reject(new Error("tunnel closed before any header arrived"));
    });
    const onTimeout = () => finish(() => {
      socket.destroy();
      reject(new Error("upstream sent no response header in time over tunnel"));
    });

    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("close", onClose);
    socket.on("timeout", onTimeout);
    socket.setTimeout(timeoutMs);
  });
}

async function tunnelFetchStreaming(
  proxy: EgressProxy,
  target: URL,
  init: RequestInit | undefined,
  headerTimeoutMs: number,
): Promise<Response> {
  const isTls = target.protocol === "https:";
  const port = Number(target.port) || (isTls ? 443 : 80);
  const socket = await connectThroughProxy(proxy, target.hostname, port, headerTimeoutMs);

  try {
    const body = typeof init?.body === "string" ? init.body : "";
    const reqHeaders: Record<string, string> = {
      Host: target.host,
      Accept: "*/*",
      "User-Agent": "NEXUS-WebGUI/0.2 (+egress streaming r514)",
      Connection: "close",
      ...((init?.headers ?? {}) as Record<string, string>),
    };
    if (body.length > 0 && !Object.keys(reqHeaders).some((h) => h.toLowerCase() === "content-length")) {
      reqHeaders["Content-Length"] = String(Buffer.byteLength(body, "utf8"));
    }
    const reqHead =
      `${(init?.method ?? "GET").toUpperCase()} ${target.pathname}${target.search} HTTP/1.1\r\n` +
      Object.entries(reqHeaders)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\r\n") +
      "\r\n\r\n";
    socket.write(reqHead + body);

    const { status, headers, rest } = await readTunnelHead(socket, headerTimeoutMs);

    // Rebuild Response headers WITHOUT the framing fields (the Response owns
    // its framing; a stale content-length/chunked marker would corrupt it).
    const resHeaders = new Headers();
    for (const [k, v] of Object.entries(headers)) {
      if (["transfer-encoding", "content-length", "connection", "keep-alive"].includes(k)) continue;
      resHeaders.set(k, v);
    }

    const chunked = (headers["transfer-encoding"] ?? "").includes("chunked");
    let received = 0;
    let socketDead = false;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let buf = Buffer.from(rest);
        let needSize = true; // chunked state: reading a size line vs data+CRLF
        let dataSize = -1;
        let ended = false;

        const fail = (msg: string) => {
          if (ended) return;
          ended = true;
          socket.destroy();
          try {
            controller.error(Object.assign(new Error(msg), { egressCode: "UPSTREAM_BAD_RESPONSE" as EgressErrorCode }));
          } catch {
            /* already errored/closed */
          }
        };
        const end = () => {
          if (ended) return;
          ended = true;
          socket.destroy();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };
        const enqueue = (b: Buffer) => {
          received += b.length;
          if (received > MAX_STREAM_BYTES) {
            fail("tunnel stream exceeded the 8MB body cap");
            return;
          }
          try {
            controller.enqueue(new Uint8Array(b));
          } catch {
            end();
          }
        };
        const pump = () => {
          if (ended) return;
          if (!chunked) {
            if (buf.length > 0) {
              const out = buf;
              buf = Buffer.alloc(0);
              enqueue(out);
              if (ended) return;
            }
            return;
          }
          while (!ended) {
            if (needSize) {
              const i = buf.indexOf("\r\n");
              if (i === -1) return;
              const size = parseInt(buf.slice(0, i).toString("latin1").split(";")[0].trim(), 16);
              buf = buf.slice(i + 2);
              if (!Number.isFinite(size) || size <= 0) {
                end();
                return;
              }
              dataSize = size;
              needSize = false;
            } else {
              const need = dataSize + 2; // data + trailing CRLF
              if (buf.length < need) return;
              enqueue(buf.slice(0, dataSize));
              buf = buf.slice(need);
              dataSize = -1;
              needSize = true;
            }
          }
        };

        const onData = (chunk: Buffer) => {
          buf = Buffer.concat([buf, chunk]);
          pump();
        };
        const onAbort = () => {
          socketDead = true;
          fail("tunnel stream aborted");
        };
        socket.on("data", onData);
        socket.on("error", () => {
          socketDead = true;
          if (ended) return;
          // Connection: close semantics — data delivered so far is honest; a
          // mid-stream socket death with pending bytes is a bad response.
          fail("tunnel socket error mid-stream");
        });
        socket.on("close", () => {
          socketDead = true;
          // Non-chunked bodies end at close; chunked must have seen the 0-chunk.
          if (!ended && !chunked) end();
          else if (!ended) fail("tunnel closed before the chunked body finished");
        });
        if (init?.signal) {
          if (init.signal.aborted) onAbort();
          else init.signal.addEventListener("abort", onAbort, { once: true });
        }
        // Generous idle guard — the engine's own first-token/inter-chunk
        // budgets govern responsiveness; this only reaps truly dead sockets.
        socket.setTimeout(120_000);
        socket.once("timeout", () => {
          socketDead = true;
          fail("tunnel idle timeout (120s without bytes)");
        });
        void socketDead;
        pump();
      },
      cancel() {
        socket.destroy();
      },
    });

    return new Response(stream, { status, headers: resHeaders });
  } catch (e) {
    socket.destroy();
    if (e instanceof EgressDialError) throw e;
    const err = e as Error;
    throw new EgressDialError(
      /timed out|in time/.test(err.message) ? "UPSTREAM_TIMEOUT" : "UPSTREAM_BAD_RESPONSE",
      `Egress pool streaming dial failed over the tunnel: ${err.message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// undici + bun transports
// ---------------------------------------------------------------------------

const undiciAgents = new Map<string, unknown>();

async function undiciFetch(proxy: EgressProxy, target: URL, init: EgressFetchInit, timeoutMs: number): Promise<EgressHttpResponse> {
  const undiciSpecifier = ["un", "dici"].join("");
  const mod = (await import(undiciSpecifier)) as unknown as {
    ProxyAgent: new (uri: string) => unknown;
  };
  let agent = undiciAgents.get(proxy.id) as object | undefined;
  if (!agent) {
    agent = new mod.ProxyAgent(proxy.url) as object;
    if (undiciAgents.size >= 32) undiciAgents.clear();
    undiciAgents.set(proxy.id, agent);
  }
  const initExt = {
    method: init.method ?? "GET",
    headers: init.headers,
    body: init.body,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
    dispatcher: agent,
  } as RequestInit & { dispatcher?: unknown };
  const res = await fetch(target, initExt);
  const bodyText = (await res.text()).slice(0, MAX_BODY_BYTES);
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  return { status: res.status, headers, bodyText, via: "undici" };
}

function bunFetch(proxy: EgressProxy, target: URL, init: EgressFetchInit, timeoutMs: number): Promise<EgressHttpResponse | EgressHttpFailure> {
  const bfetch = (globalThis as { Bun?: { fetch?: (u: URL, i: Record<string, unknown>) => Promise<Response> } }).Bun?.fetch;
  if (typeof bfetch !== "function") {
    return Promise.resolve({
      code: "PROXY_TRANSPORT_UNAVAILABLE",
      message: "bun runtime not present — cannot use native proxy fetch.",
      via: null,
    });
  }
  return bfetch(target, {
    method: init.method ?? "GET",
    headers: init.headers,
    body: init.body,
    proxy: proxy.url,
    signal: AbortSignal.timeout(timeoutMs),
  }).then(async (res) => {
    const bodyText = (await res.text()).slice(0, MAX_BODY_BYTES);
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    return { status: res.status, headers, bodyText, via: "bun" as const };
  });
}

// ---------------------------------------------------------------------------
// Public fetch surface
// ---------------------------------------------------------------------------

export type EgressFetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

/** Direct (sandbox egress) fetch with the same envelope as proxiedFetch. */
export async function directFetch(target: string, init: EgressFetchInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<EgressHttpResponse | EgressHttpFailure> {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return { code: "UPSTREAM_BAD_RESPONSE", message: "target URL is invalid", via: null };
  }
  try {
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: init.headers,
      body: init.body,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const bodyText = (await res.text()).slice(0, MAX_BODY_BYTES);
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    return { status: res.status, headers, bodyText, via: "direct" };
  } catch {
    return {
      code: "UNREACHABLE_FROM_SANDBOX",
      message: "target did not answer from the sandbox egress (network/WAF drop) — this is never a key problem.",
      via: "direct",
    };
  }
}

/**
 * Route one request through a chosen pool proxy. Tries the resolved transport;
 * typed failures when the proxy itself cannot be used. Upstream statuses pass
 * through untouched (honesty — we never convert HTTP answers into transport
 * failures).
 */
export async function proxiedFetch(
  target: string,
  init: EgressFetchInit,
  opts: { proxy: EgressProxy; timeoutMs?: number },
): Promise<EgressHttpResponse | EgressHttpFailure> {
  const transport = await resolveTransport();
  if (!transport) {
    return {
      code: "PROXY_TRANSPORT_UNAVAILABLE",
      message: "no usable proxy transport in this runtime (undici/bun/tunnel all unavailable).",
      via: null,
    };
  }
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return { code: "UPSTREAM_BAD_RESPONSE", message: "target URL is invalid", via: null };
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    if (transport === "undici") return await undiciFetch(opts.proxy, url, init, timeoutMs);
    if (transport === "bun") return await bunFetch(opts.proxy, url, init, timeoutMs);
    return await tunnelFetch(opts.proxy, url, init, timeoutMs);
  } catch (e) {
    const err = e as Error & { egressCode?: EgressErrorCode; proxyStatus?: number; cause?: string };
    const code: EgressErrorCode = err.egressCode ?? "PROXY_CONNECT_REFUSED";
    return {
      code,
      message:
        code === "PROXY_TIMEOUT"
          ? "pool proxy did not complete CONNECT in time."
          : code === "PROXY_AUTH_REJECTED"
            ? "pool proxy rejected the credentials (CONNECT 407)."
            : code === "TUNNEL_TLS_FAILED"
              ? "TLS handshake to the target through the tunnel failed."
              : "pool proxy could not establish the tunnel.",
      via: "tunnel",
      proxyStatus: err.proxyStatus,
    };
  }
}

// ---------------------------------------------------------------------------
// Pool loading (PlatformSetting token → Webshare → in-memory URLs)
// ---------------------------------------------------------------------------

type PoolCache = {
  pool: EgressProxy[];
  count: number | null;
  unusable: number;
  loadedAt: number;
};

let poolCache: PoolCache | null = null;
let poolCachePromise: Promise<LoadEgressPoolResult> | null = null;
const POOL_CACHE_TTL_MS = 60_000;

export type LoadEgressPoolResult =
  | { ok: true; pool: EgressProxy[]; count: number | null; unusable: number; loadedAt: string }
  | { ok: false; code: EgressErrorCode; message: string };

/** Purge the in-memory pool cache (token save/clear routes call this). */
export function purgeEgressPoolCache(): void {
  poolCache = null;
  poolCachePromise = null;
}

/**
 * Load the proxy pool through the Webshare API (PlatformSetting token). Rows
 * are reduced to in-memory connection URLs — transient in-process only
 * (≤60 s TTL), never cached to disk, never logged. Uses a shared in-flight
 * promise so concurrent callers cannot stampede the 60 req/min Webshare budget.
 */
export async function loadEgressPool(opts: { forceRefresh?: boolean } = {}): Promise<LoadEgressPoolResult> {
  if (!opts.forceRefresh && poolCache && Date.now() - poolCache.loadedAt < POOL_CACHE_TTL_MS) {
    return {
      ok: true,
      pool: poolCache.pool,
      count: poolCache.count,
      unusable: poolCache.unusable,
      loadedAt: new Date(poolCache.loadedAt).toISOString(),
    };
  }
  if (poolCachePromise) return poolCachePromise;

  poolCachePromise = (async (): Promise<LoadEgressPoolResult> => {
    const apiToken = await getWebshareToken();
    if (!apiToken) {
      return { ok: false, code: "NOT_CONFIGURED", message: "no Webshare token stored — save it on the Egress card first." };
    }

    const poolPage = await listAllProxies(apiToken);
    if (!poolPage.ok) {
      return { ok: false, code: poolPage.code, message: poolPage.message };
    }

    const pool: EgressProxy[] = [];
    for (const c of poolPage.results) {
      if (
        typeof c.proxyAddress !== "string" ||
        typeof c.port !== "number" ||
        typeof c.username !== "string" ||
        typeof c.password !== "string" ||
        c.proxyAddress.length === 0 ||
        c.username.length === 0
      ) {
        continue;
      }
      pool.push({
        id: c.id,
        // Built in-memory only (P7). encodeURIComponent keeps the URL parseable
        // even if the credential contains reserved characters.
        url: `http://${encodeURIComponent(c.username)}:${encodeURIComponent(c.password)}@${c.proxyAddress}:${c.port}`,
        port: c.port,
        country: c.country ?? null,
        valid: c.valid ?? null,
      });
    }

    poolCache = { pool, count: poolPage.count, unusable: poolPage.unusable, loadedAt: Date.now() };
    return {
      ok: true,
      pool,
      count: poolPage.count,
      unusable: poolPage.unusable,
      loadedAt: new Date(poolCache.loadedAt).toISOString(),
    };
  })();

  try {
    return await poolCachePromise;
  } finally {
    poolCachePromise = null;
  }
}

/** UI-safe pool summary — counts/booleans/countries only (P7). */
export function summarizePool(pool: EgressProxy[]): { count: number; validCount: number; countries: string[] } {
  const countries = [...new Set(pool.map((p) => p.country).filter((c): c is string => typeof c === "string"))].sort();
  return {
    count: pool.length,
    validCount: pool.filter((p) => p.valid === true).length,
    countries,
  };
}

/** Pick up to `n` pool proxies for probing — valid ones first, stable order (no identity leaves the process). */
export function pickProxies(pool: EgressProxy[], n: number): EgressProxy[] {
  const valid = pool.filter((p) => p.valid === true);
  const rest = pool.filter((p) => p.valid !== true);
  return [...valid, ...rest].slice(0, Math.max(1, n));
}

// ---------------------------------------------------------------------------
// Routing registry (PlatformSetting `egress.routing`)
// ---------------------------------------------------------------------------

function sanitizeRoutingMap(raw: unknown): Record<string, EgressMode> {
  const out: Record<string, EgressMode> = {};
  if (typeof raw !== "object" || raw === null) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== "string" || !/^[a-z0-9-]{1,64}$/.test(k)) continue;
    if (v === "direct" || v === "pool") out[k] = v;
  }
  return out;
}

/** Read the `egress.routing` KV map. Default (missing/corrupt): {} → every upstream is direct. */
export async function readRoutingMap(): Promise<Record<string, EgressMode>> {
  const raw = await readSetting(EGRESS_ROUTING_KEY);
  if (!raw) return {};
  try {
    return sanitizeRoutingMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

/** Merge one upstream decision into the persisted map. False = write failed. */
export async function writeRoutingMap(upstream: string, mode: EgressMode): Promise<boolean> {
  const current = await readRoutingMap();
  const next: Record<string, EgressMode> = { ...current, [upstream]: mode };
  // Drop explicit "direct" entries — absent = direct, keeps the map minimal.
  if (mode === "direct") delete next[upstream];
  return writeSetting(EGRESS_ROUTING_KEY, JSON.stringify(next));
}

/** Resolve the mode for one target: map[target] ?? "direct". */
export function routeFor(upstream: string, map: Record<string, EgressMode>): EgressMode {
  return map[upstream] ?? "direct";
}

/** Map a dialed URL host to a routing key (relay hook). Unknown hosts → "generic". */
export function upstreamKeyForUrl(url: string): EgressUpstreamKey {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "generic";
  }
  if (host.includes("groq")) return "groq";
  if (host.includes("vyce")) return "vyce";
  if (host.includes("openai")) return "openai";
  return "generic";
}

// ---------------------------------------------------------------------------
// Honest classification
// ---------------------------------------------------------------------------

/**
 * Classify an upstream answer. RULES (honesty contract):
 * - no HTTP answer at all → UNREACHABLE_FROM_SANDBOX (NEVER "key rejected").
 * - 401 → KEY_REJECTED (the upstream answered and rejected auth — it IS reachable).
 * - 403 → UNREACHABLE_WAF (answered, but access is refused at the edge — e.g.
 *   Groq from the sandbox egress IP [MEASURED]).
 */
export function classifyEgress(status: number | null): { classification: EgressClassification; reachable: boolean } {
  if (status === null) return { classification: "UNREACHABLE_FROM_SANDBOX", reachable: false };
  if (status >= 200 && status < 300) return { classification: "OK", reachable: true };
  if (status === 401) return { classification: "KEY_REJECTED", reachable: true };
  if (status === 403) return { classification: "UNREACHABLE_WAF", reachable: true };
  if (status === 404) return { classification: "NOT_FOUND", reachable: true };
  if (status === 429) return { classification: "RATE_LIMITED", reachable: true };
  if (status >= 500) return { classification: "UPSTREAM_ERROR", reachable: true };
  return { classification: "HTTP_OTHER", reachable: true };
}

/**
 * Cloudflare-trace helper for the generic target: returns the `loc=` country
 * code ONLY. Every other line (notably `ip=…`) is discarded and must never be
 * echoed anywhere (P7).
 */
export function parseTraceCountry(bodyText: string): string | null {
  const m = /^loc=([A-Za-z]{2})$/m.exec(bodyText);
  return m ? m[1].toUpperCase() : null;
}

// ---------------------------------------------------------------------------
// egressFetch — routing-aware fetch with honest classification
// ---------------------------------------------------------------------------

export type EgressFetchResult =
  | {
      ok: true;
      status: number;
      classification: EgressClassification;
      loc: string | null;
      via: "direct" | EgressTransportName;
      bodyText: string;
    }
  | {
      ok: false;
      code: EgressErrorCode | EgressClassification;
      classification: EgressClassification;
      message: string;
      hint?: string;
      attempts?: number;
    };

/**
 * One routed fetch for an upstream key. Reads the routing map; "pool" tries up
 * to MAX_PROXY_ATTEMPTS pool proxies (first HTTP answer wins — a 401 is an
 * upstream answer and NEVER fails over), anything else / no token goes direct.
 * Proxy-transport failures stay typed PROXY_* — never reported as key errors.
 */
export async function egressFetch(
  url: string,
  init: EgressFetchInit,
  upstreamKey: string,
  opts: { timeoutMs?: number; proxyTimeoutMs?: number } = {},
): Promise<EgressFetchResult> {
  const map = await readRoutingMap();
  const mode = routeFor(upstreamKey, map);
  if (mode !== "pool") {
    const r = await directFetch(url, init, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if ("status" in r) {
      const cls = classifyEgress(r.status);
      return {
        ok: true,
        status: r.status,
        classification: cls.classification,
        loc: r.status === 200 ? parseTraceCountry(r.bodyText) : null,
        via: r.via,
        bodyText: r.bodyText,
      };
    }
    return {
      ok: false,
      code: r.code,
      classification: "UNREACHABLE_FROM_SANDBOX",
      message: r.message,
    };
  }

  // pool mode
  const poolLoad = await loadEgressPool();
  if (!poolLoad.ok) {
    // Honest: pool was asked for but is unusable. NOT_CONFIGURED means the
    // owner has no token yet → fail open to direct (byte-identical default).
    if (poolLoad.code === "NOT_CONFIGURED") {
      const r = await directFetch(url, init, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      if ("status" in r) {
        const cls = classifyEgress(r.status);
        return {
          ok: true,
          status: r.status,
          classification: cls.classification,
          loc: r.status === 200 ? parseTraceCountry(r.bodyText) : null,
          via: r.via,
          bodyText: r.bodyText,
        };
      }
      return { ok: false, code: r.code, classification: "UNREACHABLE_FROM_SANDBOX", message: r.message };
    }
    return {
      ok: false,
      code: poolLoad.code,
      classification: "PROXY_POOL_FAILED",
      message: poolLoad.message,
    };
  }

  const candidates = pickProxies(poolLoad.pool, MAX_PROXY_ATTEMPTS);
  let lastFailure: { code: string; message: string } | null = null;
  for (let i = 0; i < candidates.length; i++) {
    const res = await proxiedFetch(url, init, { proxy: candidates[i], timeoutMs: opts.proxyTimeoutMs ?? 9_000 });
    if ("status" in res) {
      const cls = classifyEgress(res.status);
      return {
        ok: true,
        status: res.status,
        classification: cls.classification,
        loc: res.status === 200 ? parseTraceCountry(res.bodyText) : null,
        via: res.via,
        bodyText: res.bodyText,
      };
    }
    lastFailure = { code: res.code, message: res.message };
  }
  return {
    ok: false,
    code: "PROXY_FAILED",
    classification: "PROXY_FAILED",
    message: lastFailure?.message ?? "pool produced no usable proxy.",
    attempts: candidates.length,
  };
}

// ---------------------------------------------------------------------------
// Streaming relay dial (LLM engine hook) — Response-compatible
// ---------------------------------------------------------------------------

/** Typed dial failure — message is static and UI-safe (no hosts/credentials). */
export class EgressDialError extends Error {
  readonly code: EgressErrorCode;
  constructor(code: EgressErrorCode, message: string) {
    super(message);
    this.name = "EgressDialError";
    this.code = code;
  }
}

/**
 * The server-side LLM dial the relay engine (agent-engine.ts) and the
 * automation executor use, egress-aware:
 * - routing "direct" / no routing / NO TOKEN → plain fetch (byte-identical
 *   default; the fail-open doctrine).
 * - routing "pool" → Bun-native proxy fetch or undici ProxyAgent (both return
 *   a real streaming Response). The CONNECT tunnel is probe-only (256KB
 *   buffered cap) — a streaming dial under a tunnel-only runtime fails with a
 *   typed, honest PROXY_TRANSPORT_UNAVAILABLE instead of silently going direct.
 * - pool broken while a token IS stored → typed EgressDialError (rotation
 *   upstream picks the next lane; the real cause stays visible).
 */
export async function egressRelayDial(url: string, init?: RequestInit): Promise<Response> {
  let routing: Record<string, EgressMode> = {};
  try {
    routing = await readRoutingMap();
  } catch {
    routing = {};
  }
  if (routeFor(upstreamKeyForUrl(url), routing) !== "pool") {
    return fetch(url, init);
  }

  const token = await getWebshareToken();
  if (!token) {
    // No token = the pool cannot exist → the configured routing is inert.
    // Fail open to direct (same decision egressFetch makes).
    return fetch(url, init);
  }

  const poolLoad = await loadEgressPool();
  if (!poolLoad.ok) {
    throw new EgressDialError(poolLoad.code, `Egress pool unavailable: ${poolLoad.message}`);
  }
  if (poolLoad.pool.length === 0) {
    throw new EgressDialError("PROXY_POOL_FAILED", "Egress pool is empty — no usable proxies were returned by Webshare.");
  }

  const transport = await resolveTransport();
  const proxy = pickProxies(poolLoad.pool, 1)[0];
  if (transport === "bun") {
    const bfetch = (globalThis as { Bun?: { fetch?: typeof fetch } }).Bun?.fetch;
    if (typeof bfetch === "function") {
      try {
        return await bfetch(url, { ...init, proxy: proxy.url } as RequestInit & { proxy: string });
      } catch (e) {
        // Cancel/timeouts keep their own identity — only real transport deaths
        // become typed dial failures.
        const name = e instanceof Error ? e.name : "";
        if (name === "AbortError" || name === "TimeoutError") throw e;
        throw new EgressDialError("PROXY_CONNECT_REFUSED", "Egress pool proxy could not carry the dial (bun transport failed).");
      }
    }
  }
  if (transport === "undici") {
    try {
      const undiciSpecifier = ["un", "dici"].join("");
      const mod = (await import(undiciSpecifier)) as unknown as {
        ProxyAgent: new (uri: string) => unknown;
      };
      let agent = undiciAgents.get(proxy.id) as object | undefined;
      if (!agent) {
        agent = new mod.ProxyAgent(proxy.url) as object;
        if (undiciAgents.size >= 32) undiciAgents.clear();
        undiciAgents.set(proxy.id, agent);
      }
      return await fetch(url, { ...init, dispatcher: agent } as RequestInit & { dispatcher: unknown });
    } catch (e) {
      if (e instanceof EgressDialError) throw e;
      const name = e instanceof Error ? e.name : "";
      if (name === "AbortError" || name === "TimeoutError") throw e;
      throw new EgressDialError("PROXY_CONNECT_REFUSED", "Egress pool proxy could not carry the dial (undici transport failed).");
    }
  }
  if (transport === "tunnel") {
    // r514: the CONNECT tunnel is the portable transport in this runtime —
    // the streaming variant carries SSE dials with the same proven CONNECT
    // handshake, so pool routing actually WORKS here instead of dying.
    return tunnelFetchStreaming(proxy, new URL(url), init, 10_000);
  }
  throw new EgressDialError(
    "PROXY_TRANSPORT_UNAVAILABLE",
    "no usable proxy transport in this runtime (undici/bun/tunnel all unavailable) — the dial was NOT silently sent direct.",
  );
}

// ---------------------------------------------------------------------------
// probeEgress — honest direct-vs-pool comparison
// ---------------------------------------------------------------------------

const MAX_PROXY_ATTEMPTS = 3;

export type EgressProbeLeg =
  | { ok: true; status: number; loc: string | null; via: string }
  | { ok: false; code: string; message: string; attempts?: number };

export type EgressProbeTargetResult = {
  target: EgressProbeTarget;
  direct: EgressProbeLeg;
  pool: EgressProbeLeg & { egressChanged: boolean };
};

export type EgressProbeOutcome = {
  checkedAt: string;
  transport: EgressTransportName | null;
  poolConfigured: boolean;
  poolCount: number | null;
  targets: EgressProbeTargetResult[];
};

function legFromResult(res: EgressFetchResult, kind: "status" | "country"): EgressProbeLeg {
  if (res.ok) {
    return {
      ok: true,
      status: res.status,
      loc: kind === "country" && res.status === 200 ? parseTraceCountry(res.bodyText) : null,
      via: res.via,
    };
  }
  return { ok: false, code: res.code, message: res.message, attempts: res.attempts };
}

/**
 * Probe every target direct vs pool (up to 3 pool proxies each). Targets run
 * in parallel; within a target the pool leg walks its candidates sequentially.
 * Honest result shape only — statuses, country codes and typed failures
 * (never bodies, never IPs, never proxy identities).
 */
export async function probeEgress(): Promise<EgressProbeOutcome> {
  const checkedAt = new Date().toISOString();
  const transport = await egressTransportName();
  const poolLoad = await loadEgressPool();
  const poolConfigured = poolLoad.ok;
  const poolCount = poolLoad.ok ? poolLoad.count : null;

  const entries = Object.entries(EGRESS_PROBE_TARGETS) as [EgressProbeTarget, { url: string; kind: "status" | "country" }][];

  const results = await Promise.all(
    entries.map(async ([target, conf]): Promise<EgressProbeTargetResult> => {
      const [directRes, poolRes] = await Promise.all([
        egressFetch(conf.url, { headers: { Accept: "application/json" } }, target, { timeoutMs: 7_000 }),
        // The pool leg asks for pool routing regardless of the routing map —
        // a probe is exactly the moment the owner checks whether pool works.
        (async (): Promise<EgressFetchResult> => {
          if (!poolLoad.ok) {
            return {
              ok: false,
              code: poolLoad.code,
              classification: "PROXY_POOL_FAILED",
              message: poolLoad.message,
            };
          }
          const candidates = pickProxies(poolLoad.pool, MAX_PROXY_ATTEMPTS);
          let lastFailure: { code: string; message: string } | null = null;
          for (const proxy of candidates) {
            const res = await proxiedFetch(conf.url, { headers: { Accept: "application/json" } }, { proxy, timeoutMs: 4_000 });
            if ("status" in res) {
              const cls = classifyEgress(res.status);
              return {
                ok: true,
                status: res.status,
                classification: cls.classification,
                loc: conf.kind === "country" && res.status === 200 ? parseTraceCountry(res.bodyText) : null,
                via: res.via,
                bodyText: res.bodyText,
              };
            }
            lastFailure = { code: res.code, message: res.message };
          }
          return {
            ok: false,
            code: "PROXY_FAILED",
            classification: "PROXY_FAILED",
            message: lastFailure?.message ?? "pool produced no usable proxy.",
            attempts: candidates.length,
          };
        })(),
      ]);

      const direct = legFromResult(directRes, conf.kind);
      const pool = legFromResult(poolRes, conf.kind);

      // Honest egressChanged: both sides answered AND the upstream conversation
      // differs (status or country), or direct was unreachable while pool answered.
      const directAnswered = direct.ok;
      const poolAnswered = pool.ok;
      const egressChanged =
        (directAnswered &&
          poolAnswered &&
          (direct.status !== pool.status || (direct.loc !== null && pool.loc !== null && direct.loc !== pool.loc))) ||
        (!directAnswered && poolAnswered);

      return { target, direct, pool: { ...pool, egressChanged } };
    }),
  );

  return {
    checkedAt,
    transport,
    poolConfigured,
    poolCount,
    targets: results,
  };
}
