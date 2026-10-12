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

export function localGuard(req: Request): { ok: true } | { ok: false; reason: string } {
  if (!isLocalHost(req.headers.get("host"))) {
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
