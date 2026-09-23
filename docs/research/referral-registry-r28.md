# Referral Advantage Registry — r28-3a (research-only, no code changes)

**Agent:** research (referral registry) · **Date:** 2026-09-21 · **Scope:** ground the Vyce referral program, scan 8–15 AI-infra referral/free-credit programs for safe auto-append in our outbound link handling, ethics/policy check, schema + integration proposal.
**Method:** live `curl` probes of vyceai.com (SPA shell + first-party JS bundle `/assets/index-vi5lGFii.js` = **first-party ground truth**), official docs fetches (docs.z.ai, docs.vast.ai, docs.llmgateway.io, digitalocean.com/referral-program, docs.digitalocean.com llms-index), z-ai `web_search` function (~20 queries). Raw evidence cached in `/tmp/r28/` (signup.html, index.js, zai_ref.html, vast.html, llmgw.html, do2.html, s_*.json). Prior Vyce evidence: r27-2b `/tmp/r27/vyce_auth.json`, r28-3b `free-model-tracker-r28.md`.

**Design principle under test — "harmless anchor redirection":** when our platform renders/shares outbound links, known referral params are appended **transparently** (visible, same URL shape, no cloaking, no redirect service of our own), using **only public referral codes owned by the platform owner**, never user-account tokens, never auto-creating accounts.

---

## 1. Vyce grounding — VERIFIED (first-party)

`vyceai.com` is reachable from the sandbox (200 on `/` and `/signup?ref=VYCE_8ZYQDC`). It is a client-rendered Vite SPA, so the ref logic was verified from the shipped bundle itself (`index-vi5lGFii.js`, 596,736 B) — quotes below are verbatim strings from that bundle.

| Fact | Finding | Evidence (first-party unless noted) |
|---|---|---|
| URL format | `https://vyceai.com/signup?ref=VYCE_XXXXXXXX` — `/signup` route registers search param **`ref`** (TanStack Router: `{to:"/signup",search:{ref:void 0}}`) | bundle route table + live 200 probe |
| Code format | Signup input placeholder `VYCE_XXXXXXXX`, auto-uppercased on entry; register API sends `referralCode: a\|\|void 0` in `POST /user/register` | bundle: `"Referral code (optional)"`, `m(z.target.value.toUpperCase())` |
| Referee reward | **"You get $50 and your referrer gets $10!"** — shown on the signup form when a code is entered | bundle (signup form string) |
| Referrer reward | **"Bonus per referral: $10"** (dashboard stat card); referral tab subtitle: **"Invite friends and earn recurring API credits"**; stats: Total Referred / Total Earned | bundle (dashboard strings) |
| Referral APIs | `GET /user/referral` (stats + own code), `POST /user/referral/accept-tos` (referrer must accept Referral Terms before the tab activates) | bundle (fetch wrappers `Bu`/`Uu`) |
| **Referral abuse rules (exact list)** | "The following actions will result in **permanent account suspension**: Creating multiple accounts to farm referral bonuses · Using the same IP address for multiple referral accounts · **Self-referring** or colluding with others to exploit the system · **Automated or bot-driven account creation**. … Violators will lose all credits and be permanently banned." | bundle (Referral Terms modal) |
| Extra no-spend path | **Daily Rewards**: "Claim daily credits and build your streak" (daily check-in, Day Streak) | bundle |
| Third-party corroboration | gist.github.com (Aug 29 2026): "Vyce AI — Register and get $50 free credit … Claim $50: https://vyceai.com/signup?ref=VYCE_KL7B2S" — same URL shape, same $50 | search snippet (s_vyce2.json) |
| Catalog context | `/v1/models` is Bearer-gated (401 keyless); 7 live ids verified r27-2b/r28-3b — the referral credit converts to API balance usable on those ids | r28-3b + r27-2b |

**Exact append rule for our registry:** match host `vyceai.com` (incl. `www.vyceai.com`), path `/signup` (or bare site links may point to `/signup`), append/set query `ref=VYCE_8ZYQDC` if absent. **Never** auto-submit the code to any Vyce API; only link URLs.

---

## 2. Registry table — referral / free-credit programs

Verification levels: **official** = read on the service's own docs/site this round; **snippet** = official-domain or credible third-party search snippet only; **unverified** = community claims.

