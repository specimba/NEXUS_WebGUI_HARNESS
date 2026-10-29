#!/usr/bin/env python3
# r718 guarded edits (r713 pattern: exact-match count==1 + idempotent SKIP;
# drift exits 1, nothing forced):
#   E1  scripts/r715_watch.js       — BOTH verdict-note families classify
#                                     (the System-One FAIL rows fell through
#                                     every class and printed a false FAIL 0)
#   E2  src/lib/gate-census.ts      — censusChipSuffixParts() + censusChipSuffix()
#                                     derived from parts (single mapping, 2 shapes)
#   E3  run-kanban.tsx              — import + card chip + board chip -> <GateSuffix/>
#   E4  workflow-run-panel.tsx      — import + panel chip -> <GateSuffix/>
#   E5  gate-suffix.tsx             — NEW tonal suffix component (u amber, nj muted)
#   E6  qa-gate-census.ts           — parts pins 43 -> 48
#   E7  whats-fixed.tsx             — FixNote r718 (one-line object, r712+ format)
import pathlib, sys

ROOT = pathlib.Path("/home/z/my-project")


def guarded(rel, old, new, label):
    p = ROOT / rel
    t = p.read_text(encoding="utf-8")
    if new in t and old not in t:
        print(f"SKIP (already applied): {label}")
        return
    n = t.count(old)
    if n != 1:
        print(f"GUARD FAIL ({label}): anchor count {n} != 1 — aborting, nothing forced")
        sys.exit(1)
    p.write_text(t.replace(old, new, 1), encoding="utf-8")
    print(f"landed: {label}")


# ---- E1: watch classifier, both verdict families ----
guarded(
    "scripts/r715_watch.js",
    """  else if (/Decision gate PASS/i.test(t)) pass += 1;
  else if (/Decision gate FAIL/i.test(t)) fail += 1;""",
    """  // r718: BOTH verdict-note families count — the "System-One gate FAIL 4% —
  // rework" rows fell through the Decision-gate-only patterns into NO class
  // and printed a false FAIL 0 (two such rows predate r717's read; the r712
  // real-mapping doctrine applied to the watch itself, again).
  else if (/\\b(?:Decision|System-One) gate PASS\\b/i.test(t)) pass += 1;
  else if (/\\b(?:Decision|System-One) gate FAIL\\b/i.test(t)) fail += 1;""",
    "E1a watch classifier both-families",
)
guarded(
    "scripts/r715_watch.js",
    "console.log(`WATCH: verdict=${pass + fail} (PASS ${pass} / FAIL ${fail}) · uncertain=${unc} · nojudge=${nj}   [remapped durable baseline · r716 read 1/2/0 — pre-remap 31/30/8 provenance closed r717]`);",
    "console.log(`WATCH: verdict=${pass + fail} (PASS ${pass} / FAIL ${fail}) · uncertain=${unc} · nojudge=${nj}   [durable baseline · r717 printed FAIL 0 — a classifier false zero, both verdict-note families counted since r718]`);",
    "E1b watch label truth refresh",
)

# ---- E2: gate-census.ts — parts + derived string ----
guarded(
    "src/lib/gate-census.ts",
    """export function censusChipSuffix(census: Pick<GateCensus, "uncertain" | "noJudge">): string {
  return (
    (census.uncertain > 0 ? ` · ${census.uncertain}u` : "") +
    (census.noJudge > 0 ? ` · ${census.noJudge}nj` : "")
  );
}""",
    """// r718: the suffix became TONAL — a plain "· 4u" tail inside an emerald PASS
// chip inherits the chip's healthy color and masquerades as clean health (the
// r670 false-alarm doctrine at token level). The parts expose each token with
// its tone for the render sites; censusChipSuffix() stays as the string form,
// now DERIVED from the parts, so the two shapes cannot drift.
export type CensusSuffixTone = "uncertain" | "nojudge";
export interface CensusSuffixPart {
  text: string;
  tone: CensusSuffixTone;
}
export function censusChipSuffixParts(
  census: Pick<GateCensus, "uncertain" | "noJudge">
): CensusSuffixPart[] {
  const parts: CensusSuffixPart[] = [];
  if (census.uncertain > 0)
    parts.push({ text: ` · ${census.uncertain}u`, tone: "uncertain" });
  if (census.noJudge > 0)
    parts.push({ text: ` · ${census.noJudge}nj`, tone: "nojudge" });
  return parts;
}

export function censusChipSuffix(census: Pick<GateCensus, "uncertain" | "noJudge">): string {
  return censusChipSuffixParts(census)
    .map((p) => p.text)
    .join("");
}""",
    "E2 gate-census parts + derived string",
)

