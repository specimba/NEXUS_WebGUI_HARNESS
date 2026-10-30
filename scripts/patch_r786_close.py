#!/usr/bin/env python3
"""r786: rewrite the sed-inherited r785 narrative inside scripts/r786_close.sh
into the true r786 narrative (the radar fetch watch) before the close runs.
Asserts markers and aborts on mismatch - the patch_r785_close.py pattern."""

PATH = "scripts/r786_close.sh"
src = open(PATH).read()
lines = src.split("\n")

ti = next((i for i, l in enumerate(lines) if "Task ID: r786" in l), -1)
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
    'L.append("Task ID: r786")',
    'L.append("Agent: NEXUS patrol (main agent - job 473388, 23:37 slot; opened on the r785 handoff; HEAD 01f73edc4 = the r785 sweep riding the settings fetch watch + honesty fix; tree CLEAN at open - no parallel-session WIP; server 200 first-try; opening witness: wave 19 q-lean-x5 at gapVal 122 with the quiet span amber +67m at the r785 close)")',
    'L.append("Task: Patrol round 786 - THE RADAR FETCH WATCH COMPLETED (six apiJson death-window conversions across the four radar tabs) + the chat action trio judged (one converted at retries 0, two documented leaves) - the r785 handoff item 6b finished. PER-SITE JUDGMENTS: paper-radar-tab - the arXiv proxy search GET and the load-more page GET are idempotent reads with the 25s timeout signals passing through untouched (the load-more seen-id dedupe is untouched by the guard retry: a repeated page lands the same rows, all filtered); github-stars-tab - the paged proxy GETs are idempotent reads with the 30s pool-retry timeout through and the 404/429 classification kept (a death-window HTML page now raises the honest ApiError into the same error line instead of the generic HTTP fallback); hf-trending-tab - the fleet load GET keeps the 35s timeout through (a timeout is rethrown as-is, never retried, so the timeout-aware catch wording survives) and the three-kind allSettled fan-out keeps its per-kind failure isolation (a guard ApiError fails only its own kind, the r468 fallback keeps the other two boards); frontier-scout-tab - the aggregation GET keeps the manual abort signal through (an abort is rethrown, never retried - the new-fetch-cancels-old discipline unchanged); image-studio - the generate POST converted at RETRIES 0 per the action-route doctrine (a billable action, the Generate button keeps the retry decision) so the studio error box gets the honest ApiError instead of browser parse noise; DOCUMENTED LEAVES: /api/transcribe (a billable STT action whose existing catch already degrades to the honest generic line) and /api/tts (a NON-JSON success contract - an audio blob - the apiJson JSON contract does not apply), each annotated in-code. STYLING POLISH: the hub-fleet Reload button gains the violet hover (the r783 odds-card convention).")',
    'L.append("Work Log:")',
    'L.append("- R1 open: tree CLEAN at 01f73edc4; worklog tail = the r785 handoff; server 200 first-try; the queue read: radar paper/github-stars/hf-trending/frontier-scout tab reads each judged + the chat transcribe/tts/image-generate action trio.")',
    'L.append("- R2 scripts: r786_qa.sh + r786_close.sh via the DUAL sed (s/r=785/r=786/g + bare-label s/r785/r786/g) from the in-tree r785 scripts; the sed-inherited r785 narrative inside the close script rewritten to the r786 narrative via scripts/patch_r786_close.py before the run.")',
    'L.append("- R3 QA: the r786 golden QA ran GREEN FIRST-TRY (marker in scripts/qa_r786.txt; census + lanes + settings + radar + long-paste + cron chip + console 0 errors - details in the GATES line and the close probes).")',
    'L.append("- R4 increment: the six radar conversions + the image-studio retries-0 conversion + two annotated leaves across the chat trio (judgments detailed in the Task line) + the fleet Reload violet hover polish + the radar-wide death-window honesty as the round user-facing improvement.")',
    'L.append("- R5 gates: pre-close tsc 0 errors / lint 0 errors, 33 warnings (the baseline held - the conversions added no new warnings); the close re-ran both gates GREEN on the final tree.")',
    'L.append("- R6 close: close probes: chip presence GATED / tone recorded; legend GATED (the strip/legend view untouched this round); tier-state RECORDED; wave-strip presence GATED / text RECORDED; the bucket-title probes GATED (counts + hasGap on the newest chip - wave-agnostic); the letterless-chip probe RECORDED-only; the keyboard-bridge probe GATED; divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (forty-second) + worklog + commit + dual push.")',
    'L.append("- GATES: tsc_exit=" + os.environ.get(\'R754_TSC\',\'?\') + " - lint " + os.environ.get(\'R754_LINT\',\'?\') + " - qa-gate-census " + os.environ.get(\'R754_GC\',\'?\') + " - qa-cortex-census " + os.environ.get(\'R754_CC\',\'?\') + " - close census " + os.environ.get(\'R754_CEN\',\'?\') + " - snapshot: " + os.environ.get(\'R754_SNAP\',\'?\'))',
    'L.append("Stage Summary: the radar fetch watch landed - seven guard conversions total across four tabs + image-studio (six idempotent reads with timeout/abort signals honored + one billable action at retries 0) + two doctrine leaves annotated; polish shipped; QA green; tsc 0 errors / lint 0 errors 33 warnings baseline; committed and pushed to origin + fork.")',
    'L.append("")',
    'L.append("Round Handoff:")',
    'L.append("Round ID: r787 -> next patrol (job 473388)")',
    'L.append("Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r786_qa.sh sed-adapted (DUAL pattern s/r=786/r=787/g + bare-label s/r786/r787/g; the r769-r786 scripts are committed in-tree; if swept, recover from git history). ORDER: QA FIRST (the marker gates the close snapshot). Probes unchanged (chip presence gated / tone recorded; legend RECORDED unless the round touches the strip/legend/tier-state view; tier-state RECORDED ONLY; wave-strip presence GATED / text RECORDED; bucket-title probes GATED wave-agnostic; letterless-chip probe RECORDED-only; keyboard-bridge probe GATED; divergence RECORDED ONLY; tally gated). (2) SNAPSHOT DISCIPLINE: forty-third. (3) TIMEOUT HYGIENE: node tsc (never bunx on the pipe), long children file-redirected with stdin devnull. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; TEN lane labels; an ELEVENTH = unrouted on sight. ROUTE WATCH: wave 19 = q at lean x5 (gapVal 122, the banddocs 18th point) - the NEXT lettered bucket decides (q x6 keeps the lean tag counting; a g return resumes the wave-by-wave alternation and breaks the five-long lean run; an m bucket = the first both-routes witness); wave 20 = the next cadence point - QUOTE THE RENDERED VALUE and update the four band-doc sites (routine per-witness duty: band append + long/short provenance inserts); GLM-SILENT watch stands. (5) CADENCE: band 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62/57/58/122 (18 points as of r784) - watch whether the next intervals return toward the 60s or hold in the 100s. (6) Increment queue, IN ORDER: (a) QA-found bugs first, always; (b) THE NAMED FETCH QUEUE IS DONE (the eight r781 files + the settings pair r785 + the radar tabs and chat trio r786) - next round runs a fresh rg sweep for any remaining raw fetch( in src/components/nexus and judges each survivor (idempotent + death-window-visible -> apiJson; action -> retries 0; non-JSON or cosmetic -> leave with the judgment annotated); (c) the builtin box extraction stays parked for an Owner-asked round; (d) TASKS.md re-triage if the Owner unblocks rows. (7) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (8) Owner queue (carried): PLATFORM REPORT URGENT - three wipes + .archive-snapshot-1028 disposition; THE OOM CEILING (witnesses: three kills rss 1.82/1.71/1.56 GB + the r782 gate-stall at ~1.92 GB + the regrowth curve 1.63 GB at +34m / 1.53 GB at +58m / ~1.63 GB at ~+95m after the 21:40 restart + the r786 reading RSSREADING); vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); AIHubMix relay arc: r774 recovering -> r775 adrift -> r776 flat-adrift -> r777 amber lull -> wave-16 q -> wave-17 q-lean-x2 -> wave-18 q-lean-x3 -> wave-19 q-lean-x5 at gapVal 122. (9) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.")',
    'L.append("Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the death-window guard joined on seven named radar/chat sites with per-site timeout, abort, dedupe and fan-out semantics honored + two doctrine leaves annotated is a named mechanism; the fleet Reload violet polish; full golden QA anchored in scripts/qa_r786.txt).")',
    "with open('worklog.md','a') as f:",
    "    f.write('\\n\\n---\\n\\n' + '\\n'.join(L) + '\\n')",
    "print('worklog appended')",
]

