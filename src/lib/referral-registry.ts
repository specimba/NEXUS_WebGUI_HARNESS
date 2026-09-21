// ─── Referral Advantage Registry (r28) ───────────────────────────────────────
// "Harmless anchor redirection": when this platform renders or shares an
// outbound link to a service with a referral/free-credit program, the PUBLIC
// platform-owner referral code is appended — transparently, visibly, and only
// when the link doesn't already carry one.
//
// Hard rules (grounded in docs/research/referral-registry-r28.md):
//  • Decoration only. We NEVER automate signup/account creation (Vyce ToS bans
//    self-referral farming & bot registration → permanent ban).
//  • No cloaking/shortening: the destination stays visible in href + status bar;
//    rewritten anchors get rel="sponsored nofollow noopener" + a visible "ref"
//    chip (honesty best practice).
//  • Only PUBLIC owner codes live here — never user-account tokens.
//  • Programs that only issue dashboard/event-bound links (Z.ai invites,
//    Vast.ai, LLM Gateway, DigitalOcean m.do.co) are stored VERBATIM via
//    ownerLink, never constructed from parameters — and stay inactive until
//    the owner pastes their real link.
//  • Same-origin links, links that already carry the referral param, API/doc
//    deep links outside the declared paths, and non-http(s) schemes are never
//    touched.

export const VYCE_REFERRAL_CODE = "VYCE_8ZYQDC";
export const VYCE_REFERRAL_URL = `https://vyceai.com/signup?ref=${VYCE_REFERRAL_CODE}`;

export interface ReferralEntry {
  id: string;
  label: string;
  /** Hostnames (exact) the entry applies to; "www." variants are matched too. */
  hosts: string[];
  /** Path prefixes the rewrite applies to (prefix match, "/"-rooted). Empty ⇒ any path. */
  paths?: string[];
  /** Query param to set when absent (e.g. "ref"). Mutually exclusive with ownerLink. */
  param?: string;
  /** The platform owner's public referral code for `param`. */
  code?: string;
  /**
   * Verbatim owner-issued link (for programs whose referral attribution is
   * bound to a generated URL). When set, matching links are replaced by it.
   */
  ownerLink?: string | null;
  /** What each side earns — shown in the disclosure tooltip. */
  reward: string;
  verified: "official" | "snippet";
  active: boolean;
}

/**
 * The registry. Vyce is live (verified against vyceai.com's own bundle:
 * "You get $50 and your referrer gets $10!", param `ref`, format VYCE_XXXXXXXX).
 * The rest are researched programs waiting for the owner's link — flip
 * `active` + paste `ownerLink` (or param/code) to enable.
 */
export const REFERRAL_REGISTRY: ReferralEntry[] = [
  {
    id: "vyce",
    label: "Vyce AI",
    hosts: ["vyceai.com"],
    paths: ["/", "/signup"],
    param: "ref",
    code: VYCE_REFERRAL_CODE,
    reward:
      "Referee: $50 signup credit (vs $10/day base) · Referrer: $10 recurring API credits",
    verified: "official",
    active: true,
  },
  {
    id: "digitalocean",
    label: "DigitalOcean",
    hosts: ["digitalocean.com", "m.do.co"],
    // Owner link from the DO referral dashboard (path-code form; sets refcode=).
    ownerLink: null,
    reward: "Referee: $200 credit ×60 days · Referrer: $25 after referee spends $25",
    verified: "official",
    active: false,
  },
  {
    id: "vastai",
    label: "Vast.ai",
    hosts: ["vast.ai", "cloud.vast.ai"],
    // Dashboard-generated link; docs don't print a param → verbatim only.
    ownerLink: null,
    reward: "Referrer: 3% of referred lifetime spend (75% cashout-eligible)",
    verified: "official",
    active: false,
  },
  {
    id: "llmgateway",
    label: "LLM Gateway",
    hosts: ["llmgateway.io"],
    // Shareable link from the dashboard; param not documented → verbatim only.
    ownerLink: null,
    reward: "Referrer: 1% of referred spend · Referee: first top-up bonus",
    verified: "official",
    active: false,
  },
  {
    id: "zai",
    label: "Z.ai",
    hosts: ["z.ai", "docs.z.ai"],
    // Z.ai invites are event-page-bound (no documented param) → verbatim only.
    ownerLink: null,
    reward:
      "Referrer: 10% of the referred first GLM Coding order as credits (unlocks at 3 invites) · Referee: 10% first-order discount",
    verified: "official",
    active: false,
  },
];

function hostMatches(host: string, entry: ReferralEntry): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return entry.hosts.some((e) => h === e || h === `www.${e}`);
}

function pathMatches(path: string, entry: ReferralEntry): boolean {
  if (!entry.paths || entry.paths.length === 0) return true;
  return entry.paths.some((p) => {
    if (p === "/") return path === "/"; // "/" matches ONLY the root, not every path
    return path === p || path.startsWith(p.endsWith("/") ? p : `${p}/`);
  });
}

export interface ReferralRewrite {
  /** The rewritten (or verbatim owner) URL to use in href. */
  href: string;
  entry: ReferralEntry;
}

/**
 * Rewrite an outbound URL with the platform referral when applicable.
 * Returns null when: not http(s), no active entry matches, the link already
 * carries the referral param, or the path is outside the declared prefixes.
 */
export function applyReferral(rawUrl: string): ReferralRewrite | null {
  if (!rawUrl || rawUrl.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null; // relative / mailto: / javascript: — never touched
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  for (const entry of REFERRAL_REGISTRY) {
    if (!entry.active) continue;
    if (!hostMatches(url.host, entry)) continue;
    if (!pathMatches(url.pathname, entry)) continue;

    if (entry.ownerLink) {
      // Verbatim program: replace only when the link doesn't already point at
      // the owner's link itself (idempotent).
      if (url.toString() === entry.ownerLink) return null;
      return { href: entry.ownerLink, entry };
    }
    if (!entry.param || !entry.code) continue;
    if (url.searchParams.has(entry.param)) return null; // already credited — leave as-is
    url.searchParams.set(entry.param, entry.code);
    return { href: url.toString(), entry };
  }
  return null;
}

/** Honest anchor props for a rewritten referral link (spread onto <a>). */
export function referralAnchorProps(rewrite: ReferralRewrite): {
  rel: string;
  "data-ref": string;
  title: string;
} {
  return {
    rel: "sponsored nofollow noopener noreferrer",
    "data-ref": rewrite.entry.id,
    title: `Referral link — ${rewrite.entry.label}: ${rewrite.entry.reward}`,
  };
}

/** Convenience: the referral-signup URL for a registry provider id, if any. */
export function referralSignupUrl(providerId: string): string | undefined {
  const entry = REFERRAL_REGISTRY.find((r) => r.id === providerId && r.active);
  if (!entry) return undefined;
  if (entry.ownerLink) return entry.ownerLink;
  if (entry.param && entry.code) {
    const target = new URL(`https://${entry.hosts[0]}/signup`);
    target.searchParams.set(entry.param, entry.code);
    return target.toString();
  }
  return undefined;
}
