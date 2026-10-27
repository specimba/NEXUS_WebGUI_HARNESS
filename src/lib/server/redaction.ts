// ─── TASK-102 (NEXUS_BOT adaptation wave, slice 1): the single redaction ────
// choke in front of every server-lane outbound LLM dial.
//
// Ported doctrine from upload/NEXUSbot2210v3.tar (ops/secrets.required.yaml:
// "owner-enters-locally-agents-see-names-only", mask: last4). The tar itself
// holds NO redaction module — its src/lib/guard.ts is a rate limiter — so this
// is a fresh implementation against the TASKS.md acceptance: "one redaction
// module covers relay + engine + radar dials".
//
// Contract: dial SITES call redactDialBody(body, extraSecrets) on the JSON
// payload right before JSON.stringify — auth headers are NEVER passed through
// here (they must stay real). Two defense layers:
//   1. pattern classes (sk-, sk-ant-, gsk_, xai-, AIza, gh?_ PATs, JWTs,
//      Bearer literals) — catches keys the operator never registered;
//   2. exact-match vault values passed by the dial site (e.g. dial.key) —
//     catches the operator's REAL keys even when a workflow prompt quotes them.
// Mask shape follows the NEXUS_BOT policy: [REDACTED:<class>:…<last4>].

export interface RedactionStats {
  hits: number;
  byClass: Record<string, number>;
}

const stats: RedactionStats = { hits: 0, byClass: {} };

function bump(cls: string): void {
  stats.hits += 1;
  stats.byClass[cls] = (stats.byClass[cls] ?? 0) + 1;
}

/** Redaction telemetry for the Engine/briefing lane — cheap, in-memory only. */
export function redactionStats(): Readonly<RedactionStats> {
  return stats;
}

/** NEXUS_BOT mask policy: names only + last4 survives. */
function mask(last4: string): string {
  return `…${last4.slice(-4)}`;
}

const PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g },
  { name: "openai-like-key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: "github-pat", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { name: "groq-key", re: /\bgsk_[A-Za-z0-9]{20,}\b/g },
  { name: "xai-key", re: /\bxai-[A-Za-z0-9_-]{16,}\b/g },
  {
    name: "jwt",
    re: /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  { name: "bearer-literal", re: /\bBearer\s+[A-Za-z0-9._-]{16,}\b/g },
];

function redactString(input: string, extras: ReadonlyArray<string>): string {
  let out = input;
  for (const { name, re } of PATTERNS) {
    out = out.replace(re, (matched) => {
      bump(name);
      return `[REDACTED:${name}:${mask(matched.trim())}]`;
    });
  }
  // exact-match vault values — the operator's real keys, however they got
  // quoted into the prompt. Long-enough guard avoids absurd full-string
  // scanning overhead and false hits on tiny words.
  for (const secret of extras) {
    if (typeof secret !== "string" || secret.length < 12) continue;
    let idx = out.indexOf(secret);
    while (idx !== -1) {
      bump("vault-value");
      const head = out.slice(0, idx);
      const tail = out.slice(idx + secret.length);
      out = `${head}[REDACTED:vault-value:${mask(secret)}]${tail}`;
      idx = out.indexOf(secret, head.length + 24);
    }
  }
  return out;
}

/**
 * Deep-walks a JSON-serializable dial body and redacts every string it finds
 * (system prompts, user prompts, prior outputs quoted back in — anywhere).
 * Returns a structural clone; the caller's object is untouched.
 */
export function redactDialBody<T>(body: T, extraSecrets?: ReadonlyArray<string>): T {
  const extras = extraSecrets ?? [];
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") return redactString(node, extras);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const clone: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        clone[k] = walk(v);
      }
      return clone;
    }
    return node;
  };
  return walk(body) as T;
}
