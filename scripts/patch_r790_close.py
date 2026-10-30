#!/usr/bin/env python3
"""r790: rewrite the sed-inherited r789 narrative inside scripts/r790_close.sh
into the true r790 narrative (the band-docs quiet-watch tie witness at four
sites + the legend-toggle underline polish) before the close runs. Aborts on
mismatch - the r785 pattern."""

PATH = "scripts/r790_close.sh"
src = open(PATH).read()
lines = src.split("\n")

ti = next((i for i, l in enumerate(lines) if "Task ID: r790" in l), -1)
ei = next((i for i, l in enumerate(lines) if "worklog appended" in l), -1)
assert ti != -1 and ei != -1 and ei > ti, "narrative span markers not found"

start = ti
for j in range(ti - 1, max(-1, ti - 5), -1):
    if lines[j].strip() == "L = []":
        start = j
        break
end = ei
old_span = lines[start : end + 1]
for l in old_span:
    ok = (
        l.startswith("L.append(")
        or l.strip() == "L = []"
        or "with open(" in l
        or "f.write" in l
        or "worklog appended" in l
    )
    assert ok, "unexpected line in narrative span: " + repr(l[:90])

new_block = [
    "L = []",
    'L.append("Task ID: r790")',
    'L.append("Agent: NEXUS patrol (main agent - job 473388, 05:07 slot; opened on the r789 handoff; HEAD a9e44188f = the r789 sweep artifact atop 241798fa5; tree CLEAN at open - no parallel-session WIP; server 200 first-try, no restart needed; opening witness: the census flat since the r789 close - no new cadence point)")',
    'L.append("Task: Patrol round 790 - THE BAND DOCS CARRY THE r790 QUIET-WATCH WITNESS at all four on-page sites (no new cadence point: the census held flat and the band stays 20 points ending 61; the zero-growth stretch TIES the 122 band max). (a) QUIET WATCH: no new bucket by 21:08 UTC - the quiet readout rendered +122m at the r790 witness probe, tying the 122 band max (the wave-19 readout, the longest interval on record); the amber past-ceiling regime held across the r788/r789/r790 witnesses (+67/+99/+122m); the clause sits at the Route-state title interval + quiet halves, the interval-readout title and the quiet-readout title. (b) STYLING POLISH: the lanes-tried legend toggle gains the hover underline solidify (dotted to solid on hover) - the affordance reads as clickable on hover.")',
    'L.append("Work Log:")',
    'L.append("- R1 open + scripts + QA FIRST: tree CLEAN at a9e44188f; server 200; r790_qa.sh + r790_close.sh via the DUAL sed (s/r=789/r=790/g + bare-label s/r789/r790/g) from the in-tree r789 scripts (node tsc inherited); the r790 golden QA ran GREEN FIRST-TRY (marker in scripts/qa_r790.txt; board 53 runs / 186 ev / 30 verdicts / 15u / 141nj with chips 54 - census FLAT vs the r789 close, no new bucket; the ld witness held the TEN-lane baseline, no eleventh).")',
    'L.append("- R2 witness: the strip probe read chips 54 / newest chip gapVal 61 held; the tier-state line (after the legend click) rendered bucket q + q-lean x4 + +122m quiet + mid-qwen ACTIVE 1/2 / mid-glm silent 0/2 - the stretch ties the 122 max; RSS ~2.02 GB at ~+448m after the 21:40 restart (next-server 2,015,168 KB at 21:08 UTC, a slight dip from the r789 ~2.05 GB reading - the curve hovers at the stall mark).")',
    'L.append("- R3 increment: the four band-doc sites got the r790 quiet-watch clause (the tie witness, the amber series) + the legend toggle underline polish - the on-page quiet watch is the round user-facing improvement (the record-tying lull reads without the worklog).")',
    'L.append("- R4 gates: pre-close gates ran file-redirected with stdin devnull (node tsc, never bunx on the pipe); the close re-ran both gates on the final tree - see the GATES line.")',
    'L.append("- R5 close: close probes: chip presence GATED / tone recorded; tier-state RECORDED; wave-strip presence GATED / text RECORDED; the bucket-title probes GATED; the letterless-chip probe RECORDED-only; the keyboard-bridge probe GATED; divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (forty-fifth) + worklog + commit + dual push.")',
    'L.append("- GATES: tsc_exit=" + os.environ.get(\'R754_TSC\',\'?\') + " - lint " + os.environ.get(\'R754_LINT\',\'?\') + " - qa-gate-census " + os.environ.get(\'R754_GC\',\'?\') + " - qa-cortex-census " + os.environ.get(\'R754_CC\',\'?\') + " - close census " + os.environ.get(\'R754_CEN\',\'?\') + " - snapshot: " + os.environ.get(\'R754_SNAP\',\'?\'))',
    'L.append("Stage Summary: the quiet-watch tie witness is on-page at four sites with the amber series; no new cadence point (the band stays 20 points); the legend toggle polish shipped; QA green first-try; committed and pushed to origin + fork.")',
    'L.append("")',
    'L.append("Round Handoff:")',
    'L.append("Round ID: r791 -> next patrol (job 473388)")',
    'L.append("Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r790_qa.sh sed-adapted (DUAL pattern s/r=790/r=791/g + bare-label s/r790/r791/g; the r769-r790 scripts are committed in-tree; if swept, recover from git history). ORDER: QA FIRST (the marker gates the close snapshot; the r786 slip is the standing lesson). (2) SNAPSHOT DISCIPLINE: forty-sixth. (3) TIMEOUT HYGIENE: node tsc (never bunx on the pipe), long children file-redirected with stdin devnull. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; TEN lane labels; an ELEVENTH = unrouted on sight. ROUTE WATCH: THE QUIET WATCH IS THE LIVE DUTY - the stretch tied the 122 band max at the r790 witness (+122m rendered, amber since r788): IF a new bucket landed, execute the band-append quote duty at the four sites (QUOTE THE RENDERED VALUE; provenance convention: check the close record of the PRIOR round for a pre-recorded gapVal - carry the dual-provenance wording; a bucket landing also RESETS the quiet - the final stretch value is then the new band point); if NO bucket landed and the quiet readout now renders PAST 122, the zero-growth stretch is the longest on record - record the pass at all four sites (the genuine cadence-break witness); the band append and the quiet pass are mutually exclusive per round - judge from the live render. (5) CADENCE: band 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62/57/58/122/78/61 (20 points as of r790) - the next point lands after the record-tying lull: another 100+ stretch would signal a regime shift, a 60s return holds the old regime. (6) Increment queue, IN ORDER: (a) QA-found bugs first, always; (b) small verifiable polish/honesty increments; the P1 backlog rows stay Owner-blocked; (c) the builtin box extraction stays parked for an Owner-asked round; (d) TASKS.md re-triage if the Owner unblocks rows. (7) CORTEX P1: the app-side two-paste carrier shipped r787 - the deploy now waits on the Owner source paste; if the Owner reports the probe state, record the edge version + lane matrix in the worklog. (8) Owner queue (carried): PLATFORM REPORT URGENT - three wipes + .archive-snapshot-1028 disposition; THE OOM CEILING - HOVERING AT THE STALL MARK: witnesses three kills rss 1.82/1.71/1.56 GB + the r782 gate-stall at ~1.92 GB + the regrowth curve ~1.69 GB at ~+130m / ~1.88 GB at ~+375m / ~2.05 GB at ~+423m / ~2.02 GB at ~+448m after the 21:40 restart (next-server 2,015,168 KB at the r790 witness, 21:08 UTC) - the curve crossed the old kill marks and now hovers near 2.0; a kill-and-regrow cycle is the EXPECTED outcome - if the server is found down, the ONE dev-restart.sh allowance stands, record the kill in the OOM curve; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); AIHubMix relay arc: r774 recovering -> r775 adrift -> r776 flat-adrift -> r777 amber lull -> wave-16 q -> wave-17 q-lean-x2 -> wave-18 q-lean-x3 -> wave-19 q-lean-x5 at gapVal 122 -> wave-20 letterless break at 78 -> wave-21 lettered q return at 61 (the lean tag x4) -> the r790 record-tying quiet stretch (+122m, amber). (9) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.")',
    'L.append("Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the quiet-watch tie witness at four sites is a named mechanism per the r775 convention; the legend-toggle hover polish; full golden QA anchored in scripts/qa_r790.txt).")',
    "with open('worklog.md','a') as f:",
    "    f.write('\\n\\n---\\n\\n' + '\\n'.join(L) + '\\n')",
    "print('worklog appended')",
]

lines[start : end + 1] = new_block
src = "\n".join(lines)

cm_lines = [l for l in src.split("\n") if l.startswith("git commit -m 'r790:")]
assert len(cm_lines) == 1, "commit line count %d" % len(cm_lines)
COMMIT = (
    "r790: the band docs carry the r790 quiet-watch witness at all four on-page sites (no new cadence"
    " point - the census held flat at 53 runs / 186 ev / 141nj, chips 54, and the zero-growth stretch"
    " TIES the 122 band max: the quiet readout rendered +122m at the 21:08 UTC witness, the amber"
    " past-ceiling regime held across the r788/r789/r790 witnesses at +67/+99/+122m; the band stays 20"
    " points ending 61) + the lanes-tried legend toggle gains the hover underline solidify (dotted to"
    " solid on hover). QA green first-try; snapshot discipline forty-fifth close."
)
src = src.replace(cm_lines[0], "git commit -m '" + COMMIT + "'")

open(PATH, "w").write(src)
print("patched ok: narrative span %d lines -> %d lines; commit message swapped" % (len(old_span), len(new_block)))
