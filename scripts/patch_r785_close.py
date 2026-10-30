#!/usr/bin/env python3
"""r785: rewrite the sed-inherited r784 narrative inside scripts/r785_close.sh
into the true r785 narrative (the settings fetch watch) before the close runs.
Asserts markers and aborts on mismatch - the patch_r784_close.py pattern."""

PATH = "scripts/r785_close.sh"
src = open(PATH).read()
lines = src.split("\n")

ti = next((i for i, l in enumerate(lines) if "Task ID: r785" in l), -1)
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
    'L.append("Task ID: r785")',
    'L.append("Agent: NEXUS patrol (main agent - job 473388, 23:07 slot; opened on the r784 handoff; HEAD 0bd1a6357 = the r784 wave-19 band-docs + two-conversion + stale-pill-ring increment; tree CLEAN at open - no parallel-session WIP; server 200 first-try)")',
    'L.append("Task: Patrol round 785 - THE SETTINGS FETCH WATCH: five apiJson death-window conversions across two files with per-site judgments, closing the named ~236/~274/~1448 + provider-gallery trio queue items from the r784 handoff. (a) model-relay.tsx: the benchmark-intel GET and the free-reach census GET are idempotent reads - converted with the existing semantics kept (stale-mount auto-refresh silent, forced refresh toasts the honest ApiError; the !ok HTTP throw kept alongside the guard); the restore pre-check GET (/api/tracker, cache no-store) FIXES AN HONESTY BUG - the old !ok-to-null path conflated a dead server with absent-from-catalog (a 502 window read as the false nothing-to-restore-yet verdict and even dimmed the affordance), while !ok and the death-window HTML page now throw into the honest Catalog-check-failed catch. (b) provider-gallery.tsx: the account probe POST is a read-style dial of the provider /v1/me (nothing inserts, nothing bills) - judged repeat-safe, default single retry kept, death-window HTML now raises the honest ApiError into the failure toast; the quarantine-pardon recheck POST clears an already-clear map on repeat (a no-op, idempotent) - converted under the same judgment, the cosmetic swallow-catch kept; the free-models roster refresh is a FORCE action against the provider live /models - converted at retries 0 per the action-route doctrine (the user Refresh button keeps the retry decision), and the r23 browser-direct fallback now serves EVERY failure class: region-block answer, HTTP error body, or death-window HTML page (the guard ApiError) - parse noise can no longer leak. (c) STYLING POLISH: the relay lane row dim gains transition-opacity (the enabled/retired 70 percent fade animates instead of snapping).")',
    'L.append("Work Log:")',
    'L.append("- R1 open: tree CLEAN at 0bd1a6357; worklog tail = the r784 handoff; server 200 first-try; the queue read: settings model-relay intel/freellm + tracker poll + the provider-gallery trio with idempotence judgments before converting.")',
    'L.append("- R2 scripts: r785_qa.sh + r785_close.sh via the DUAL sed (s/r=784/r=785/g + bare-label s/r784/r785/g) from the in-tree r784 scripts; the sed-inherited r784 narrative inside the close script rewritten to the r785 narrative via scripts/patch_r785_close.py before the run.")',
    'L.append("- R3 QA: the r785 golden QA ran GREEN FIRST-TRY (marker in scripts/qa_r785.txt; board 46 runs / 168 ev / 23 verdicts / 15u / 130nj with chips 47 - the census held flat vs the r784 close; ld TEN lane labels, no eleventh; settings census+relay true; radar frontier aria-clicked; 799-char long-paste witnessed; cron chip 1/1; console 0 errors - HMR-connect logs only, page errors empty).")',
    'L.append("- R4 increment: the five apiJson conversions with per-site judgments (detailed in the Task line) + the lane-row transition-opacity polish + the restore honesty fix as the round user-facing improvement.")',
    'L.append("- R5 gates: pre-close tsc 0 errors / lint 0 errors, 33 warnings (the baseline held - the conversions added no new warnings); the close re-ran both gates GREEN on the final tree.")',
    'L.append("- R6 close: close probes: chip presence GATED / tone recorded; legend GATED (the strip/legend view untouched this round); tier-state RECORDED; wave-strip presence GATED / text RECORDED; the bucket-title probes GATED (counts + hasGap on the newest chip - wave-agnostic); the letterless-chip probe RECORDED-only; the keyboard-bridge probe GATED; divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (forty-first) + worklog + commit + dual push.")',
    'L.append("- GATES: tsc_exit=" + os.environ.get(\'R754_TSC\',\'?\') + " - lint " + os.environ.get(\'R754_LINT\',\'?\') + " - qa-gate-census " + os.environ.get(\'R754_GC\',\'?\') + " - qa-cortex-census " + os.environ.get(\'R754_CC\',\'?\') + " - close census " + os.environ.get(\'R754_CEN\',\'?\') + " - snapshot: " + os.environ.get(\'R754_SNAP\',\'?\'))',
    'L.append("Stage Summary: the settings fetch watch landed - five guard conversions with judgments (two plain reads, one honesty-bug fix, two judged POSTs, one force action at retries 0 with the browser fallback widened to every failure class); polish shipped; QA green first-try; tsc 0 errors / lint 0 errors 33 warnings baseline; committed and pushed to origin + fork.")',
    'L.append("")',
    'L.append("Round Handoff:")',
    'L.append("Round ID: r786 -> next patrol (job 473388)")',
    'L.append("Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r785_qa.sh sed-adapted (DUAL pattern s/r=785/r=786/g + bare-label s/r785/r786/g; the r769-r785 scripts are committed in-tree; if swept, recover from git history). ORDER: QA FIRST (the marker gates the close snapshot). Probes unchanged (chip presence gated / tone recorded; legend RECORDED unless the round touches the strip/legend/tier-state view; tier-state RECORDED ONLY; wave-strip presence GATED / text RECORDED; bucket-title probes GATED wave-agnostic; letterless-chip probe RECORDED-only; keyboard-bridge probe GATED; divergence RECORDED ONLY; tally gated). (2) SNAPSHOT DISCIPLINE: forty-second. (3) TIMEOUT HYGIENE: node tsc (never bunx on the pipe), long children file-redirected with stdin devnull. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; TEN lane labels; an ELEVENTH = unrouted on sight. ROUTE WATCH: wave 19 = q at lean x5 (gapVal 122, the banddocs 18th point) - the NEXT lettered bucket decides (q x6 keeps the lean tag counting; a g return resumes the wave-by-wave alternation and breaks the five-long lean run; an m bucket = the first both-routes witness); wave 20 = the next cadence point - QUOTE THE RENDERED VALUE and update the four band-doc sites (routine per-witness duty: band append + long/short provenance inserts); GLM-SILENT watch stands. (5) CADENCE: band 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62/57/58/122 (18 points as of r784) - the 122 stretches the band far past the old 70 max: watch whether the next intervals return toward the 60s or hold in the 100s. (6) Increment queue, IN ORDER: (a) QA-found bugs first, always; (b) the fetch watch continues: radar paper/github-stars/hf-trending/frontier-scout tab reads (each judged: idempotent + death-window-visible -> apiJson; cosmetic-only or non-JSON contract -> leave with the judgment annotated); chat transcribe/tts/image-generate POSTs are action routes - retries 0 if converted, else leave with the judgment annotated; (c) the builtin box extraction stays parked for an Owner-asked round; (d) TASKS.md re-triage if the Owner unblocks rows. (7) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (8) Owner queue (carried): PLATFORM REPORT URGENT - three wipes + .archive-snapshot-1028 disposition; THE OOM CEILING (witnesses: three kills rss 1.82/1.71/1.56 GB + the r782 gate-stall at ~1.92 GB + the regrowth curve 1.63 GB at +34m / 1.53 GB at +58m after the 21:40 restart + the r785 reading at ~+95m); vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); AIHubMix relay arc: r774 recovering -> r775 adrift -> r776 flat-adrift -> r777 amber lull -> wave-16 q -> wave-17 q-lean-x2 -> wave-18 q-lean-x3 -> wave-19 q-lean-x5 at gapVal 122. (9) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.")',
    'L.append("Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the death-window guard joined on five named settings sites with per-site idempotence judgments + one honesty-bug fix is a named mechanism; the lane-row transition polish; full golden QA anchored in scripts/qa_r785.txt).")',
    "with open('worklog.md','a') as f:",
    "    f.write('\\n\\n---\\n\\n' + '\\n'.join(L) + '\\n')",
    "print('worklog appended')",
]