| # | Service | Host match | Append rule | Referrer gets | Referee gets | Status | Safe to auto-append? |
|---|---------|-----------|-------------|---------------|--------------|--------|----------------------|
| 1 | **Vyce AI** | `vyceai.com` | `?ref=VYCE_8ZYQDC` on `/signup` (or convert site root links) | $10 per referral (recurring-credit dashboard balance; TOS accept required) | **$50 signup credit** | **official** (bundle + live probe) | ✅ yes — public code, transparent param; self-referral banned → never link from a context implying the platform owner signs up |
| 2 | **Z.ai (GLM)** | `z.ai`, `docs.z.ai` | ⚠️ "unique invitation link or code" bound on an **event page after login** — param format NOT documented (not a plain `?ref=`) | Credits = 10% of invitee's **first GLM Coding order** (paid), unlocked after 3 valid invites; +10% extra per 30 invites | **10% instant discount** on first GLM Coding order (one per user; ≥$0.50 payable after discount) | **official** (docs.z.ai/devpack/credit-campaign-rules, updated 2026-03-15) | ⚠️ only if the owner's own invitation URL is pasted into the registry verbatim (link is event-page-bound); do NOT guess param names |
| 3 | **DigitalOcean** | `digitalocean.com`, `m.do.co` | referral link is dashboard-generated, canonical form `https://m.do.co/c/<hash>` (path code; redirects set `refcode=`) | **$25 credit** after referee spends $25 | **$200 credit / 60 days** | **official** (digitalocean.com/referral-program; docs "Settings → Referrals tab") — link format from official docs + community examples (snippet) | ✅ yes for a stored owner link (m.do.co path form is designed for sharing); no self-referral clause found in public docs |
| 4 | **Vast.ai** (GPU rental) | `vast.ai`, `cloud.vast.ai` | dashboard-generated "Referral Link"; public **template links** embed a ref code (exact param string not printed in docs) | **3% of referred account's lifetime spend** as credits; cash out up to 75% (Stripe/PayPal/Wise; dedicated referral account required) | sign-up via link (no documented referee bonus) | **official** (docs.vast.ai/guides/reference/referral-program) | ✅ yes for stored owner link; ❌ mind their **Prohibited Promotion**: no self-referral/connected accounts, no multiple referral accounts, no brand-term ads |
| 5 | **LLM Gateway** | `llmgateway.io` | unique shareable link from Referrals dashboard (format not printed in docs — do not guess) | **1% of referred org's spend** as credits (eligibility: $100 lifetime top-ups) | bonus credit on first top-up | **official** (docs.llmgateway.io/learn/referrals + changelog 2026-06-01) | ⚠️ yes for a stored owner link; param unverified |
| 6 | **ElevenLabs** | `elevenlabs.io` | affiliate link via **PartnerStack** (unique link from profile → Affiliate program; application required) — not a plain query param we control | 22% commission × 12 months (+1 mo Creator-tier coupon for participants) | not a flat credit program | **official program** (elevenlabs.io/affiliates); link format **unverified** (help center JS-walled) | ❌ not auto-appendable — PartnerStack-tracked link, requires enrollment; list as manual-share only |
| 7 | **Novita AI** | `novita.ai` | signup referral **code** (community: "use code X to join the referral program") | $20 in credits (3 months, per community snippet); affiliate = 10% of referred spend for 180 days | $20 in credits | **snippet** (GitHub community + novita.ai affiliate page snippet) — param format unverified | ⚠️ code-entry (not URL param) per current evidence → do NOT auto-append until param confirmed |
| 8 | **SiliconFlow** | `siliconflow.com` | personal link or code (verified users) | referral vouchers | **$1 starter credit** + free models | **snippet** (official pricing snippet for $1 credit; referral mechanics from third-party) | ❌ not enough evidence of URL param |
| 9 | **Router One** | `router.one` | referral link (dashboard) | 5% commission on referred top-ups | — | **snippet** (router.one referral page) | ⚠️ stored owner link only |
| 10 | **Deepgram** | `deepgram.com` | **no referral link needed** — every new account gets **$200 free credits** (no card) | — | $200 signup credit | **official** (deepgram.com Flux TTS bonus T&C: "Deepgram's standard $200 in free sign-up credits, which every new account receives") | ✅ nothing to append — just surface the free-credit fact |
| 11 | **Groq** | `groq.com` | no referral program | — | generous free API tier (console key) | free-tier fact (catalog verified r27-2b); no referral found in searches | ✅ no-op |
| 12 | **Google AI Studio** | `aistudio.google.com`, `ai.google.dev` | no referral program | — | free tier incl. flash models | free-tier fact; no referral found | ✅ no-op |
| 13 | **Cloudflare Workers AI** | `cloudflare.com`, `workers.dev` | no referral program | — | free daily allocation (neurons) | free-tier fact; no referral found | ✅ no-op |
| 14 | **Modal** | `modal.com` | no referral program (partners page ≠ referral link) | — | **$30/month free compute** on Starter plan, no card | **snippet** (official-tier third-party consensus; no official referral found) | ✅ no-op |
| 15 | **Together AI** | `together.ai` | **REJECTED** — official docs: "does not currently offer free trials. Access … requires a minimum $5 credit purchase"; no referral program found | — | — | **official** (docs.together.ai Credits page snippet) | ❌ excluded from registry |