# ---- E3: run-kanban.tsx — import + two chips ----
guarded(
    "src/components/nexus/workflows/run-kanban.tsx",
    'import { gateCensusOf, censusChipSuffix } from "@/lib/gate-census";',
    'import { gateCensusOf } from "@/lib/gate-census";\nimport { GateSuffix } from "@/components/nexus/workflows/gate-suffix";',
    "E3a run-kanban import",
)
guarded(
    "src/components/nexus/workflows/run-kanban.tsx",
    "{censusChipSuffix(census)}",
    "<GateSuffix census={census} />",
    "E3b run-kanban card chip tonal",
)
guarded(
    "src/components/nexus/workflows/run-kanban.tsx",
    "{censusChipSuffix(boardGates)}",
    "<GateSuffix census={boardGates} />",
    "E3c run-kanban board chip tonal",
)

# ---- E4: workflow-run-panel.tsx — import + chip ----
guarded(
    "src/components/nexus/workflows/workflow-run-panel.tsx",
    'import { gateCensusOf, censusChipSuffix } from "@/lib/gate-census";',
    'import { gateCensusOf } from "@/lib/gate-census";\nimport { GateSuffix } from "@/components/nexus/workflows/gate-suffix";',
    "E4a panel import",
)
guarded(
    "src/components/nexus/workflows/workflow-run-panel.tsx",
    "{censusChipSuffix(census)}",
    "<GateSuffix census={census} />",
    "E4b panel chip tonal",
)

# ---- E5: the tonal component (new file) ----
GS = ROOT / "src/components/nexus/workflows/gate-suffix.tsx"
GS_BODY = """// r718: the u/nj suffix tokens wear their own tones at every ⚖ chip —
// uncertain in amber (the judge answered below confidence), no-judge muted
// (the step ran ungated) — so an emerald PASS chip can no longer read a
// hidden u/nj tail as clean health (the r670 false-alarm doctrine, now at
// token level). One component, three chips (the r649 single-mapping
// doctrine, render side); the string form in gate-census.ts is DERIVED from
// the same parts, so the vocabulary cannot drift.
import { censusChipSuffixParts } from "@/lib/gate-census";

const TONE: Record<"uncertain" | "nojudge", string> = {
  uncertain: "text-amber-600 dark:text-amber-400",
  nojudge: "text-muted-foreground",
};

export function GateSuffix({
  census,
}: {
  census: { uncertain: number; noJudge: number };
}) {
  const parts = censusChipSuffixParts(census);
  if (parts.length === 0) return null;
  return (
    <>
      {parts.map((p) => (
        <span key={p.tone} className={TONE[p.tone]}>
          {p.text}
        </span>
      ))}
    </>
  );
}
"""
if GS.exists() and "GateSuffix" in GS.read_text(encoding="utf-8"):
    print("SKIP (already applied): E5 gate-suffix.tsx")
else:
    GS.write_text(GS_BODY, encoding="utf-8")
    print("landed: E5 gate-suffix.tsx (new)")