lines[start : end + 1] = new_block
src = "\n".join(lines)

cm_lines = [l for l in src.split("\n") if l.startswith("git commit -m 'r785: the fetch long tail")]
assert len(cm_lines) == 1, "commit line count %d" % len(cm_lines)
COMMIT = (
    "r785: the settings fetch watch - five apiJson death-window conversions across two files with per-site"
    " judgments (model-relay benchmark-intel GET + free-reach census GET, idempotent reads with the silent-auto"
    " and toast-on-fresh catches kept; the restore pre-check tracker read FIXING an honesty bug - the old"
    " !ok-to-null path conflated a dead server with absent-from-catalog and now lands the honest"
    " Catalog-check-failed catch; provider-gallery account probe, a read-style POST against the provider /v1/me"
    " judged repeat-safe so the default retry stays; the quarantine-pardon recheck heal, a no-op-on-repeat"
    " idempotent clear; free-models roster refresh at retries 0 per the action-route doctrine with the r23"
    " browser-direct fallback now serving every failure class - region-block, HTTP error body, death-window"
    " HTML) + the relay lane-row dim gains transition-opacity. Census held flat 46/168/130nj; QA green"
    " first-try; snapshot discipline forty-first close."
)
src = src.replace(cm_lines[0], "git commit -m '" + COMMIT + "'")

open(PATH, "w").write(src)
print("patched ok: narrative span %d lines -> %d lines; commit message swapped" % (len(old_span), len(new_block)))
