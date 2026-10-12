// ─── r347: canonical provider-error classification (re-land of r334 + r336) ──
// One shared classifier for every BYOK round-trip that can fail at the
// provider: the image route today, chat + workflow lanes in later rounds.
//
// Doctrine (r334 + r336, lost in the rollback, re-homed here):
//   1. The provider's own BODY wording outranks the status code — gateways
//      bury 402/quota refusals inside 200/400/500 shells.
//   2. Billing wording (or 402)  -> honest "out of credits" — NOT a key problem.
//   3. BARE 401/403 (no billing wording) -> a real key problem — say so plainly.
//   4. 429 / rate-limit wording  -> congestion class — wait or switch lanes.
//   5. 503 / maintenance wording -> maintenance class — the provider is down.
//   6. >= 500 (else)             -> provider-side failure — never accusatory.
//   7. Copy is observation-truth: "The provider reported …" — we describe what
//      the provider actually said; we never invent a verdict the evidence
//      does not carry.

export type ProviderErrorKind =
  | "out-of-credits"
  | "auth"
  | "rate-limit"
  | "maintenance"
  | "provider-side"
  | "unknown";

export interface ClassifiedProviderError {
  kind: ProviderErrorKind;
  /** Honest, observation-truth message, ready to show the user. */
  message: string;
}

/** The provider's own billing vocabulary. A body match outranks any status. */
export const BILLING_BODY_RE =
  /\b(insufficient\s+(?:credits?|balance|quota|funds)|out of (?:credits?|balance)|no\s+(?:credits?|balance)\s+(?:left|remaining)|credits?\s+(?:exhausted|depleted|used up|have run out)|quota\s+(?:exceeded|exhausted|depleted|reached)|exceeded\s+(?:your|the|its|their)\s+(?:current\s+)?quota|balance\s+(?:is\s+)?(?:too low|insufficient|exhausted|empty)|payment required|billing\s+(?:error|issue|limit)|negative balance)\b/i;

/** Provider-down vocabulary (maintenance windows, temporary outages). */
export const MAINTENANCE_BODY_RE =
  /\b(?:under\s+maintenance|maintenance\s+(?:mode|window|break)|temporarily\s+(?:unavailable|offline|down)|service\s+unavailable)\b/i;

/** Congestion vocabulary (for when the status alone is not 429). */
export const RATE_BODY_RE = /\b(?:rate\s*limit(?:ed|ing)?|too many requests)\b|\b429\b/i;

const ELLIPSIS = "…";

/** Best-effort extraction of the provider's own error sentence from a JSON body. */
function innerProviderMessage(body: string): string | undefined {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string } | string;
      message?: string;
    };
    const e = parsed?.error;
    const candidate =
      typeof e === "string" ? e : typeof e === "object" && e ? e.message : undefined;
    const m = (candidate ?? parsed?.message ?? "").trim();
    return m.length > 0 ? m : undefined;
  } catch {
    return undefined;
  }
}

function quoted(inner: string | undefined, cap = 160): string {
  if (!inner) return "";
  const t =
    inner.length > cap
      ? inner.slice(0, cap - 1).trimEnd() + ELLIPSIS
      : inner;
  return ` — the provider said: "${t}"`;
}

// r353: the billing-hint advice, stated ONCE — the workflow runner's
// recovery-card meta (ERROR_KIND_META["out-of-credits"].hint) imports this,
// so the error message and the card can never drift apart. Keep it free of
// /quota/i and rate words — the prose fallbacks classify on those (the copy
// must stay classification-safe by construction).
export const OUT_OF_CREDITS_ADVICE = "Daily free credits reset at 00:00 UTC";

export function classifyProviderError(
  status: number,
  bodyText: string,
): ClassifiedProviderError {
  const body = (bodyText ?? "").slice(0, 4000); // classification reads the head only
  const inner = innerProviderMessage(body);
  const said = quoted(inner);

  // 1) Body billing truth outranks the status code.
  if (BILLING_BODY_RE.test(body)) {
    return {
      kind: "out-of-credits",
      message: `The provider reported this key is out of credits — its credit balance is exhausted${said}. ${OUT_OF_CREDITS_ADVICE}.`,
    };
  }
  if (status === 402) {
    return {
      kind: "out-of-credits",
      message: `The provider reported an unpaid-balance refusal (HTTP 402)${said}. ${OUT_OF_CREDITS_ADVICE}.`,
    };
  }

  // 2) Bare auth rejection (no billing wording above) = a real key problem.
  if (status === 401 || status === 403) {
    return {
      kind: "auth",
      message: `The provider rejected the key (HTTP ${status})${said} — this looks like a real key problem. Check it in Settings → Providers.`,
    };
  }

  // 3) Congestion.
  if (status === 429 || RATE_BODY_RE.test(body)) {
    return {
      kind: "rate-limit",
      message: `The provider reported rate limiting (HTTP ${status || 429})${said}. Wait a minute — or switch providers in the header picker — then retry.`,
    };
  }

  // 4) Maintenance / temporary outage.
  if (status === 503 || MAINTENANCE_BODY_RE.test(body)) {
    return {
      kind: "maintenance",
      message: `The provider is under maintenance or temporarily unavailable (HTTP ${status || "?"})${said}. Give it a few minutes and retry.`,
    };
  }

  // 5) Everything server-side and otherwise unclassified.
  if (status >= 500) {
    return {
      kind: "provider-side",
      message: `The provider reported a server-side failure (HTTP ${status})${said} — not your key. Retry shortly.`,
    };
  }

  // 6) Unknown — stay descriptive, stay non-accusatory.
  return {
    kind: "unknown",
    message: `The provider rejected the request (HTTP ${status || "?"})${said || " — no usable explanation came back"}.`,
  };
}