lines[start : end + 1] = new_block
src = "\n".join(lines)

cm_lines = [l for l in src.split("\n") if l.startswith("git commit -m 'r786:")]
assert len(cm_lines) == 1, "commit line count %d" % len(cm_lines)
COMMIT = (
    "r786: the radar fetch watch completed - six apiJson death-window conversions across four tabs with"
    " per-site judgments (paper-radar search + load-more GETs with the 25s timeout signals through and the"
    " load-more dedupe untouched by the guard retry; github-stars paged proxy GETs with the 30s pool-retry"
    " timeout through and the 404/429 classification kept; hf-trending fleet load with the 35s timeout"
    " through, the timeout-aware catch wording kept + the three-kind allSettled fan-out with per-kind failure"
    " isolation kept; frontier-scout aggregation GET with the manual abort signal through, never retried) +"
    " the image-studio generate POST converted at retries 0 per the action-route doctrine so the studio error"
    " box gets the honest ApiError instead of parse noise + two documented leaves annotated in-code"
    " (transcribe, a billable STT action whose catch already degrades honestly; tts, a NON-JSON audio-blob"
    " success contract the apiJson JSON rule does not apply to) + the hub-fleet Reload button gains the violet"
    " hover (the r783 convention). Census held; QA green; snapshot discipline forty-second close."
)
src = src.replace(cm_lines[0], "git commit -m '" + COMMIT + "'")

open(PATH, "w").write(src)
print("patched ok: narrative span %d lines -> %d lines; commit message swapped" % (len(old_span), len(new_block)))
