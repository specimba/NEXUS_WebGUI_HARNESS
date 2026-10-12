// r356 probe — root error boundaries (static pins).
// error.tsx: the page-tree boundary must offer reset + reload + no-key
// diagnostics copy + digest display + the persistence-honesty line.
// global-error.tsx: the last-resort boundary must be FULLY self-contained
// (own <html>, zero app imports) — importing the app UI kit there could
// itself be the broken thing it exists to recover from.
import { readFileSync } from "node:fs";

const ERR = "src/app/error.tsx";
const GERR = "src/app/global-error.tsx";
const err = readFileSync(ERR, "utf8");
const gerr = readFileSync(GERR, "utf8");

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}`);
  }
}

console.log("probe-r356-error-boundaries");

// ── 1. error.tsx — the page-segment boundary ──
ok(err.startsWith('"use client"'), "error.tsx is a client component");
ok(/export default function \w+\(\{\s*\n\s*error,\s*\n\s*reset,/.test(err), "error.tsx takes { error, reset }");
ok(/reset\(\)/.test(err), "Try again calls reset()");
ok(/window\.location\.reload\(\)/.test(err), "Reload app hard-reloads");
ok(/navigator\.clipboard\s*\n?\s*\.writeText\(text\)/.test(err) || err.includes("navigator.clipboard"), "Copy diagnostics writes to the clipboard");
ok(err.includes("digest: ${error.digest ?? \"none\"}"), "diagnostics include the digest (cross-reference with server console)");
ok(err.includes("error.stack.slice(0, 1200)"), "stack head is capped at 1200 chars");
ok(/role="alert"/.test(err), "boundary container carries role=alert");
ok(err.includes("stored locally in this browser"), "persistence-honesty line present (what survives the crash)");
ok(err.includes("contain no keys"), "no-keys statement present on the diagnostics note");
ok(/aria-expanded=\{stackOpen\}/.test(err), "stack toggle exposes aria-expanded (r355 a11y convention)");
ok(err.includes("console.info(text)"), "clipboard-blocked fallback dumps diagnostics to console (house pattern)");
ok(!/browser's|user's|app's/.test(err), "no unescaped apostrophes in JSX text (lint-safe)");

// ── 2. global-error.tsx — the self-contained last resort ──
ok(gerr.startsWith('"use client"'), "global-error.tsx is a client component");
ok(/<html lang="en">/.test(gerr) && /<\/html>/.test(gerr), "global-error renders its own <html> (root-layout crash = layout absent)");
ok(/role="alert"/.test(gerr), "global-error carries role=alert");
ok(/reset\(\)|onClick=\{reset\}/.test(gerr) && /window\.location\.reload\(\)/.test(gerr), "global-error offers Try again + Reload app");
ok(!/from "@\//.test(gerr), "global-error imports NOTHING from the app (dependency-free by construction)");
ok(!/from "lucide-react"/.test(gerr) && !/from "framer-motion"/.test(gerr), "global-error imports no UI/icon libraries either");
ok(gerr.includes("browser-local storage"), "global-error states what survives (honest recovery copy)");

// ── 3. Pair contract: both boundaries accept the same Next 15/16 shape ──
for (const [name, src] of [["error.tsx", err], ["global-error.tsx", gerr]]) {
  ok(
    /error: Error & \{ digest\?: string \}/.test(src),
    `${name} types the Next error shape (Error & { digest? })`,
  );
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
