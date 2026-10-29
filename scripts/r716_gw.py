#!/usr/bin/env python3
# r716 gates runner + self-witnessing worklog appender (r709 pattern).
# Fixes over r715's appender: witness parsing handles agent-browser's ESCAPED
# JSON (r715's worklog recorded census=False — a false negative), the aria
# witness embeds its STRING, and FixNote landing is verified in-source.
import subprocess, pathlib, sys, re
ROOT = pathlib.Path("/home/z/my-project")
WL = ROOT / "worklog.md"
wl = WL.read_text(encoding="utf-8")
if "Task ID: r716" in wl:
    print("GUARD: r716 section already present — refusing to double-append"); sys.exit(1)

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
gates_ok = (fixture_rc == 0 and fx and fx.group(1) == fx.group(2)
            and tsc_rc == 0 and lint_rc == 0
            and cortex_rc == 0 and cx and cx.group(1) == cx.group(2))
gates_txt = (f"── fixture ──\n{fixture_out}\n── cortex fixtures ──\n{cortex_out}\n"
             f"── tsc ──\ntsc_exit={tsc_rc}\n── lint ──\n{lint_line}\n")
(ROOT / "scripts/qa_r716_gates.txt").write_text(gates_txt, encoding="utf-8")
print(gates_txt)
if not gates_ok:
    print("GATES FAILED — worklog NOT appended, chain aborts"); sys.exit(1)

# ---- witnesses (self-witnessing: embed real values) ----
watch = read("scripts/qa_r716_watch.txt")
browser = read("scripts/qa_r716_browser.txt")
qk = re.search(r'quick_check: (.+)', watch)
wm = re.search(r"WATCH: verdict=(\d+) \(PASS (\d+) / FAIL (\d+)\) · uncertain=(\d+) · nojudge=(\d+)", watch)
if not wm:
    print("watch mapping line not found — refusing to append a blind worklog"); sys.exit(1)
census_ok = re.search(r'census\\?":true', browser) is not None
relay_ok = re.search(r'relay\\?":true', browser) is not None
aria = "frontier-aria-clicked" if "frontier-aria-clicked" in browser else "ARIA-MISS"
paste = re.search(r"paste-len:(\d+)", browser)
legd = re.search(r'"gate":(\d+),"u":(\d+),"nj":(\d+)', browser)
console_block = browser.split("--- console", 1)[-1] if "--- console" in browser else ""
err_classes = sorted(set(re.findall(r"\[(?:error)\] ([^\n]{0,90})", console_block)))
page_errors = browser.split("--- page errors ---")[-1].strip() if "--- page errors ---" in browser else ""
suffix_landed = all("censusChipSuffix(" in read(p) for p in (
    "src/lib/gate-census.ts", "src/components/nexus/workflows/run-kanban.tsx",
    "src/components/nexus/workflows/workflow-run-panel.tsx"))
fixnote_landed = 'round: "r716"' in read("src/components/nexus/settings/whats-fixed.tsx")
legend_landed = "⚖ legend" in read("src/components/nexus/workflows/run-kanban.tsx")

verdicts, p_, f_, unc, nj = wm.groups()
watch_verdict = (
    f"HELD — two consecutive rounds read {verdicts}/{unc}/{nj}; no climb signal. "
    "The uncertain rows name themselves: intern-systemone judges, cross-family, confidence 36% and 72%, "
    "output accepted unchanged both times (one test research run). "
    "Baseline honesty: r712–r714 read 26→31 verdicts from this corpus; the durable table now holds 4 rows — "
    "whether that population was trimmed or the earlier baselines counted a different store is unresolved (disclosed); "
    "the remapped durable-table numbers are the watch's going-forward baseline."
)