Rejected for the registry (checked, no simple referral/credit path): **OpenRouter** (no referral program found on-site searches; free `:free` models exist but no link credit), **Neon** (no official referral found — only third-party affiliate listings), **Fly.io** (no referral program; community threads confirm none), **Supabase** (no referral; free tier only), **fal.ai** (no self-serve referral), **Hyperbolic** (Partner Program = B2B deal commission, not a link program), **HuggingFace** (no referral).

> Registry size: 10 referral/affiliate-capable entries (1–9 + vyce overlap) + 5 no-link free-credit entries (10–14) + 1 documented rejection (15) ≈ **16 scanned, 6 with append-rules ready today (vyce, DO, vast, llmgw, z.ai-stored-link, router.one-stored-link)**.

---

## 3. Ethics & best practices

### 3.1 ToS red flags found (verified quotes)

- **Vyce (binding, first-party):** bans *self-referring or colluding*, *multiple accounts to farm bonuses*, *same-IP accounts*, *automated or bot-driven account creation* → **permanent suspension + credit forfeiture**. Our harness must (a) never register accounts programmatically, (b) never target the owner's own signup, (c) not encourage "farm" behavior in copy.
- **Vast.ai (official):** "You can't refer yourself or any account connected to you"; prohibits multiple referral accounts and **paid advertising targeting their brand terms**. Their affiliate-style payout rules (dedicated referral account) also mean link-appending is fine but payout structures are the owner's concern, not the user's.
- **Z.ai (official):** bans "Technical Cheating: using plugins, scripts, emulators, … automated scripts, bulk registration tools … to fake invitations". **Explicitly relevant**: a tool that auto-clicks/auto-registers is prohibited; pure URL decoration at render time is the compliant line.
- **DigitalOcean / standard marketplaces:** rewards only on *real qualifying spend*; no undisclosed-affiliate clause found publicly, but Google's link-spam rules (below) still apply to how we mark links.

### 3.2 Best practices for honest referral links (recommendations)

