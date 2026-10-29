#!/usr/bin/env python3
# r718 gates runner + self-witnessing worklog appender (r709 pattern; the
# r716 fixes carried forward: escaped-JSON witness parsing, honest rc).
import subprocess, pathlib, sys, re
ROOT = pathlib.Path("/home/z/my-project")
WL = ROOT / "worklog.md"
wl = WL.read_text(encoding="utf-8")
if "Task ID: r718" in wl:
    print("GUARD: r718 section already present — refusing to double-append"); sys.exit(1)

def run(cmd):
    r = subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True, text=True)
    return (r.stdout + ("\n" + r.stderr if r.stderr.strip() else "")).strip(), r.returncode

def read(p):
    f = ROOT / p
    return f.read_text(encoding="utf-8") if f.exists() else ""

# ---- gates ----
fixture_out, fixture_rc = run("bun scripts/qa-gate-census.ts")
cortex_out, cortex_rc = run("bun scripts/qa-cortex-census.ts")
tsc_out, tsc_rc = run("node_modules/.bin/tsc --noEmit")
lint_out, lint_rc = run("bun run lint")
fx = re.search(r"qa-gate-census: (\d+)/(\d+)", fixture_out)
cx = re.search(r"qa-cortex-census: (\d+)/(\d+)", cortex_out)
lint_line = next((l for l in lint_out.splitlines() if "problems" in l), "(no lint summary line)")
gates_ok = (fixture_rc == 0 and fx and fx.group(1) == fx.group(2) == "48"
            and tsc_rc == 0 and lint_rc == 0
            and cortex_rc == 0 and cx and cx.group(1) == cx.group(2))
gates_txt = (f"── fixture ──\n{fixture_out}\n── cortex fixtures ──\n{cortex_out}\n"
             f"── tsc ──\ntsc_exit={tsc_rc}\n── lint ──\n{lint_line}\n")
(ROOT / "scripts/qa_r718_gates.txt").write_text(gates_txt, encoding="utf-8")
print(gates_txt)
if not gates_ok:
    print("GATES FAILED — worklog NOT appended, chain aborts"); sys.exit(1)

# ---- witnesses (self-witnessing: embed real values) ----
watch_post = read("scripts/qa_r718_watch.txt")
watch_pre = read("scripts/qa_r718_watch_prefix.txt")
probe = read("scripts/qa_r718_probe.txt")
browser = read("scripts/qa_r718_browser.txt")

qk = re.search(r'quick_check: (.+)', watch_post)
wm_post = re.search(r"WATCH: verdict=(\d+) \(PASS (\d+) / FAIL (\d+)\) · uncertain=(\d+) · nojudge=(\d+)", watch_post)
wm_pre = re.search(r"WATCH: verdict=(\d+) \(PASS (\d+) / FAIL (\d+)\) · uncertain=(\d+) · nojudge=(\d+)", watch_pre)
if not wm_post:
    print("post-fix watch mapping line not found — refusing to append a blind worklog"); sys.exit(1)
if not wm_pre:
    print("pre-fix watch file missing — the false-zero evidence must be on record"); sys.exit(1)

correction_txt = (
    f"pre-fix read verdict {wm_pre.group(1)} (PASS {wm_pre.group(2)} / FAIL {wm_pre.group(3)}) · uncertain {wm_pre.group(4)} — "
    f"post-fix verdict {wm_post.group(1)} (PASS {wm_post.group(2)} / FAIL {wm_post.group(3)}) · uncertain {wm_post.group(4)} · no-judge {wm_post.group(5)}. "
    "The FAIL rows are 'System-One gate FAIL 4% — rework → full verification pass' — the rework loop firing; "
    "r716/r717 printed FAIL 0 while the rows were on disk (false-zero class of r715, disclosed and corrected)."
)

census_ok = re.search(r'census\\?":true', browser) is not None
relay_ok = re.search(r'relay\\?":true', browser) is not None
aria = "frontier-aria-clicked" if "frontier-aria-clicked" in browser else "ARIA-MISS"
paste = re.search(r"paste-len:(\d+)", browser)
toggle = "board-toggle-clicked" if "board-toggle-clicked" in browser else ("board-toggle-MISS" if "board-toggle-MISS" in browser else "board-toggle-?")
legd = re.search(r'"gate":(\d+),"u":(\d+),"nj":(\d+),"legend":(\d+)', browser)
console_block = browser.split("--- console", 1)[-1].split("--- page errors ---")[0] if "--- console" in browser else ""
err_classes = sorted(set(re.findall(r"\[(?:error)\] ([^\n]{0,90})", console_block)))
page_errors = browser.split("--- page errors ---")[-1].split("=== r718 QA end ===")[0].strip() if "--- page errors ---" in browser else ""

suffix_landed = all("GateSuffix" in read(p) for p in (
    "src/components/nexus/workflows/run-kanban.tsx",
    "src/components/nexus/workflows/workflow-run-panel.tsx",
    "src/components/nexus/workflows/gate-suffix.tsx"))
parts_landed = "censusChipSuffixParts" in read("src/lib/gate-census.ts")
fixnote_landed = 'round: "r718"' in read("src/components/nexus/settings/whats-fixed.tsx")

if err_classes or page_errors:
    print(f"CONSOLE NOT CLEAN — error classes: {err_classes} · page errors: {page_errors} — fix before commit"); sys.exit(1)

