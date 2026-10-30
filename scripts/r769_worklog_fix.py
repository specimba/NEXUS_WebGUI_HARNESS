#!/usr/bin/env python3
"""r769 post-close worklog append fix (r767 precedent).

The in-close heredoc died on a wrapper-integrity defect: the close-script
builder replaced the Task line via a substring anchor with a full-line string
that DROPPED the L.append( wrapper - python parsed the bare prose as code and
died on the 03:03:43 leading zero BEFORE appending. Ship commit cd693b3ce
(8 files), the dual push and the sweep tee had already succeeded. This script
appends the r769 section post-close with post-close GATES re-reads, probes
re-read from the tee artifacts, and the defect disclosed in-section."""

import json
import os
import sqlite3
import subprocess

ROOT = "/home/z/my-project"


def run(cmd, timeout=90):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout, cwd=ROOT)


# ---- post-close GATES re-reads (live) ----
gc = run("timeout 60 bun scripts/qa-gate-census.ts 2>&1 | tail -1").stdout.strip()
cc = run("timeout 60 bun scripts/qa-cortex-census.ts 2>&1 | tail -1").stdout.strip()
con = sqlite3.connect("file:%s/db/custom.db?mode=ro" % ROOT, uri=True)
cur = con.cursor()
n = cur.execute("select count(*) from EvalEvent").fetchone()[0]
nj = cur.execute("select count(*) from EvalEvent where kind='gate-no-judge'").fetchone()[0]
vd = cur.execute("select count(*) from EvalEvent where kind='gate-verdict'").fetchone()[0]
un = cur.execute("select count(*) from EvalEvent where kind='gate-uncertain'").fetchone()[0]
runs = cur.execute("select count(distinct runId) from EvalEvent").fetchone()[0]
try:
    wf = cur.execute("select count(*) from AutomationWorkflow").fetchone()[0]
except Exception:
    wf = "?"
cen = json.dumps({"total": n, "runs": runs, "verdict": vd, "uncertain": un, "nj": nj, "wf": wf})
con.close()
corpus_snaps = sorted(s for s in os.listdir(ROOT + "/db/corpus-snapshots") if s.startswith("corpus-"))
snap = corpus_snaps[-1] if corpus_snaps else ""
assert snap.startswith("corpus-2026-10-30T03-58-32"), "snapshot #25 missing: %s" % snap

# ---- probes re-read from the tee artifacts ----
qa_main = open(ROOT + "/scripts/qa_r769.txt", encoding="utf-8").read()
qa_close = open(ROOT + "/scripts/qa_r769_close.txt", encoding="utf-8").read()


def grab(txt, prefix):
    for line in txt.split("\n"):
        if line.startswith(prefix):
            return line.strip()
    raise AssertionError("missing probe line: %s" % prefix)


board = grab(qa_main, "board: ")
ld = grab(qa_main, "ld: ")
settings = grab(qa_main, "settings: ")
radar = grab(qa_main, "radar: ")
paste = grab(qa_main, "paste: ")
chip = grab(qa_close, "chip: ")
legend = grab(qa_close, "legend: ")
tier = grab(qa_close, "tier state: ")
strip = grab(qa_close, "wave strip: ")
div = grab(qa_close, "divergence: ")
lf = grab(qa_close, "lane filter: ")
board_flat = board.replace("\\", "")
ld_flat = ld.replace("\\", "")
assert '"strip":true' in board_flat and '"ld":true' in ld_flat, "QA artifact legs not green"
assert "q-lean" in tier and "quiet" in tier, "tier-state probe missing the lean/quiet witnesses"

