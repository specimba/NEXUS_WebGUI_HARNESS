#!/usr/bin/env python3
"""r788: rewrite the sed-inherited r786 narrative inside scripts/r788_close.sh
into the true r788 narrative (the band-docs wave-20 break point + the fetch
sweep closure) before the close runs. Aborts on mismatch - the r785 pattern."""

PATH = "scripts/r788_close.sh"
src = open(PATH).read()
lines = src.split("\n")

ti = next((i for i, l in enumerate(lines) if "Task ID: r788" in l), -1)
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
    'L.append("Task ID: r788")',
    'L.append("Agent: NEXUS patrol (main agent - job 473388, 04:07 slot; opened on the r787 handoff; HEAD 1ffb9ae31 = the Owner-directed cortex two-paste carrier round; tree CLEAN at open - no parallel-session WIP; server 200 first-try; opening witness: the r786 close letterless break - newest chip without a letter at gapVal 78, the q-lean x5 run ended, mid-qwen route silent 0/2, quiet +16m)")',
    'L.append("Task: Patrol round 788 - THE BAND DOCS CARRY THE WAVE-20 LETTERLESS-BREAK POINT at all four on-page sites (19 points, 78 quoted RENDERED from the r786 close per the r775 record-forward convention) AND THE FETCH SWEEP IS CLOSED. (a) BAND DOCS: the cadence band reads 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62/57/58/122/78 with the wave-20 clause at the Route-state title interval + quiet halves, the interval-readout title and the quiet-readout title - the 78 is the wave-20 readout witnessed at the r786 close: the wave-20 slot is LETTERLESS (no middle-tier lane dialed), the five-long q-lean run ended per the r767 break semantics, mid-qwen route silent 0/2 there - the wave-15 precedent held (a letterless bucket still counts in the cadence). (b) THE FETCH SWEEP (the r787 handoff item 6b): a fresh rg sweep found six raw fetch sites in src/components/nexus - EVERY survivor now carries its judgment in-code: run-kanban EventEmitBar (an event-INSERT action POST the body of which is never parsed - res.ok alone drives the ok/err state, so a death-window HTML page already lands the honest failed state with zero parse noise; the guard adds nothing this UI needs - LEFT RAW with the annotation); the r787 cortex source route (answers text/plain - the source IS text - so the apiJson JSON contract does not apply; the harness-name sniff is the honest guard - LEFT RAW with the annotation); strategy-card briefing + the chat transcribe/tts leaves stand as the prior annotated judgments. (c) STYLING POLISH: the Emit button failure state gains a distinct red tone (border-red-500/50 + red text) instead of blending into the amber button.")',
    'L.append("Work Log:")',
    'L.append("- R1 open: tree CLEAN at 1ffb9ae31; worklog tail = the r787 handoff; server 200 first-try; the queue read: the band-docs 78 quote duty + the fresh fetch sweep.")',
    'L.append("- R2 scripts + QA FIRST (the r786 order lesson held): r788_qa.sh + r788_close.sh via the DUAL sed (s/r=786/r=788/g + bare-label s/r786/r788/g) from the in-tree r786 scripts; the r788 golden QA ran GREEN FIRST-TRY (marker in scripts/qa_r788.txt; board 52 runs / 182 ev / 26 verdicts / 15u / 141nj with chips 53 - the census moved +4 runs and +10nj rows since the r786 close, new buckets landed).")',
    'L.append("- R3 increment: the four band-doc sites carry the 19th point (the wave-20 letterless-break clause, provenance included) + the sweep closure annotations at the two un-annotated leaves + the Emit err-tone polish - the on-page break witness is the round user-facing improvement (the cadence break and its meaning read without the worklog).")',
    'L.append("- R4 gates: pre-close tsc 0 errors / lint 0 errors, 33 warnings (the baseline held - no new warnings); the close re-ran both gates GREEN on the final tree.")',
    'L.append("- R5 close: close probes: chip presence GATED / tone recorded; tier-state RECORDED; wave-strip presence GATED / text RECORDED; the bucket-title probes GATED (counts + hasGap on the newest chip - wave-agnostic); the letterless-chip probe RECORDED-only; the keyboard-bridge probe GATED; divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (forty-third) + worklog + commit + dual push.")',
    'L.append("- GATES: tsc_exit=" + os.environ.get(\'R754_TSC\',\'?\') + " - lint " + os.environ.get(\'R754_LINT\',\'?\') + " - qa-gate-census " + os.environ.get(\'R754_GC\',\'?\') + " - qa-cortex-census " + os.environ.get(\'R754_CC\',\'?\') + " - close census " + os.environ.get(\'R754_CEN\',\'?\') + " - snapshot: " + os.environ.get(\'R754_SNAP\',\'?\'))',
    'L.append("Stage Summary: the wave-20 letterless break is now witnessed on-page at four sites with full provenance; the fetch sweep is CLOSED (every raw fetch in the nexus components judged in-code); the Emit failure tone shipped; QA green first-try; tsc 0 errors / lint 0 errors 33 warnings baseline; committed and pushed to origin + fork.")',
    'L.append("")',
    'L.append("Round Handoff:")',
    'L.append("Round ID: r789 -> next patrol (job 473388)")',
    'L.append("Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r788_qa.sh sed-adapted (DUAL pattern s/r=788/r=789/g + bare-label s/r788/r789/g; the r769-r788 scripts are committed in-tree; if swept, recover from git history). ORDER: QA FIRST (the marker gates the close snapshot; the r786 slip is the standing lesson). (2) SNAPSHOT DISCIPLINE: forty-fourth. (3) TIMEOUT HYGIENE: node tsc (never bunx on the pipe), long children file-redirected with stdin devnull. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; TEN lane labels; an ELEVENTH = unrouted on sight. ROUTE WATCH: wave 20 = the LETTERLESS break at 78 (the q-lean x5 run ended; mid-qwen route was silent 0/2 at the r786 close) - the NEXT lettered bucket restarts the lean count (x1 renders no tag, x2 renders the lean tag again) or another letterless slot extends the break; the r788 close probes witnessed the CURRENT strip - the newest chip rendered gapVal is r789 quote duty IF a new cadence point landed (QUOTE THE RENDERED VALUE, update the four band-doc sites: band append + long/short provenance inserts - now routine per-witness duty); GLM-SILENT watch stands. (5) CADENCE: band 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62/57/58/122/78 (19 points as of r788) - the 78 sits back inside the old regime vs the 122 outlier: watch whether the next intervals hold the 60s band or stretch again. (6) Increment queue, IN ORDER: (a) QA-found bugs first, always; (b) THE FETCH SWEEP IS DONE - every raw fetch in src/components/nexus carries its judgment in-code; the queue moves to the P1 backlog rows if the Owner unblocks them, else small verifiable polish/honesty increments; (c) the builtin box extraction stays parked for an Owner-asked round; (d) TASKS.md re-triage if the Owner unblocks rows. (7) CORTEX P1: the app-side two-paste carrier shipped r787 - the deploy now waits on the Owner source paste; if the Owner reports the probe state, record the edge version + lane matrix in the worklog. (8) Owner queue (carried): PLATFORM REPORT URGENT - three wipes + .archive-snapshot-1028 disposition; THE OOM CEILING (witnesses: three kills rss 1.82/1.71/1.56 GB + the r782 gate-stall at ~1.92 GB + the regrowth curve 1.63 GB at +34m / 1.53 GB at +58m / ~1.63 GB at ~+95m / ~1.69 GB at ~+130m after the 21:40 restart + the r788 reading RSSREADING); vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); AIHubMix relay arc: r774 recovering -> r775 adrift -> r776 flat-adrift -> r777 amber lull -> wave-16 q -> wave-17 q-lean-x2 -> wave-18 q-lean-x3 -> wave-19 q-lean-x5 at gapVal 122 -> wave-20 letterless break at 78. (9) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.")',
    'L.append("Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the band-docs wave-20 break witness at four sites per the r775 convention is a named mechanism; the sweep closure puts every raw-fetch judgment in-code; the Emit err-tone polish; full golden QA anchored in scripts/qa_r788.txt).")',
    "with open('worklog.md','a') as f:",
    "    f.write('\\n\\n---\\n\\n' + '\\n'.join(L) + '\\n')",
    "print('worklog appended')",
]