1. **Mark the link, not just the URL:** rendered anchors get `rel="nofollow sponsored noopener"` (Google link-spam policy treats monetized links as sponsored; this is both compliant and transparent) and a small visible "ref" affordance (e.g., tooltip "contains the platform owner's referral code — you get the signup bonus").
2. **Visible disclosure where it matters:** when the share composer or a chat message includes appended links, the UI (not the model's prose) should state "some links carry our referral codes (transparent, no cost to you)". Disclosure belongs to the *renderer*, so it can't be forgotten by the model.
3. **Append-only when param absent; never rewrite what the user wrote:** if a URL already carries `ref`/`referral`/`aff`/`via`/`invite`/`refcode` or any query params the user explicitly typed, leave it untouched (first-click attribution belongs to whoever the user chose). Rule: **append to bare/host-only links; never modify existing query semantics; never strip params**.
4. **Never touch functional URLs:** same-origin links, API endpoints (`/v1/*`, api.* hosts), tool-argument URLs (read_url, fetch, image gen), oauth/callback URLs, file/blob/data URIs, and anything inside tool calls. Only *content-facing* markdown links in chat render + explicit share flows qualify.
5. **Owner-owned codes only, config not model output:** codes live in a static registry file (code review auditable), never generated by the LLM, never user-account tokens, never session-scoped. The model may *explain* the registry; it must never be able to *write* it or inject arbitrary `?ref=` values into rendered links (injection-surface control — same doctrine as our ActGuard fencing).
6. **No click-farming features:** no auto-open, no link-shortener of our own, no redirect hop we control (harmless *anchor* redirection = the params travel on the visible href), no multi-account anything (Vyce/Z.ai/Vast all ban it).

---

## 4. Registry schema + draft

### 4.1 Proposed TypeScript shape (`src/lib/referral-registry.ts`)

```ts
export type ReferralVerification = 'official' | 'snippet' | 'unverified';

export interface ReferralEntry {
  id: string;                      // 'vyce' | 'zai' | 'digitalocean' ...
  label: string;                   // 'Vyce AI'
  hostPatterns: string[];          // hostnames (suffix match): ['vyceai.com', 'www.vyceai.com']
  pathAllow?: RegExp[];            // only rewrite these paths (default: any)
  pathDeny?: RegExp[];             // never rewrite these (e.g. /^\/api\//)
  param: string | null;            // query param name: 'ref' | 'refcode' | null
  code: string | null;             // public code owned by platform owner (audited, not model-written)
  linkTemplate?: string | null;    // for path-code programs: 'https://m.do.co/c/{code}' (replaces URL entirely, only when host matches bare domain)
  rewardReferrer: string;          // '$10 per referral'
  rewardReferee: string;           // '$50 signup credit'
  verified: ReferralVerification;  // 'official' = read on vendor docs/bundle this round
  verifiedAt: string;              // '2026-09-21'
  source: string;                  // URL of the evidence
  requiresEnrollment?: boolean;    // true => owner must be enrolled (elevenlabs/partnerstack)
  autoAppend: boolean;             // false = display-only entry / manual share
  disclosure?: string;             // extra per-program caveat shown in UI
}

export interface ReferralLinkDecision {
  url: string;           // final URL (unchanged if no-op)
  matched?: string;      // entry id
  changed: boolean;
  skipped?: 'same-origin' | 'has-params' | 'path-denied' | 'api-host' | 'already-reffed' | 'entry-disabled';
}

export function applyReferral(url: string, opts: { origin: string }): ReferralLinkDecision;
// order of checks: parse → same-origin skip → non-http(s) skip → host match →
// existing ref-ish param skip → pathAllow/Deny → entry.autoAppend → append/set param (or linkTemplate swap)
```

### 4.2 Draft registry JSON (verified levels as of 2026-09-21)

```json
[
  {"id":"vyce","label":"Vyce AI","hostPatterns":["vyceai.com","www.vyceai.com"],"pathAllow":["/signup"],"param":"ref","code":"VYCE_8ZYQDC","rewardReferrer":"$10 per referral (recurring API credits; TOS accept required)","rewardReferee":"$50 signup credit","verified":"official","verifiedAt":"2026-09-21","source":"https://vyceai.com signup bundle + /signup?ref probe","autoAppend":true,"disclosure":"Vyce bans self-referral and automated account creation — links only, never registration."},
  {"id":"zai","label":"Z.ai (GLM)","hostPatterns":["z.ai","docs.z.ai"],"param":"ref","code":"<owner event-link — paste verbatim>","rewardReferrer":"10% of invitee first GLM Coding order as credits (unlock at 3 invites)","rewardReferee":"10% off first GLM Coding order","verified":"official","verifiedAt":"2026-09-21","source":"https://docs.z.ai/devpack/credit-campaign-rules","autoAppend":false,"disclosure":"Link is event-page-bound; paste the owner's full invitation URL, do not construct params. No scripts/automation allowed."},
  {"id":"digitalocean","label":"DigitalOcean","hostPatterns":["digitalocean.com","m.do.co","www.digitalocean.com"],"param":"refcode","linkTemplate":"https://m.do.co/c/<owner-hash>","rewardReferrer":"$25 after referee spends $25","rewardReferee":"$200 credit / 60 days","verified":"official","verifiedAt":"2026-09-21","source":"https://www.digitalocean.com/referral-program","autoAppend":true,"disclosure":"Payout gated on real referee spend."},
  {"id":"vast","label":"Vast.ai","hostPatterns":["vast.ai","cloud.vast.ai"],"param":"ref","code":"<owner dashboard link>","rewardReferrer":"3% of referred lifetime spend (75% cashout, dedicated account)","rewardReferee":"none documented","verified":"official","verifiedAt":"2026-09-21","source":"https://docs.vast.ai/guides/reference/referral-program","autoAppend":false,"disclosure":"Self-referral + connected accounts banned; no brand-term ads."},
  {"id":"llmgateway","label":"LLM Gateway","hostPatterns":["llmgateway.io"],"param":"ref","code":"<owner dashboard link>","rewardReferrer":"1% of referred spend as credits ($100 top-up eligibility)","rewardReferee":"bonus credit on first top-up","verified":"official","verifiedAt":"2026-09-21","source":"https://docs.llmgateway.io/learn/referrals","autoAppend":false,"disclosure":"Param name not printed in docs — store the dashboard URL verbatim."},
  {"id":"routerone","label":"Router One","hostPatterns":["router.one"],"param":"ref","code":"<owner link>","rewardReferrer":"5% of referred top-ups","rewardReferee":"-","verified":"snippet","verifiedAt":"2026-09-21","source":"https://router.one referral page (search snippet)","autoAppend":false,"disclosure":"Small gateway; verify link before enabling append."},
  {"id":"novita","label":"Novita AI","hostPatterns":["novita.ai"],"param":null,"code":null,"rewardReferrer":"$20 credits (community) / affiliate 10% × 180d","rewardReferee":"$20 credits","verified":"snippet","verifiedAt":"2026-09-21","source":"novita.ai affiliate page + GitHub community snippet","autoAppend":false,"disclosure":"Code-entry referral, not URL param — do not append until confirmed."},
  {"id":"elevenlabs","label":"ElevenLabs","hostPatterns":["elevenlabs.io"],"param":null,"code":null,"rewardReferrer":"22% × 12 months (PartnerStack affiliate)","rewardReferee":"-","verified":"official","verifiedAt":"2026-09-21","source":"https://elevenlabs.io/affiliates (program); link format unverified (JS-walled help)","requiresEnrollment":true,"autoAppend":false,"disclosure":"PartnerStack-tracked; manual share only."},
  {"id":"deepgram","label":"Deepgram","hostPatterns":["deepgram.com"],"param":null,"code":null,"rewardReferrer":"-","rewardReferee":"$200 free credits on every new account (no card)","verified":"official","verifiedAt":"2026-09-21","source":"https://deepgram.com Flux TTS bonus T&C (snippet of official page)","autoAppend":false,"disclosure":"No link needed — surface as free-credit fact."},
  {"id":"modal","label":"Modal","hostPatterns":["modal.com"],"param":null,"code":null,"rewardReferrer":"-","rewardReferee":"$30/month free compute (Starter, no card)","verified":"snippet","verifiedAt":"2026-09-21","source":"third-party tier confirmations","autoAppend":false,"disclosure":"No referral program; free-tier fact only."},
  {"id":"groq","label":"Groq","hostPatterns":["groq.com","console.groq.com"],"param":null,"code":null,"rewardReferrer":"-","rewardReferee":"free API tier","verified":"snippet","verifiedAt":"2026-09-21","source":"free-tier; no referral found","autoAppend":false},
  {"id":"google-ai-studio","label":"Google AI Studio","hostPatterns":["aistudio.google.com","ai.google.dev"],"param":null,"code":null,"rewardReferrer":"-","rewardReferee":"free tier","verified":"snippet","verifiedAt":"2026-09-21","source":"free-tier; no referral found","autoAppend":false},
  {"id":"cloudflare-wai","label":"Cloudflare Workers AI","hostPatterns":["cloudflare.com","developers.cloudflare.com"],"param":null,"code":null,"rewardReferrer":"-","rewardReferee":"free daily allocation","verified":"snippet","verifiedAt":"2026-09-21","source":"free-tier; no referral found","autoAppend":false},
  {"id":"siliconflow","label":"SiliconFlow","hostPatterns":["siliconflow.com"],"param":null,"code":null,"rewardReferrer":"referral vouchers","rewardReferee":"$1 starter credit + free models","verified":"snippet","verifiedAt":"2026-09-21","source":"official pricing snippet + third-party referral notes","autoAppend":false,"disclosure":"Referral mechanics thinly documented; code-entry likely."}
]
```

(REJECTED entries with reasons are in §2 — keep them in the doc, not the JSON.)

---

## 5. Integration recommendations (concise)

1. **Where to rewrite (only these):**
   - Chat **markdown link rendering** (message-item / markdown renderer): anchor `href` post-processing + `rel="sponsored nofollow noopener"` + hover disclosure. Consumer tier: tiny "ref" tag on hover, no visual noise.
   - **Share composer / copy-link flows** (share button, export-to-clipboard of URLs): append there deliberately, with a one-line visible disclosure.
   - Optional Settings card ("Referral registry"): shows entries + lets the owner paste their own link/code per program (z.ai/vast/llmgw need verbatim dashboard URLs).
2. **Where NOT to rewrite:** tool-argument URLs (`read_url`, fetch, image/video tools — they are API calls, not content), same-origin links (`window.location.origin` prefix match), API hosts (`api.*`, `/v1/`, oauth/callback), any URL that already has query params (never merge into an existing query — skip instead), `mailto:`/`blob:`/`data:`, URLs inside `<code>`/fenced blocks (those are user content, not navigation), and anything the model emits as a *bare domain in prose* (only rewrite actual anchor hrefs at render time — the model never sees or writes codes).
3. **Order of guard checks in `applyReferral()`:** parse → same-origin → scheme allowlist (http/https only) → host suffix match → existing ref-ish param (`ref|referral|refcode|invite|aff|via|af|utm_*` present ⇒ skip) → pathAllow/pathDeny → `autoAppend` → append-or-swap. Return the decision object so the UI can log why a link was left alone (auditable, receipt doctrine).
4. **Never:** auto-open/auto-fetch appended links (SSRF + click-farming exposure), let the LLM output codes, route through an internal redirector (keep the vendor's visible URL — "harmless anchor redirection"), or touch Vyce's register/referral APIs.

---

## 6. References

- Vyce first-party bundle: `https://vyceai.com/assets/index-vi5lGFii.js` (signup `ref` search param; "You get $50 and your referrer gets $10!"; `POST /user/register` `referralCode`; `GET /user/referral`; `POST /user/referral/accept-tos`; Referral Terms abuse list; Daily Rewards strings) — cached `/tmp/r28/index.js`
- Vyce signup live probe: `https://vyceai.com/signup?ref=VYCE_8ZYQDC` → 200 (2026-09-21)
- Vyce third-party corroboration: gist.github.com "$200 Bonus…" (Aug 29 2026) — `$50 free credit`, `signup?ref=VYCE_KL7B2S`
- Z.ai campaign rules (official): `https://docs.z.ai/devpack/credit-campaign-rules` — 10%/10%, 3-invite unlock, 72h window, anti-automation clause
- Vast.ai referral program (official): `https://docs.vast.ai/guides/reference/referral-program` — 3% lifetime, 75% cashout, prohibited promotion
- LLM Gateway referrals (official): `https://docs.llmgateway.io/learn/referrals` — 1% model, $100 unlock; changelog 2026-06-01 referee bonus
- DigitalOcean referral (official): `https://www.digitalocean.com/referral-program`; docs "Settings → Referrals"; `docs.digitalocean.com` llms-index (permissions `referrals:read`)
- ElevenLabs affiliates (official program): `https://elevenlabs.io/affiliates`; PartnerStack listing (22% × 12 mo)
- Deepgram $200 signup credits: deepgram.com Flux TTS Credit Bonus Promotion T&C (official-domain snippet)
- Together AI rejection evidence: docs.together.ai "Credits — does not currently offer free trials … minimum $5 credit purchase"
- Novita AI: novita.ai affiliate page snippet + GitHub community referral-code snippet
- SiliconFlow: siliconflow.com/pricing snippet ($1 starter credit); referral vouchers via third-party
- Router One: router.one referral page snippet (5%)
- Search evidence: `/tmp/r28/s_*.json` (z-ai web_search outputs, ~20 queries)
- Related in-repo research: `docs/research/free-model-tracker-r28.md` (r28-3b — Vyce bundle/catalog probes), r27-2b roster truth pass (worklog) — Vyce `/v1/models` Bearer-gated, 7 live ids.
