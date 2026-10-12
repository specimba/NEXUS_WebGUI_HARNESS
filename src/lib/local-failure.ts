// ─── r363: local-route internal-failure policy ──────────────────────────────
// The local API routes (vault, vault/consume, automation sync + run-now,
// tracker) are localhost-only and SQLite-backed. When Prisma (or any internal
// step) throws, the raw error is infrastructure internals — SQL invocation
// fragments, model/column names, engine file paths — and it must not travel
// to the client: the autopilot panel polls sync GET every 15s and renders its
// error field, so raw internals would land in user-visible UI (and any local
// process could read them off the wire).
//
// Policy, mirroring the r347 family doctrine of honest non-leaking bodies:
//   1. LOG the raw error server-side (console.error → the dev terminal).
//      This app's server is the user's own machine, so "check the server
//      console" is actionable advice, not a shrug.
//   2. RETURN the route's safe fallback copy. Body SHAPES stay byte-stable
//      (vault GET keeps { vault: [], error }, sync GET keeps
//      { serverDriving: false, registry: [], runs: [], error }, ok-routes
//      keep { ok: false, error }) — only the error TEXT changes.
//
// No kind field is added on purpose: unlike provider failures (r347 arc),
// local DB failures are all equally client-unretryable, so the kind
// vocabulary would earn nothing here.
export function localFailure(route: string, e: unknown, fallback: string): string {
  console.error(`[api:${route}] internal failure:`, e);
  return fallback;
}