# ---- E6: fixture pins 43 -> 48 ----
guarded(
    "scripts/qa-gate-census.ts",
    'import { censusChipSuffix, gateCensusOf } from "../src/lib/gate-census";',
    'import { censusChipSuffix, censusChipSuffixParts, gateCensusOf } from "../src/lib/gate-census";',
    "E6a fixture import",
)
guarded(
    "scripts/qa-gate-census.ts",
    'check("suffix: wired to the toned adapter shape", censusChipSuffix(toned) === " · 1u · 1nj");',
    """check("suffix: wired to the toned adapter shape", censusChipSuffix(toned) === " · 1u · 1nj");

// 17. r718: the suffix became TONAL — parts expose each token so the render
// sites can color them (u amber, nj muted); the string form is DERIVED from
// the parts, so the vocabulary cannot drift (one mapping, two shapes).
check("parts: zero census -> empty array", censusChipSuffixParts({ uncertain: 0, noJudge: 0 }).length === 0);
check("parts: u-only shape+tone", (() => { const p = censusChipSuffixParts({ uncertain: 2, noJudge: 0 }); return p.length === 1 && p[0].text === " · 2u" && p[0].tone === "uncertain"; })());
check("parts: nj-only shape+tone", (() => { const p = censusChipSuffixParts({ uncertain: 0, noJudge: 3 }); return p.length === 1 && p[0].text === " · 3nj" && p[0].tone === "nojudge"; })());
check("parts: both tones ordered u-then-nj", (() => { const p = censusChipSuffixParts({ uncertain: 2, noJudge: 3 }); return p.length === 2 && p[0].tone === "uncertain" && p[1].tone === "nojudge"; })());
check("string form derived from parts", censusChipSuffix({ uncertain: 2, noJudge: 3 }) === censusChipSuffixParts({ uncertain: 2, noJudge: 3 }).map((p) => p.text).join(""));""",
    "E6b fixture parts pins",
)

# ---- E7: FixNote r718 (one-line object; anchor = r717 entry tail) ----
FIXNOTE = """  { round: "r718", title: "The u/nj tokens stopped masquerading inside clean chips — and the watch's FAIL bucket stopped vanishing", detail: "Two mapping corrections from one morning of live corpus. Chip side: an emerald PASS chip could carry a plain-text '· 4u' tail that inherited the chip's healthy color — the r670 false-alarm doctrine (a FAIL verdict in an emerald chip misreads as success) applied at token level. The suffix now renders as tonal spans (u amber, nj muted) through one GateSuffix component fed by censusChipSuffixParts(); censusChipSuffix() survives as the derived string form, so the r649 single-mapping cannot drift apart. Watch side: r717 printed verdict 4 (PASS 4 / FAIL 0) while the durable table held TWO 'System-One gate FAIL 4% — rework' rows the probe's Decision-gate-only patterns let fall through every class — a false zero of the same class as r715's. Both verdict-note families count now; the corrected durable baseline reads verdict 6 (PASS 4 / FAIL 2) · uncertain 6, and the six uncertain rows all land on one live run (Continuous Research & Evaluation; cross-family intern-systemone; confidences 2-72%) while the two FAILs name the rework loop doing its job.", lookFor: "Workflows: on a run with uncertain judges the ⚖ chip's u token wears amber while a PASS verdict line stays emerald; scripts/r715_watch.js prints verdict=6 (PASS 4 / FAIL 2) — FAILs no longer vanish; scripts/qa-gate-census.ts prints the extended count green." },"""
guarded(
    "src/components/nexus/settings/whats-fixed.tsx",
    'db mtime." },\n];',
    f'db mtime." }},\n{FIXNOTE}\n];',
    "E7 FixNote r718",
)

# ---- verification tail ----
gc = (ROOT / "src/lib/gate-census.ts").read_text(encoding="utf-8")
rk = (ROOT / "src/components/nexus/workflows/run-kanban.tsx").read_text(encoding="utf-8")
rp = (ROOT / "src/components/nexus/workflows/workflow-run-panel.tsx").read_text(encoding="utf-8")
fx = (ROOT / "scripts/qa-gate-census.ts").read_text(encoding="utf-8")
wf = (ROOT / "src/components/nexus/settings/whats-fixed.tsx").read_text(encoding="utf-8")
ok = (
    "censusChipSuffixParts" in gc
    and "GateSuffix" in rk and "censusChipSuffix" not in rk
    and "GateSuffix" in rp and "censusChipSuffix" not in rp
    and 'round: "r718"' in wf
    and fx.count("check(") >= 48
    and 'b(?:Decision|System-One) gate FAIL' in (ROOT / "scripts/r715_watch.js").read_text(encoding="utf-8")
)
print("VERIFY:", "OK" if ok else "MISMATCH")
sys.exit(0 if ok else 1)
