#!/usr/bin/env python3
"""r789: rewrite the sed-inherited r788 narrative inside scripts/r789_close.sh
into the true r789 narrative (the band-docs wave-21 lettered-q point with dual
provenance + the lane-filter violet hover) before the close runs. Aborts on
mismatch - the r785 pattern."""

PATH = "scripts/r789_close.sh"
src = open(PATH).read()
lines = src.split("\n")

ti = next((i for i, l in enumerate(lines) if "Task ID: r789" in l), -1)
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
    'L.append("Task ID: r789")',
    'L.append("Agent: NEXUS patrol (main agent - job 473388, 04:37 slot; opened on the r788 handoff; HEAD aef9fd311 = the r788 sweep artifact atop 0cae30ab4; tree CLEAN at open - no parallel-session WIP; server 200 first-try; opening witness: the wave-21 bucket already in the strip - the r788 close probes recorded gapVal 61 while the shipped band-docs still ended at 78, the puntd quote duty)")',
    'L.append("Task: Patrol round 789 - THE BAND DOCS CARRY THE WAVE-21 LETTERED-Q POINT at all four on-page sites (20 points, 61 quoted RENDERED per the r775 record-forward convention, DUAL provenance: witnessed at the r788 close probes + re-witnessed at the r789 close). (a) BAND DOCS: the cadence band reads 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62/57/58/122/78/61 with the wave-21 clause at the Route-state title interval + quiet halves, the interval-readout title and the quiet-readout title - the 61 is the newest chip bucket 10-30 19:00 UTC (rows 19:06:22 UTC maxes): the slot is LETTERED q again (mid-qwen route ACTIVE 1/2 via AIHubMix qwen3.8-max-free, mid-glm silent 0/2), the q-lean tag renders x4 in the shown window, quiet +99m at the r789 witness - the amber past-ceiling regime holds (the r788 close witnessed +67m, already amber). (b) STYLING POLISH: the corpus lane-filter chips (the legend distress chips) gain the violet hover (hover:border-violet-500/50 + hover:bg-violet-500/5 on the unfiltered state) - the r783 violet-hover convention extended to the lane-filter affordance.")',
    'L.append("Work Log:")',
    'L.append("- R1 open: tree CLEAN at aef9fd311; worklog tail = the r788 handoff; server 200 first-try; the queue read: the wave-21 quote duty (conditional in the r788 handoff - the witness settled it: a new point HAD landed, chips 53 to 54 in the QA board) + a polish increment.")',
    'L.append("- R2 scripts + QA FIRST (the r786 order lesson held): r789_qa.sh + r789_close.sh via the DUAL sed (s/r=788/r=789/g + bare-label s/r788/r789/g) from the in-tree r788 scripts, the close tsc line moved to node tsc per the standing hygiene; the r789 golden QA ran GREEN FIRST-TRY (marker in scripts/qa_r789.txt; board 53 runs / 186 ev / 30 verdicts / 15u / 141nj with chips 54 - census +1 run / +4 ev / +4 verdicts since the r788 close; the ld witness held the TEN-lane baseline, no eleventh).")',
    'L.append("- R3 witness + increment: the strip probe read the newest chip rendered gapVal 61 (letterless FALSE, lanes named five x4) and the tier-state line (after the legend click) rendered bucket q + q-lean x4 + +99m quiet amber + mid-qwen ACTIVE 1/2 / mid-glm silent 0/2; scripts/qa_r788_close.txt confirmed the r788 close had recorded the same gapVal 61 (+67m quiet amber) - the four band-doc sites got the 20th point with the dual provenance; the lane-filter chips got the violet hover - the on-page wave-21 witness is the round user-facing improvement (the letterless break is over, read without the worklog).")',
    'L.append("- R4 gates: pre-close gates ran file-redirected with stdin devnull (node tsc, never bunx on the pipe); the close re-ran both gates on the final tree - see the GATES line.")',
    'L.append("- R5 close: close probes: chip presence GATED / tone recorded; tier-state RECORDED; wave-strip presence GATED / text RECORDED; the bucket-title probes GATED (counts + hasGap on the newest chip - wave-agnostic); the letterless-chip probe RECORDED-only; the keyboard-bridge probe GATED; divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (forty-fourth) + worklog + commit + dual push.")',
    'L.append("- GATES: tsc_exit=" + os.environ.get(\'R754_TSC\',\'?\') + " - lint " + os.environ.get(\'R754_LINT\',\'?\') + " - qa-gate-census " + os.environ.get(\'R754_GC\',\'?\') + " - qa-cortex-census " + os.environ.get(\'R754_CC\',\'?\') + " - close census " + os.environ.get(\'R754_CEN\',\'?\') + " - snapshot: " + os.environ.get(\'R754_SNAP\',\'?\'))',
    'L.append("Stage Summary: the wave-21 lettered-q point is witnessed on-page at four sites with dual provenance (the r788 close record + the r789 re-witness) - the letterless break is over and the q-lean tag renders again at x4; the lane-filter chips carry the violet hover; QA green first-try; committed and pushed to origin + fork.")',
    'L.append("")',
    'L.append("Round Handoff:")',
    'L.append("Round ID: r790 -> next patrol (job 473388)")',
    'L.append("Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r789_qa.sh sed-adapted (DUAL pattern s/r=789/r=790/g + bare-label s/r789/r790/g; the r769-r789 scripts are committed in-tree; if swept, recover from git history). ORDER: QA FIRST (the marker gates the close snapshot; the r786 slip is the standing lesson). (2) SNAPSHOT DISCIPLINE: forty-fifth. (3) TIMEOUT HYGIENE: node tsc (never bunx on the pipe), long children file-redirected with stdin devnull. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; TEN lane labels; an ELEVENTH = unrouted on sight. ROUTE WATCH: wave 21 = the LETTERED q return at 61 (mid-qwen ACTIVE 1/2, mid-glm silent 0/2; the q-lean tag x4 in the shown window; quiet +99m amber at the r789 close) - the NEXT cadence point is r790 quote duty IF a new bucket landed (QUOTE THE RENDERED VALUE, update the four band-doc sites: band append + long/short provenance inserts - now routine per-witness duty; provenance convention: check the close record of the PRIOR round - if it already recorded the gapVal, carry the dual-provenance wording r789 used); WATCH THE QUIET: +99m was deep past the 62m ceiling - if the next bucket does not land soon the stretch is a genuine cadence break, record it at all four sites too; GLM-SILENT watch stands (mid-glm silent 0/2 across the wave-20 AND wave-21 witnesses). (5) CADENCE: band 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62/57/58/122/78/61 (20 points as of r789) - the 61 sits inside the old regime; watch whether the next intervals hold the 60s band or stretch again. (6) Increment queue, IN ORDER: (a) QA-found bugs first, always; (b) the fetch sweep is CLOSED and the band-docs witness is routine - else small verifiable polish/honesty increments; the P1 backlog rows stay Owner-blocked; (c) the builtin box extraction stays parked for an Owner-asked round; (d) TASKS.md re-triage if the Owner unblocks rows. (7) CORTEX P1: the app-side two-paste carrier shipped r787 - the deploy now waits on the Owner source paste; if the Owner reports the probe state, record the edge version + lane matrix in the worklog. (8) Owner queue (carried): PLATFORM REPORT URGENT - three wipes + .archive-snapshot-1028 disposition; THE OOM CEILING - ESCALATING: witnesses three kills rss 1.82/1.71/1.56 GB + the r782 gate-stall at ~1.92 GB + the regrowth curve 1.63 at +34m / 1.53 at +58m / ~1.63 at ~+95m / ~1.69 at ~+130m / ~1.88 GB at ~+375m / ~2.05 GB at ~+423m after the 21:40 restart (next-server rss 2,046,372 KB at the r789 witness, 20:43 UTC) - the curve has crossed the old kill mark (1.82) and the r782 stall mark (~1.92); a kill-and-regrow cycle is the EXPECTED outcome - if the server is found down, the ONE dev-restart.sh allowance stands, record the kill in the OOM curve; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); AIHubMix relay arc: r774 recovering -> r775 adrift -> r776 flat-adrift -> r777 amber lull -> wave-16 q -> wave-17 q-lean-x2 -> wave-18 q-lean-x3 -> wave-19 q-lean-x5 at gapVal 122 -> wave-20 letterless break at 78 -> wave-21 lettered q return at 61 (the lean tag x4). (9) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.")',
    'L.append("Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the band-docs wave-21 witness at four sites with dual provenance is a named mechanism per the r775 convention; the violet-hover extension is the polish; full golden QA anchored in scripts/qa_r789.txt).")',
    "with open('worklog.md','a') as f:",
    "    f.write('\\n\\n---\\n\\n' + '\\n'.join(L) + '\\n')",
    "print('worklog appended')",
]

lines[start : end + 1] = new_block
src = "\n".join(lines)

cm_lines = [l for l in src.split("\n") if l.startswith("git commit -m 'r789:")]
assert len(cm_lines) == 1, "commit line count %d" % len(cm_lines)
COMMIT = (
    "r789: the band docs carry the wave-21 lettered-q point at all four on-page sites (20 points, 61"
    " quoted rendered with dual provenance - the r788 close probes recorded gapVal 61 and the r789"
    " witness re-witnessed it: bucket 10-30 19:00 UTC rows 19:06:22 UTC maxes, the slot LETTERED q"
    " again via mid-qwen ACTIVE 1/2 (AIHubMix qwen3.8-max-free) vs mid-glm silent 0/2, the q-lean tag"
    " renders x4 in the shown window, quiet +99m amber past the 62m ceiling) + the corpus lane-filter"
    " chips gain the violet hover (the r783 convention). Census 52 to 53 runs / 186 ev / 141nj; QA"
    " green first-try; snapshot discipline forty-fourth close."
)
src = src.replace(cm_lines[0], "git commit -m '" + COMMIT + "'")

open(PATH, "w").write(src)
print("patched ok: narrative span %d lines -> %d lines; commit message swapped" % (len(old_span), len(new_block)))
