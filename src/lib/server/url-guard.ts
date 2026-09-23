// ─── Server-side URL guard (r26 security pack) ──────────────────────────────
// Two server surfaces fetch client/model-supplied URLs:
//   • the LLM relay — /api/chat accepts body.baseUrl and relay[] hops
//   • the read_url tool — model-chosen pages
// guardPublicUrl() blocks the classic SSRF classes (loopback, private
// ranges, link-local metadata, unique-local IPv6) with zero dependencies
// and zero DNS latency. Residual risk (DNS rebinding of public names) is
// documented in docs/decision-log.md and re-checked per redirect hop.

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
  "metadata.goog",
]);

export type UrlGuardVerdict = { ok: true } | { ok: false; reason: string };

function ipv4Blocked(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true; // this-network / private / loopback
  if (a === 169 && b === 254) return true; // link-local (169.254.169.254 cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved / broadcast
  return false;
}

function ipv6Blocked(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::" || h === "::1" || h === "::ffff:127.0.0.1") return true;
  if (/^f[cd]/.test(h)) return true; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(h)) return true; // fe80::/10 link-local
  const v4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(h);
  if (v4) return ipv4Blocked(v4[1]);
  return false;
}

/**
 * Synchronous textual SSRF check — no DNS.
 * @param opts.allowHttp  true for read_url (plain-http pages are legitimate);
 *                        false (default) for relay baseUrls (https-only).
 */
export function guardPublicUrl(rawUrl: string, opts?: { allowHttp?: boolean }): UrlGuardVerdict {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid URL" };
  }
  if (u.protocol !== "https:" && !(opts?.allowHttp && u.protocol === "http:")) {
    return { ok: false, reason: `protocol ${u.protocol || "(none)"} not allowed` };
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return { ok: false, reason: "empty host" };
  if (
    BLOCKED_HOSTNAMES.has(host) ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    return { ok: false, reason: `host "${host}" is not a public endpoint` };
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    return ipv4Blocked(host) ? { ok: false, reason: `IP ${host} is private/reserved` } : { ok: true };
  }
  if (host.includes(":")) {
    return ipv6Blocked(host) ? { ok: false, reason: `IP ${host} is private/reserved` } : { ok: true };
  }
  return { ok: true };
}