lines[start : end + 1] = new_block
src = "\n".join(lines)

cm_lines = [l for l in src.split("\n") if l.startswith("git commit -m 'r788:")]
assert len(cm_lines) == 1, "commit line count %d" % len(cm_lines)
COMMIT = (
    "r788: the band docs carry the wave-20 letterless-break point at all four on-page sites (19 points, 78"
    " quoted rendered from the r786 close per the r775 convention - the wave-20 slot dialed no middle-tier"
    " lane, the five-long q-lean run ended per the r767 break semantics, mid-qwen route silent 0/2 there) +"
    " the fetch sweep CLOSED: every remaining raw fetch in src/components/nexus now carries its judgment"
    " in-code (run-kanban EventEmitBar event-INSERT POST left raw - the body is never parsed so the failed"
    " state is already parse-noise-free; the r787 cortex source route left raw - text/plain contract the"
    " apiJson JSON rule does not apply to; strategy-card briefing + the chat trio stand as the prior"
    " annotated leaves) + the Emit button failure state gains a distinct red tone. Census moved 48 to 52"
    " runs / 141nj; QA green first-try; snapshot discipline forty-third close."
)
src = src.replace(cm_lines[0], "git commit -m '" + COMMIT + "'")

open(PATH, "w").write(src)
print("patched ok: narrative span %d lines -> %d lines; commit message swapped" % (len(old_span), len(new_block)))