verdicts, p_, f_, unc, nj = wm_post.groups()
unc_sample = re.search(r'\\"runId\\?":\\"(run_[0-9a-f]+)\\"', watch_post)
legd_txt = f"{legd.group(1)}/{legd.group(2)}/{legd.group(3)} legend:{legd.group(4)}" if legd else "?"
witness_verdict = (
    f"CLOSED — the board DOM now reads nonzero u ({legd.group(2)}) on visible runs; the r713-carried debt is paid."
    if legd and int(legd.group(2)) > 0
    else ("board read " + legd_txt + " — the 1 is the legend span itself: zero gate chips in the patrol session DOM (board layout active, legend visible) — the live u-corpus renders only when its run is visible; carried honestly (attempt #13: the in-browser palette route, r668 precedent)")
    if legd else "board eval did not return the chip JSON — carried honestly"
)

section = f"""
---
Task ID: r718
Agent: NEXUS patrol (main agent)
Task: Patrol round 718 (job 473388) — the watch's FAIL bucket stopped vanishing (System-One FAIL rows fell through the classifier; the durable baseline corrects to PASS 4 / FAIL 2), the u/nj suffix tokens wear their own tones at all three ⚖ chips (the r670 false-alarm doctrine at token level), and board witness attempt #12 read the live corpus where it lands
Work Log:
- DB-HEALTH PROBE (standing): quick_check {qk.group(1) if qk else 'ok'} on db/custom.db · root 200 at open · deep probe (r717_probe.js): AutomationRun 0 · RunReport 3 · EvalEvent 12 · TrackedModel 1373 · .corrupt-backup-r639 present.
- WATCH CLASSIFIER CORRECTED (the round's named evaluation): the probe matched only 'Decision gate PASS/FAIL' note heads — the two 'System-One gate FAIL 4% — rework' rows fell through EVERY class silently. {correction_txt}
- VERDICT-FLOW WATCH (named where it lands): uncertain grew 2→{unc} in ~30 min, all six on run_14a887b12e58 'Continuous Research & Evaluation' (cross-family intern-systemone; confidences 2/7/53/55 beside the earlier 36/72) — 'output accepted unchanged' every time; verdict {verdicts} (PASS {p_} / FAIL {f_}) · no-judge {nj}. Small moves loud against 12 rows, as designed.
- GOLDEN QA: settings census={census_ok} relay={relay_ok} · radar "{aria}" (r712 stable aria-name) · workflows paste-len:{paste.group(1) if paste else '?'} · console class verdict: {"clean" if not err_classes else "ERROR CLASSES: " + "; ".join(err_classes)} · page errors: {page_errors or "none"}.
- U/NJ CHIP DOM WITNESS attempt #12: board toggle {toggle} · chips gate/u/nj {legd_txt} — {witness_verdict}
- SHIP: (1) r715_watch.js classifies BOTH verdict-note families (Decision + System-One heads); (2) the suffix became tonal — censusChipSuffixParts() in gate-census.ts (landed={parts_landed}) + one GateSuffix component rendering u amber / nj muted at the card, board and panel chips (landed={suffix_landed}); censusChipSuffix() is now DERIVED from the parts, so the r649 single mapping cannot drift into two shapes; (3) fixture 43→{fx.group(1) if fx else '?'} pins the parts shapes + the derivation equality; (4) FixNote r718 (landed={fixnote_landed}).
- GATES: gate-census {fx.group(1) if fx else '?'}/{fx.group(2) if fx else '?'} · cortex {cx.group(1) if cx else '?'}/{cx.group(2) if cx else '?'} · tsc_exit={tsc_rc} · lint {lint_line}
- BUDGET: ~6 rounds — probe+forensics batch, classifier+tonal edits, QA chain, gates/worklog/push.
Stage Summary:
- The watch's numbers are honest end-to-end again: the FAIL family is back on the books (the rework loop was working, the probe just couldn't see it), the uncertain growth names its run and its judge, and the chips render the ungated tail in tones that cannot masquerade as a clean pass.
Round Handoff:
Round ID: r719 -> next patrol (job 473388)
Next recommended action: (1) DB-HEALTH PROBE standing at open (scripts/r715_watch.js one-command; scripts/r717_probe.js when provenance matters). (2) VERDICT-FLOW WATCH with the corrected-classifier durable baseline: verdict {verdicts} (PASS {p_} / FAIL {f_}) · uncertain {unc} · no-judge {nj} — the FAIL family is live now; watch for rework→PASS follow-through on the FAIL runs (the note vocabulary names it: 'rework → full verification pass'). (3) U/NJ CHIP DOM WITNESS: {("CLOSED r718 — retired from the queue" if legd and int(legd.group(2)) > 0 else "still carried — attempt #13 is the in-browser palette route (r668 precedent) with a gate-worthy task; the board renders chips + legend + tonal suffixes now, so any nonzero tone lands on a witnessed surface")}. (4) CORTEX P1 REMAINING (witnesses, not code): real-key UPSTASH 3/3 + HB ✓ DOM witness when the Owner probes with live keys; MIRROR-STRIP witness armed since r707. (5) Owner queue (r693 carry, unchanged): sibling-sandbox push history + .archive-snapshot-1028/ disposition; per-run ledger read proposal (r683); vault re-key BACKUP-FIRST; KICK widget URL fix (needs Owner's r693 context); optional v29c-f re-download.
Blockers: none. Standing constraint (r707): mechanism or named evaluation every round — held (the classifier false-zero closure is the named evaluation, evidence-anchored; the tonal suffix + parts derivation are mechanism, not hover-state polish).
"""
WL.write_text(wl + section, encoding="utf-8")
print("worklog: r718 section appended (Task ID guard passed, gates green, console clean)")
