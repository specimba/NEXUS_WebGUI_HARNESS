#!/usr/bin/env node
// r361 — audio routes join the classification doctrine (probe)
// CONTRACT: /api/transcribe + /api/tts classify provider failures via the
// shared r347 classifier (single source — no forked vocabulary), return
// { error, kind } with 502 for upstream failures while 400/413 validation
// stays ours; unknown kind preserves the raw message; both clients attach
// the kind to the thrown Error and use warning tone ONLY for self-healable
// kinds (rate-limit / maintenance).
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "/home/z/my-project";
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const transcribe = read("src/app/api/transcribe/route.ts");
const tts = read("src/app/api/tts/route.ts");
const composer = read("src/components/nexus/chat/composer.tsx");
const chatView = read("src/components/nexus/chat/chat-view.tsx");

let pass = 0, fail = 0;
const results = [];
function check(name, ok) {
  if (ok) { pass++; results.push(`  PASS  ${name}`); }
  else { fail++; results.push(`  FAIL  ${name}`); }
}

for (const [name, src, failWord] of [["transcribe", transcribe, "Transcription failed"], ["tts", tts, "Speech generation failed"]]) {
  check(`[${name}] imports the shared classifier (no forked vocabulary)`,
    src.includes('import { classifyProviderError } from "@/lib/billing-classify";'));
  check(`[${name}] extracts numeric .status from the SDK error`,
    /const sdkStatus = \(err as \{ status\?: unknown \}\)\.status;\s*\n\s*const status = typeof sdkStatus === "number" \? sdkStatus : 0;/.test(src));
  check(`[${name}] classifies with (status, raw message-as-body)`,
    new RegExp(`classifyProviderError\\(status, raw\\)`).test(src));
  check(`[${name}] returns { error, kind } — kind in the body`,
    /kind: cls\.kind/.test(src) && /error: cls\.kind === "unknown" \? raw : cls\.message/.test(src));
  check(`[${name}] upstream failures speak 502 (body-over-status)`,
    /\{ status: 502 \}/.test(src));
  check(`[${name}] own validation codes untouched (400/413 still ours)`,
    /status: 400/.test(src) && /status: 413/.test(src));
  check(`[${name}] raw fallback label preserved for unknown`, src.includes(failWord));
  check(`[${name}] doctrine clause ② cited (billing outranks status)`,
    src.includes("Billing wording\n    // still outranks the status") || src.includes("billing wording outranks status"));
}

// ── clients: kind-aware toast tone ──
for (const [name, src, label, failLabel] of [
  ["composer voice input", composer, "Voice input failed", "Voice input failed — safe to retry"],
  ["read-aloud", chatView, "Read-aloud failed", "Read-aloud failed — safe to retry"],
]) {
  check(`[${name}] response type includes kind?: string`, /kind\?: string/.test(src));
  check(`[${name}] kind attached to the thrown Error`,
    /\(e as Error & \{ kind\?: string \}\)\.kind = (json|j)\.kind;/.test(src));
  check(`[${name}] warning tone reserved for self-healable kinds`,
    new RegExp(`${kindAlt()}\\) \\{\\s*\\n\\s*(//[^\\n]*\\n\\s*)*toast\\.warning\\("${failLabel}"`).test(src));
  check(`[${name}] terminal kinds keep error tone`,
    src.includes(`toast.error("${label}"`));
  check(`[${name}] self-healable set = rate-limit + maintenance (classifier union)`,
    /kind === "rate-limit" \|\| kind === "maintenance"/.test(src));
}

function kindAlt() {
  return 'kind === "rate-limit" \\|\\| kind === "maintenance"';
}

// ── regression: doctrine anchors untouched ──
const classifier = read("src/lib/billing-classify.ts");
check("classifier still exports OUT_OF_CREDITS_ADVICE (single advice source)",
  classifier.includes("export const OUT_OF_CREDITS_ADVICE"));
check("images route still the r347 precedent (unchanged consumer)",
  read("src/app/api/images/generate/route.ts").includes("classifyProviderError(res.status, text)"));
check("composer voice kinds never re-read by regexes elsewhere (UI-only compare)",
  !/"rate-limit".*quota|quota.*"rate-limit"/i.test(composer));

// ── house style ──
check("no /quota/i vocabulary added in routes",
  !/quota/i.test(transcribe) && !/quota/i.test(tts));

// ── report ──
console.log(`probe-r361-audio-classification: ${pass} pass / ${fail} fail`);
for (const r of results) console.log(r);
process.exit(fail === 0 ? 0 : 1);
