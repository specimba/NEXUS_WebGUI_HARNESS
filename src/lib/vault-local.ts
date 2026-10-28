// ─── r380: shared localhost guard for every raw-key vault surface ────────────
// Extracted verbatim from /api/vault/consume (r138) so the export/import
// backup route enforces the SAME trust model with ONE definition — the
// r378 doctrine (HEARTBEAT_STALE_MS): constants that must never drift are
// defined exactly once and imported everywhere.
//
// Trust model (honest, unchanged from r138): vault keys already sit in
// plaintext in this machine's SQLite — any same-host process can read them
// directly. Serving them over localhost HTTP adds no new exposure. This
// guard is defense-in-depth against ACCIDENTAL remote exposure (proxy pass-
// through, LAN clients), not auth; deliberate exposure beyond localhost
// must add real auth. Guard limits: a same-LAN client can still spoof
// `Host` — documented, accepted, and re-documented on every consuming route.
//
// r707 Tier 2 — the preview-gateway pass: this sandbox serves the app to
// the user's browser through a NON-LOCAL gateway host (the preview proxy),
// and Tier 1's "non-local host" rejection refused exactly that traffic —
// the user's own Backup/Restore/Test buttons 403'd on the one host they
// actually use. Tier 2 admits a non-local caller only through the r321
// browser double-gate (proven on /api/vault/consume since r321): a foreign
// page cannot attach `x-nexus-csrf` without a CORS preflight this app
// never grants, and `sec-fetch-site: cross-site` is rejected outright —
// so the drive-by threat the guard exists for stays stopped cold. A
// headerless non-browser caller gets NO Tier-2 pass (the CLI branch is a
// localhost-machine trust): past the gateway, the caller must present the
// full browser shape. Proxy-indicator checks stay Tier-1-only: the
// gateway legitimately sets x-forwarded-for.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// "localhost:3000" → "localhost"; "[::1]:9222" → "[::1]"; bare → as-is.
function hostWithoutPort(header: string): string {
  const v = header.trim().toLowerCase();
  if (v.startsWith("[")) {
    const end = v.indexOf("]");
    return end === -1 ? v : v.slice(0, end + 1);
  }
  const colon = v.indexOf(":");
  return colon === -1 ? v : v.slice(0, colon);
}

function isLocalHost(header: string | null): boolean {
  if (!header) return false;
  const host = hostWithoutPort(header);
  return LOCAL_HOSTS.has(host) || host.endsWith(".localhost");
}

function isLoopbackIp(header: string): boolean {
  const first = header.split(",")[0]?.trim().toLowerCase() ?? "";
  return first === "127.0.0.1" || first === "::1" || first === "::ffff:127.0.0.1";
}

// r321 double-gate, verbatim from /api/vault/consume — one definition now
// (r378 doctrine): the consume route's copy is the reference; this is it.
export function csrfGateOk(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  const origin = req.headers.get("origin");
  if (site === null && origin === null) return true; // CLI / server-to-server
  if (req.headers.get("x-nexus-csrf") !== "1") return false; // preflight gate
  return site !== "cross-site";
}

// r707 Tier 2 gate — STRICTER than csrfGateOk on purpose: a non-local caller
// gets NO headerless pass (the consume gate's CLI branch is a localhost-
// machine trust that does not extend past the gateway — any curl that learns
// the preview URL would otherwise read plaintext keys). The caller must
// present the app-JS browser shape: the csrf header a foreign page cannot
// attach without a never-granted preflight, AND a non-cross-site
// sec-fetch-site. Residual (documented, r138 class): a non-browser client
// that forges both headers is not stoppable without real auth — deliberate
// exposure beyond localhost still means add real auth first.
function gatewayPass(req: Request): boolean {
  if (req.headers.get("x-nexus-csrf") !== "1") return false;
  const site = req.headers.get("sec-fetch-site");
  return site !== null && site !== "cross-site";
}

export function localGuard(req: Request): { ok: true } | { ok: false; reason: string } {
  if (!isLocalHost(req.headers.get("host"))) {
    // r707 Tier 2: the preview gateway passes only the strict browser gate.
    if (gatewayPass(req)) return { ok: true };
    return { ok: false, reason: `non-local host "${req.headers.get("host") ?? ""}"` };
  }
  const fwdHost = req.headers.get("x-forwarded-host");
  if (fwdHost && !isLocalHost(fwdHost.split(",")[0])) {
    return { ok: false, reason: `proxied (x-forwarded-host: ${fwdHost})` };
  }
  const ffor = req.headers.get("x-forwarded-for");
  if (ffor && !isLoopbackIp(ffor)) {
    return { ok: false, reason: `proxied (x-forwarded-for: ${ffor})` };
  }
  if (req.headers.get("forwarded")) {
    return { ok: false, reason: "proxied (forwarded header)" };
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp && !isLoopbackIp(realIp)) {
    return { ok: false, reason: `proxied (x-real-ip: ${realIp})` };
  }
  return { ok: true };
}
