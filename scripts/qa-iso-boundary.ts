// ─── RSC boundary guard (r309) ───────────────────────────────────────────────
// Regression guard for the crash class that killed the relay ladder live:
// a directive-free (server-graph) module CALLING a function imported from a
// "use client" module. Such an import becomes a client-reference proxy on the
// server and CALLING it throws Next's "Attempted to call X() from the server
// but X is on the client" — which callers then record as a run/step failure
// (live evidence: the Continuous Research run dying at step 1 with exactly
// that message).
// Rendering a client COMPONENT from a server component (layout/page →
// <ThemeProvider/>) is the legitimate RSC pattern and is NOT flagged: the
// guard distinguishes JSX usage from execution. `import type` / `export type`
// are erased at compile time and exempt.
// The client-module set is DERIVED from the actual directives (no hardcoded
// list — future "use client" additions are covered automatically).
// Run: bun run scripts/qa-iso-boundary.ts

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const SRC = resolve(import.meta.dir, "..", "src");
const EXT_CANDIDATES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(p);
  }
}

function hasClientDirective(text: string): boolean {
  const head = text.slice(0, 400).split("\n").slice(0, 6);
  return head.some((line) => line.trim() === `"use client";`);
}

/** Resolve "x", "@/x", "./x", "../x" to a real module file, or null. */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) base = resolve(dirname(fromFile), spec);
  else return null; // bare package specifier — outside the guard's scope
  for (const cand of EXT_CANDIDATES) {
    const p = base + cand;
    try {
      if (statSync(p).isFile()) return p;
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

const files: string[] = [];
walk(SRC, files);

const clientModules = new Set<string>();
const textOf = new Map<string, string>();
for (const f of files) {
  const text = readFileSync(f, "utf8");
  textOf.set(f, text);
  if (hasClientDirective(text)) clientModules.add(f);
}

// Import clauses pulling bindings out of a client module, from a server-graph
// file. Group 1 = optional leading `type` (whole clause exempt); group 2 =
// optional default binding; group 3 = the named-clause body; group 4 = spec.
const IMPORT_RE =
  /\bimport\s+(type\s+)?(?:(\w+)\s*,\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
// Plain default-only imports: import Name from "spec"
const DEFAULT_RE = /\bimport\s+(\w+)\s+from\s*["']([^"']+)["']/g;

type Violation = { file: string; spec: string; binding: string };
const violations: Violation[] = [];

/** A binding is VIOLATING only when it is EXECUTED in the server file —
 * `name(…)` — which is exactly the client-reference proxy call that throws.
 * JSX rendering (<Name/>) never matches the call shape and stays legal. */
function calledSomewhere(text: string, binding: string): boolean {
  const callRe = new RegExp(`\\b${binding}\\s*\\(`);
  return callRe.test(text);
}

function auditClause(fromFile: string, spec: string, defaultName: string | null, namedBody: string | null): void {
  const target = resolveSpecifier(fromFile, spec);
  if (!target || !clientModules.has(target)) return;
  const text = textOf.get(fromFile) ?? "";
  if (defaultName && calledSomewhere(text, defaultName)) {
    violations.push({ file: fromFile, spec, binding: defaultName });
  }
  if (namedBody) {
    for (const rawEntry of namedBody.split(",")) {
      const entry = rawEntry.trim();
      if (entry === "" || entry.startsWith("type ")) continue;
      // "X as Y" binds locally as Y
      const asMatch = /\bas\s+(\w+)$/.exec(entry);
      const localName = asMatch ? asMatch[1] : entry;
      if (calledSomewhere(text, localName)) {
        violations.push({ file: fromFile, spec, binding: localName });
      }
    }
  }
}

for (const f of files) {
  if (clientModules.has(f)) continue; // client → client is always native
  const text = textOf.get(f) ?? "";
  let m: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(text)) !== null) {
    if (m[1]) continue; // `import type {…}` — erased at runtime
    auditClause(f, m[4], m[2] ?? null, m[3]);
  }
  DEFAULT_RE.lastIndex = 0;
  while ((m = DEFAULT_RE.exec(text)) !== null) {
    auditClause(f, m[2], m[1], null);
  }
}

// ── Explicit regression pins for the r309 fix ────────────────────────────────
const fails: string[] = [];

const relayCore = join(SRC, "lib", "relay-core.ts");
if (!textOf.has(relayCore)) fails.push("relay-core.ts missing");
else if (clientModules.has(relayCore)) fails.push('relay-core.ts must NOT carry "use client"');

const engine = textOf.get(join(SRC, "lib", "agent-engine.ts")) ?? "";
if (!engine.includes('from "./relay-core"')) {
  fails.push('agent-engine.ts must import the failure classifiers from "./relay-core"');
}

const relay = textOf.get(join(SRC, "lib", "relay.ts")) ?? "";
for (const name of ["isSoftRelayFailure", "isAuthRelayFailure", "isDeadlyRelayFailure", "isHardRelayFailure"]) {
  if (!relay.includes(name)) fails.push(`relay.ts must keep re-exporting ${name} for client import paths`);
}

for (const v of violations) {
  fails.push(
    `server-graph module CALLS client-module export ${v.binding}() from "${v.spec}" → ${v.file.replace(SRC + "/", "")} (throws "Attempted to call … from the server")`,
  );
}

console.log(`qa-iso-boundary: scanned ${files.length} files, ${clientModules.size} client modules`);
if (fails.length > 0) {
  for (const f of fails) console.log(`FAIL ${f}`);
  console.log(`qa-iso-boundary: ${fails.length} violation(s)`);
  process.exit(1);
}
console.log("qa-iso-boundary: PASS — no server-graph module executes client-module code");
