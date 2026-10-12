#!/usr/bin/env node
/**
 * r347 probe — re-land of r334+r336: canonical provider-error classification.
 * Pins: (1) src/lib/billing-classify.ts exports the canonical family and the
 * branch ORDER is the honesty core (billing wording > status; bare 401/403 =
 * real key problem; 429 = congestion; 503 = maintenance; >=500 = provider-side);
 * (2) the SHIPPED regex literals are extracted and behaviorally tested against
 * fixture bodies (catches the recurring JSON-escape mangling class);
 * (3) /api/images/generate wires the classifier at BOTH failure exits
 * (!res.ok and the lying-200 shape case) and returns { error, kind };
 * (4) the old hand-rolled accusatory copy is gone from the route;
 * (5) canary: the route's escaped-slash data-url regex survived the edit.
 */
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
let pass = 0, fail = 0;
const ok = (cond, name) => {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}`);
  if (cond) { pass++; } else { fail++; }
};

const mod = read("src/lib/billing-classify.ts");
const route = read("src/app/api/images/generate/route.ts");

// ── module structure ──
ok(/export type ProviderErrorKind =/.test(mod) && /"out-of-credits"/.test(mod) && /"maintenance"/.test(mod),
  "ProviderErrorKind union covers all six classes");
ok(/export function classifyProviderError\(/.test(mod), "classifyProviderError exported");
ok(/export const BILLING_BODY_RE =/.test(mod), "canonical BILLING_BODY_RE exported");
ok(/export const MAINTENANCE_BODY_RE =/.test(mod), "MAINTENANCE_BODY_RE exported");
ok(/export const RATE_BODY_RE =/.test(mod), "RATE_BODY_RE exported");
ok(!/\/g[,;\s]/.test(mod), "no global flag on any module regex (stateless .test)");

// ── branch order (the honesty core): billing body BEFORE auth BEFORE rate ──
const iBilling = mod.indexOf("BILLING_BODY_RE.test(body)");
const i402 = mod.indexOf("status === 402");
const iAuth = mod.indexOf("status === 401 || status === 403");
const iRate = mod.indexOf("status === 429 || RATE_BODY_RE.test(body)");
const iMaint = mod.indexOf("status === 503 || MAINTENANCE_BODY_RE.test(body)");
const i5xx = mod.indexOf("status >= 500");
ok(iBilling > -1 && iBilling < i402 && i402 < iAuth && iAuth < iRate && iRate < iMaint && iMaint < i5xx,
  "branch order: billing-body > 402 > bare-auth > rate > maintenance > 5xx");
ok(/The provider reported/.test(mod), "observation-truth phrasing present (never invented verdicts)");
ok(/real key problem/.test(mod), "bare 401/403 honestly named a real key problem");
ok(/not your key/.test(mod), "5xx copy explicitly clears the user's key");

// ── behavioral regex tests on the SHIPPED literals ──
function extract(name) {
  const m = mod.match(new RegExp(`export const ${name} =\\s*\\/([\\s\\S]+?)\\/([a-z]+);`));
  if (!m) return null;
  try { return new RegExp(m[1], m[2].replace("g", "")); } catch { return null; }
}
const BILLING = extract("BILLING_BODY_RE");
const MAINT = extract("MAINTENANCE_BODY_RE");
const RATE = extract("RATE_BODY_RE");
ok(BILLING instanceof RegExp && MAINT instanceof RegExp && RATE instanceof RegExp,
  "all three shipped regex literals compile (no escape mangling)");

const billingHits = [
  "Insufficient credits",
  "You exceeded your current quota, please wait",
  '{"error":{"message":"402 Payment Required"}}',
  "Your balance is too low, top up to continue",
  "quota exhausted for this key",
  "you have a negative balance",
];
const billingMisses = [
  "Invalid API key provided",
  "Unauthorized",
  "The server is under maintenance",
  "Rate limit exceeded, too many requests",
  "Internal server error",
  "",
];
ok(!!BILLING && billingHits.every((s) => BILLING.test(s)),
  "BILLING matches real provider billing vocabulary (6 fixtures)");
ok(!!BILLING && billingMisses.every((s) => !BILLING.test(s)),
  "BILLING never matches auth/maintenance/rate/server-error wording (6 fixtures)");
ok(!!MAINT && ["under maintenance", "temporarily unavailable", "service unavailable", "maintenance window"]
  .every((s) => MAINT.test(s)), "MAINTENANCE matches outage vocabulary");
ok(!!MAINT && !MAINT.test("Insufficient credits") && !MAINT.test("Rate limit exceeded"),
  "MAINTENANCE does not swallow billing/rate wording");
ok(!!RATE && ["Rate limit exceeded", "too many requests", "HTTP 429"].every((s) => RATE.test(s)),
  "RATE matches congestion vocabulary");
ok(!!RATE && !RATE.test("Insufficient credits") && !RATE.test("Invalid API key"),
  "RATE does not swallow billing/auth wording");

// ── route wiring ──
ok(/import \{ classifyProviderError \} from "@\/lib\/billing-classify";/.test(route),
  "route imports the shared classifier");
ok((route.match(/classifyProviderError\(/g) || []).length === 2,
  "classifier wired at BOTH failure exits (!res.ok + lying-200 shape)");
ok(/const cls = classifyProviderError\(res\.status, text\);\s*return NextResponse\.json\(\{ error: cls\.message, kind: cls\.kind \}/.test(route),
  "!res.ok exit returns the classified message + kind");
ok(/kind: cls\.kind/.test(route), "payload carries the kind for the client");
ok(!/Invalid or unauthorized key/.test(route) && !/Out of credits \(HTTP 402\)/.test(route) && !/Rate limited \(HTTP 429\)/.test(route),
  "old hand-rolled status copy fully removed from the route");
ok(/cls\.kind === "unknown"\s*\?\s*"The provider returned no usable image/.test(route),
  "lying-200 exit keeps the shape error for unknown, uses classified message otherwise");

// ── canaries (the recurring mangling class) ──
ok(route.includes("/^data:image\\/(png|jpeg|jpg|webp);base64,|^https:\\/\\//i"),
  "CANARY: route data-url regex survived the edit un-mangled");
ok(mod.includes('ELLIPSIS = "…"') && !mod.includes("\u2019") && !mod.includes("\u201c"),
  "CANARY: no curly quotes smuggled into the module");

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
