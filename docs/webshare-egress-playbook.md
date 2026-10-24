# Webshare egress playbook — distilled r516

> Owner pasted the Webshare dashboard + CLI + MCP + Skills pages (r516) "for
> relative adaptation". This file is the distillation the platform keeps; the
> live integration is r514's egress layer (`src/lib/server/egress.ts`,
> Settings → Egress). Nothing here is speculative — every claim is from the
> Owner's pasted console or our own probes.

## The two plans (Owner's dashboards, r516)

| Plan | Price | This cycle | Read |
|---|---|---|---|
| Proxy Server (Shared) | $1.3455/mo | 4.05 MB / 250 GB · 165 req · 100% success | the working pool — r514 pool probes + r516 GitHub retries ride THIS |
| Static Residential (Shared) | $1.50/mo | 0 B / 250 GB · 0 req | armed spare — zero traffic so far |

## What the platform already does with it (r514 + r516)

- Token → `PlatformSetting("egress.webshare.token")` — server-only, never in
  responses; pool cache 60s, 60 req/min listing budget, single in-flight load.
- Per-upstream routing map (groq / vyce / openai / generic → direct|pool).
  Measured: Groq WAF 403 direct → 401-via-pool (key-level answer = WAF bypass).
- **r516 addition**: the GitHub radar route auto-retries 403/429 through the
  pool (3 proxies, honest `via: "pool"` + client toast) — the "specimba
  stale" refresh path no longer dead-ends on the shared egress IP's 60 req/h
  unauthenticated bucket.
- Probe surface: Settings → Egress → "Probe direct vs pool" (Cloudflare trace
  loc, Groq models leg).

## Surfaces the Owner reported (adaptation ledger)

- **CLI** (`webshare` binary): `webshare login | whoami | proxies list --format
  csv | stats`. We do NOT need the CLI inside the sandbox — the platform talks
  to the Webshare REST API directly with the pasted token. If the Owner ever
  wants scripted pool hygiene outside the app, the CLI is the tool.
- **MCP server** (`https://mcp.webshare.io/`, OAuth, no API key): tools read
  profile/subscription/billing/transactions + `get_bandwidth_stats`. Not wired
  here (this platform is its own agent harness); noted as the managed read
  surface if we ever want an external client.
- **Skills** (`npx skills add webshare-proxy/skills --skill …`): proxy-manager,
  proxy-optimizer, scraper, spend-audit. The USEFUL doctrine we lift into the
  platform: spend-audit logic (are plans oversized? yearly-billing math) and
  proxy-optimizer logic (per-target blocked-proxy detection → replace only
  what fails). Both map onto our existing pool health counters — candidate
  P3: a "pool optimizer" row on the Egress card that flags proxies failing
  >5% in 24h from OUR dial history.

## Hard rules (unchanged)

- Proxy credentials never leave the server; only counts + country codes are
  displayed.
- Everything defaults to direct; empty token = byte-identical behavior.
- A 403 on a direct dial is a network fact, never a key problem.

## Unsplash note (Owner context, no action)

Cortex Edge lane stays OFF by design — it targets the NEXUS_BOT system; the
Owner will report that system for adaptation separately. Upstash Redis: only
one free server can exist per account — do not provision colliding instances
in future Cortex v2 work.