L = []
L.append("")
L.append("---")
L.append("")
L.append("Task ID: r769")
L.append("Agent: NEXUS patrol (main agent - job 473388, 11:37 slot; opened on the r768 handoff - HEAD d280bcd42 = the r768 ship + sweep from the 11:07 slot, own-session lineage, no parallel round closed)")
L.append("Task: Patrol round 769 - QUIET READOUT SHIPS, WAVE-10 OPEN WATCH: the opening ro-SQL census read 133 ev / 35 runs / 97 nj - FLAT vs the r768 close (133/35/21/15/97, newest ~03:03:43 UTC = wave 10); no wave 11 at open, ~34 min quiet at the 11:37 +08 open - inside the band (13-42-62-57-61, plateauing near ~60), no break; verdict/uncertain flat 21/15 with no new wave since wave 10. Route: the lean is CEMENTED per the r768 watch - four straight q (00:03, 01:05, 02:02, 03:03) - and the on-page counter should read q-lean x4. Shipped the quiet readout (the zero-growth half of the cadence watch that laneGap cannot state): laneQuiet computes minutes elapsed since the newest corpus row of the newest shown bucket (bounds max-to-now, the same bounds the strip hover shows); the clock read is gated behind mount so SSR and hydration agree (no mismatched timestamp on first paint), and a negative delta guards clock skew. The readout renders in the corpus tier-state line after the interval readout (+Nm quiet style, font-medium text-foreground/70 matching the strip letters) with its own title documenting the semantics, and the tier-state title gains the quiet sentence. The burst-ended watch is now an on-page read: a stretch past the band ceiling with no new wave shows as a growing quiet count without deriving it from the strip. Honest scoping: no new data source.")
L.append("Work Log:")
L.append("- R1 open probes: no parallel session - HEAD d280bcd42 was the r768 ship + sweep (own-session lineage); tree clean; server 200; ro-SQL census 133/35/21/15/97 - FLAT vs the r768 close, no wave 11 at open (~34 min quiet, newest ~03:03:43 UTC = wave 10) -> steady-watch path with the quiet-readout increment.")
L.append("- R2 templates: r769_qa.sh + r769_close.sh via the DUAL sed pattern (s/r=768/r=769/g + s/r768/r769/g) applied to the r767 templates recovered from git history (the swept tree no longer carries them) - zero mechanical remnants, bash -n green; the round-768 prose gaps (spelled-out Patrol round 768 + the literal Round ID r769 pointer) handled by the builder surgery (scripts/r769_close_build.py, all-or-nothing anchors), new-texts apostrophe-free AND single-quote-free per the r767/r768 lessons - the builder later proved to carry the wrapper defect disclosed below; wave-11 watch armed.")
L.append("- R3 increment (run-kanban.tsx): laneQuiet memo inserted after laneGap - minutes elapsed since the newest corpus row of the newest shown bucket (waveStrip bounds max-to-now, null-guarded when a bound is missing and when the clock delta is negative); the clock read is gated behind a mount state (useState + useEffect) so SSR and hydration agree, and the memo recomputes on mount; the readout renders in the corpus tier-state line after the interval readout (+Nm quiet style, font-medium text-foreground/70 matching the strip letters, own title documenting semantics), and the tier-state title gains the quiet sentence. Three-edit MultiEdit verified in the returned diff (r760/r762 marker-verify discipline honored).")
L.append("- R4 gates: tsc 0 / lint 0 errors (33 warnings baseline) on the increment tree - first-try green (re-checked in-close by the close script).")
L.append("- R5 QA + close: the first QA attempt found the dev server DOWN (curl 000, browser chrome-error legs, zero JS errors - a process death between the open check and QA, not a render break); the single allowed scripts/dev-restart.sh ran clean (poll2=200, detached daemon), warm-up hit green, and the r769 golden QA re-run passed GREEN (board probe at the wave-10 census 35 runs / 133 ev / 97nj, chips 36; ld count 97, seven lanes, no eighth; settings census+relay, radar frontier, 799-char long-paste all green; console 0 errors) - one restart spent, within the per-round allowance. Close probes: chip GATED presence / tone recorded; legend GATED (the tier-state line inside the legend was edited - same view; r756-r769 precedent honored); tier-state probe RECORDED (witnessed q-lean x4, +61m since prior, and the NEW +55m quiet readout live); wave-strip probe presence GATED / text RECORDED; divergence probe RECORDED ONLY; lane-filter tally assertion gated-run green; census + snapshot + commit cd693b3ce + dual push + sweep.")
L.append("- QA PROBES (this close):")
L.append("  " + board)
L.append("  " + ld)
L.append("  chip: " + chip)
L.append("  legend: " + legend)
L.append("  lane filter: " + lf)
L.append("  wave strip: " + strip)
L.append("  divergence: " + div)
L.append("  tier state: " + tier)
L.append("- GATES (post-close re-reads): tsc_exit=0 / lint 0 errors (33 warnings baseline, in-close run) - qa-gate-census " + gc + " - qa-cortex-census " + cc + " - close census " + cen + " - snapshot: " + snap + " (snapshot discipline twenty-fifth close)")
L.append("Stage Summary:")
L.append("- QUIET WATCH COMPLETED: the cadence watch is now a three-legged on-page read - the lean tag (r767), the interval readout (r768) and the quiet readout (r769) state route, gap and staleness in the corpus tier-state line, so cement, break and burst-end are recorded-probe witnesses every round. Zero-growth open (~34 min, inside the band) keeps the burst-ending watch armed but declares nothing; the lean is CEMENTED (four straight q at open) and the counter states it live; the close probe witnessed +55m quiet. Witness seven-legged (board, ld, chip, legend, tier state, lane filter, wave strip) + the divergence census, all green.")
L.append("- CLOSE DEFECT DISCLOSED (r767 precedent, second instance): the in-close worklog heredoc died on a wrapper-integrity defect - the close-script builder replaced the Task line (a substring anchor swapped for a full-line string) and the replacement DROPPED the L.append( wrapper, so python parsed the bare prose as code and died on the 03:03:43 leading zero BEFORE appending; ship commit cd693b3ce (8 files: component, r769 scripts, qa artifacts, snapshot #25), the dual push and the sweep tee had already succeeded. This section was appended post-close by scripts/r769_worklog_fix.py with post-close GATES re-reads. Lesson (extends the r767/r768 quote lessons): full-line replacements must preserve the heredoc line-shape - a builder swapping an L.append line must assert the replacement still starts with L.append( and ends with ).")
L.append("- CANDIDATE NOTE (no deviation): the r768 handoff named no increment candidate (queue: builtin box Owner-asked / TASKS.md re-triage / QA bugs first); this round continued the r759-r768 instrument line with the quiet readout - the cadence watch became a complete on-page trio. The builtin box extraction stays parked for an explicitly requested refactor round.")
L.append("Round Handoff:")
L.append("Round ID: r770 -> next patrol (job 473388)")
L.append("Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r769_qa.sh sed-adapted (DUAL pattern s/r=769/r=770/g + s/r769/r770/g; if the tree was swept again, recover the template from git history like this round did); remember the round-769 prose gaps (spelled-out Patrol round 769 + the literal Round ID r770 pointer - both handled in the close-script builder) AND the surgery lessons: new-text strings must be apostrophe-free AND single-quote-free (the r767 R3 quote defect and the line-96 apostrophe killed that heredoc) AND full-line replacements must preserve the L.append( wrapper (the r769 builder dropped it on the Task line - the second heredoc death in three rounds; assert the replacement starts with L.append( and ends with ) before writing); close probes: chip presence gated / tone recorded; legend probe GATED if the round touches the strip/legend/tier-state/run-card view, else RECORDED; tier-state probe: RECORDED ONLY (carries the lean tag since r767, the interval readout since r768 and the quiet readout since r769); wave-strip probe: presence GATED / text RECORDED; divergence probe: RECORDED ONLY; the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; ROUTE WATCH: the lean is CEMENTED (four straight q, 00:03 through 03:03) - a fifth q deepens it, a g return resets the counter (alternation resumed), an m bucket or m run (both routes, amber, 7 lanes) = the first both-routes witness - investigate; a BOTH-SILENT bucket (3 lanes = genuine partial ladder) = investigate immediately; a lag on intern/fast-judge/jev = genuine partial ladder; any EIGHTH lane (labeled unrouted on sight), a VERDICT/UNCERTAIN growth wave, a NEW wave beyond the close census newest (the strip bucket total rises), or an interval-pattern break (band 13-42-62-57-61 plateauing near ~60 - the on-page interval and quiet readouts are the witnesses now; a gap far outside, or a quiet stretch past ~62, = the burst ended) = new signal. (5) Increment queue: no named candidate - candidates: (a) the builtin box extraction (~90 lines, parked since r567) for an Owner-asked refactor round; (b) TASKS.md re-triage if the Owner unblocks rows; (c) QA-found bugs first, always. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download; AIHubMix relay LEAN CEMENTED (r768): four straight qwen waves (00:03, 01:05, 02:02, 03:03) after the wave-by-wave alternation, now surfaced as the on-page lean counter - the platform report should describe the lean, not an outage. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.")
L.append("Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the quiet readout shipped into a live wave-10 watch - the recorded tier-state probe carries q-lean x4, +61m since prior and +55m quiet - + full golden QA, anchored in scripts/qa_r769.txt and scripts/qa_r769_close.txt).")

with open(ROOT + "/worklog.md", "a", encoding="utf-8") as f:
    f.write("\n".join(L))
print("r769 worklog section appended (post-close fix)")
print("GATES: gc=%s | cc=%s | cen=%s | snap=%s" % (gc, cc, cen, snap))