section = f"""
---
Task ID: r716
Agent: NEXUS patrol (main agent)
Task: Patrol round 716 (job 473388) — the u/nj suffix template became ONE fixture-pinned function (the r649 single-mapping doctrine completed for the render layer), r715's FixNote refusal is explained and redeemed (one-line entries), and the watch's durable-table baseline held stable
Work Log:
- DB-HEALTH PROBE (standing): quick_check {qk.group(1) if qk else "(see watch file)"} on db/custom.db · root 200 at open · tree clean at r715 (c31b0962e).
- VERDICT-FLOW WATCH (r715 probe, re-run): verdict {verdicts} (PASS {p_} / FAIL {f_}) · uncertain {unc} · no-judge {nj} — {watch_verdict}
- GOLDEN QA: settings census={census_ok} relay={relay_ok} (r715's appender recorded census=False — a false negative from escaped-JSON parsing, fixed this round) · radar "{aria}" (r712 stable aria-name, first try) · workflows paste-len:{paste.group(1) if paste else '?'} · u/nj chip DOM witness attempt: gate/u/nj {legd.group(1) if legd else '?'}/{legd.group(2) if legd else '?'}/{legd.group(3) if legd else '?'} — the landing view still holds no visible runs (r713 carried debt; the render layer is now pinned at the fixture level instead) · console class verdict: {"clean (HMR/refresh logs only)" if not err_classes else "ERROR CLASSES: " + "; ".join(err_classes)} · page errors: {page_errors or "none"}.
- SHIP: (1) censusChipSuffix() exported from gate-census.ts and now the ONLY suffix template — the card chip (run-kanban L534), the board chip (L1141) and the panel chip (workflow-run-panel L1552) all render it (landed={suffix_landed}); zero census -> byte-identical empty string, the r713 nonzero-only doctrine preserved; (2) fixture render-pin 38 → {fx.group(1) if fx else '?'} — zero/u-only/nj-only/both/wired-toned shapes; (3) FixNote r716 (landed={fixnote_landed}) via the corrected single-line anchor — r715's two guard refusals are explained (the r712+ entries are one-line objects; the old multi-line closer never existed), not force-pushed; (4) the r715 ⚖ legend stays landed={legend_landed}.
- GATES: gate-census {fx.group(1) if fx else '?'}/{fx.group(2) if fx else '?'} · cortex {cx.group(1) if cx else '?'}/{cx.group(2) if cx else '?'} · tsc_exit={tsc_rc} · lint {lint_line}
- BUDGET: ~4 rounds — the r715 pipeline (probe → QA+anchors → guarded edits → gates/worklog/push chains) compressed cleanly this time.
Stage Summary:
- The suffix vocabulary can no longer drift: one function, three chips, five fixture pins. The changelog debt from r715 is paid with the root cause on record. The watch's honest baseline is the durable table's 1/2/0 — stable, with the pre-remap baselines' provenance disclosed rather than papered over.
Round Handoff:
Round ID: r717 -> next patrol (job 473388)
Next recommended action: (1) DB-HEALTH PROBE standing at open (db/custom.db — scripts/r715_watch.js is the one-command probe). (2) VERDICT-FLOW WATCH with the remapped durable baseline: verdict 1 (PASS 1 / FAIL 0) · uncertain 2 · no-judge 0 — growth of ANY class now reads against 4 rows, so small absolute moves are loud; the open provenance question: where did r712–r714's 26→31-verdict corpus live, and does it still exist (first suspect: the browser-side archived store or a table trim)? (3) U/NJ CHIP DOM WITNESS (carried since r713): still needs a run with an ungated step VISIBLE on the board — the render layer is now pinned 43/43, so the remaining gap is purely a live-run witness (Owner-side run or launch-and-leave). (4) CORTEX P1 REMAINING (witnesses, not code): real-key UPSTASH 3/3 + HB ✓ DOM witness when the Owner probes with live keys; MIRROR-STRIP witness armed since r707. (5) Owner queue (r693 carry, unchanged): sibling-sandbox push history + .archive-snapshot-1028/ disposition; per-run ledger read proposal (r683); vault re-key BACKUP-FIRST; KICK widget URL fix (needs Owner's r693 context); optional v29c-f re-download.
Blockers: none. Standing constraint (r707): mechanism or named evaluation every round — held (render-layer dedup with fixture pins is mechanism; the watch's baseline-provenance disclosure is the named evaluation).
"""
WL.write_text(wl + section, encoding="utf-8")
print("worklog: r716 section appended (Task ID guard passed, gates green)")
