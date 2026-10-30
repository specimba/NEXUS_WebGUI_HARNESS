#!/usr/bin/env python3
# r792: rewrite the sed-inherited r791 narrative in scripts/r792_close.sh with
# the TRUE r792 record (the freeze-watch follow-up round), per the
# patch_r789_close.py pattern: assert the heredoc structure first, then rewrite
# the L.append block and the git commit message. Abort on any mismatch - never half-patch.
import sys

P = "scripts/r792_close.sh"
src = open(P, encoding="utf-8").read()


def require(cond, msg):
    if not cond:
        print("PATCH ABORT: " + msg)
        sys.exit(1)


GATES_MARK = 'L.append("- GATES: tsc_exit='
require(src.count("L = []") == 1, "L = [] marker not unique")
require(src.count("with open('worklog.md','a')") == 1, "worklog open marker not unique")
require(src.count(GATES_MARK) == 1, "GATES append marker not unique")
require(src.count("Task ID: r792") == 1, "r792 task marker not unique")

# ---- narrative block 1: from "L = []" up to (not incl.) the GATES line ----
N1 = []
N1.append("Task ID: r792")
N1.append("Agent: NEXUS patrol (main agent - job 473388, 07:07 slot; opened on the r791 handoff; HEAD b6a6f9a66 = the r791 addendum-3 threshold doctrine atop 61589d755; tree CLEAN at open - no parallel-session WIP; server 200 first-try, no restart needed; opening witness: the mem-guard END-TO-END PROOF in scripts/mem-guard.log - the old-threshold in-process guard armed 22:56:36 (pid 17131) fired its ONE graceful restart at 22:58:36 (RSS 1,959,388 KB > the 1,740,000 KB threshold) and the fresh boot pid 17401 armed the TUNED guard (rss 2,150,000 KB secondary / MemAvailable 600,000 KB primary, 120s check, 300s cooldown) - exactly the addendum-3 prediction, the mechanism closed end-to-end; that restart spends the r792 dev-restart allowance per the handoff, no second restart)")
N1.append("Task: Patrol round 792 - THE FREEZE-WATCH FOLLOW-UP ROUND (the Owner directive: focus more on work efficiency, the page-freeze cycle costing ~20 minutes per occurrence): (a) THE CORPUS STRIP RENDER CAP (the r791 handoff candidate 7b) - the unfiltered corpus strip rendered EVERY pill (56 runs and climbing, +2-3 rows per patrol slot, unbounded DOM weight on the heaviest board surface); now capped at RENDER time (CORPUS_STRIP_CAP 24, the TAIL = the newest end, the same slice the r763 wave strip reads) per the r227 truth class: the tally and census keep describing the WHOLE corpus, the shown chip states the render truth (24 of 56 shown), an honest +32 older runs not shown footer with a violet-hover Show-all affordance sits where the cap bites, a filter (pill query or lane filter) always lifts the cap - a narrowed search must search the WHOLE filtered set - and the Show-all lift is session-local. (b) THE QUIET CONTINUATION WITNESS at the four on-page sites: still no new bucket by the 23:12 UTC witness, the quiet rendered +245m - the stretch deepens past its own +208m record (the amber regime five witnesses deep +67/+99/+122/+208/+245m). (c) THE MEM-GUARD MECHANISM PROOF witnessed at open (the graceful restart landed BEFORE the kernel killer - the addendum-3 doctrine validated on live data).")
N1.append("Work Log:")
N1.append("- R1 open + scripts + QA FIRST: tree CLEAN at b6a6f9a66; server 200 (pid 17401, rss ~1.79 GB at +9m after the guard-fired restart, MemAvailable 1.36 GB - healthy); r792_qa.sh + r792_close.sh via the DUAL sed (s/r=791/r=792/g + bare-label s/r791/r792/g) from the in-tree r791 scripts; the r792 golden QA ran GREEN FIRST-TRY (marker in scripts/qa_r792.txt: board 56 runs / 200 ev / 35 verdicts / 24u / 141nj, chips 57 - census FLAT vs the r791 close, no new bucket; the ld witness held the TEN-lane baseline, no eleventh; paste 799; cron 1/1; console 0 errors, page errors none) - the r791 exa fix held (zero same-key console entries).")
N1.append("- R2 increment: the corpus strip cap implemented in run-kanban.tsx (the CORPUS_STRIP_CAP constant + the showAllCorpus session state + the corpusCapped/renderedCorpus render-time slice + the shown chip reading the RENDERED count + the honest footer with the Show-all button carrying the r783 violet-hover convention) - the r227 board-column cap pattern applied to the corpus strip. Verified live: the cap footer + the 24 of 56 shown chip rendered, the Show-all click grew the pills 25 -> 57 (+32 = exactly the hidden tail) and the footer correctly unrendered on the lift.")
N1.append("- R3 witness: the legend-click tier-state probe read bucket 10-30 19:00 / q / q-lean x4 / +61m since prior / +245m quiet / mid-qwen ACTIVE 1/2 (AIHubMix qwen3.8-flash-free silent) / mid-glm silent 0/2 - no new bucket, the band-append duty and the quiet duty stay mutually exclusive, the QUIET CONTINUATION is the live one; the four on-page clauses (route-state title interval + quiet halves, interval-readout title, quiet-readout title) updated with the r792 continuation (+245m at the 23:12 UTC witness, the stretch deepens past its own +208m record, five witnesses deep).")
N1.append("- R3.5 disclosure: two mid-round slips caught by the live probe and fixed before gates - the first edit added the cap comment WITHOUT the CORPUS_STRIP_CAP constant and the lift comment WITHOUT the showAllCorpus useState, the board crashed (React unmounted this view) and the probe caught it immediately; both declarations completed, HMR verified clean, the live-probe safety net is the r791 disclosure pattern held.")
N1.append("- R4 gates on the final tree: node tsc 0 + lint 0 errors (33 warnings baseline) FIRST-TRY, file-redirected with stdin devnull (never bunx tsc on the pipe); the close re-ran both gates - see the GATES line.")
N1.append("- R5 close: the close script sed-inherited narrative was rewritten by scripts/patch_r792_close.py (the stale r791 story replaced with the true r792 record; the commit line prefix-filtered on the r792 message marker then replaced); close probes: chip presence GATED / tone recorded; tier-state RECORDED; wave-strip presence GATED; the bucket-title probes GATED; letterless RECORDED-only; keyboard-bridge GATED; divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (forty-seventh) + worklog + commit + dual push.")
for t in N1:
    print("built", len(t))
BLOCK1 = "L = []\n" + "\n".join('L.append("' + t + '")' for t in N1) + "\n"

# ---- narrative block 2: after the GATES line up to (not incl.) the worklog open ----
N2 = []
N2.append("Stage Summary: the corpus strip render cap ships (the DOM weight of the heaviest board surface bounded at 24 pills by default, the whole corpus one Show-all click away, the whole-corpus numbers honest in tally/census/chip) - the second freeze-watch increment after the r791 cv-auto; the mem-guard mechanism proof witnessed end-to-end (the graceful restart landed BEFORE the kernel killer, the tuned guard armed on the fresh boot, the addendum-3 threshold doctrine validated); the quiet continuation witness is on-page at four sites (the break deepens to +245m, the amber regime five witnesses deep); QA green first-try + gates first-try; committed and pushed to origin + fork.")
N2.append("")
N2.append("Round Handoff:")
N2.append("Round ID: r793 -> next patrol (job 473388)")
N2.append("Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r792_qa.sh sed-adapted (DUAL pattern s/r=792/r=793/g + bare-label s/r792/r793/g; the r769-r792 scripts are committed in-tree; if swept, recover from git history). ORDER: QA FIRST (the marker gates the close snapshot; the r786 slip is the standing lesson). (2) MEM-GUARD WATCH: the guard is IN-PROCESS (no daemon to relaunch; it does not survive sandbox recycles because it arms at every next-server boot via the instrumentation hook); at open read scripts/mem-guard.log for armed/restart lines - the tuned thresholds (MemAvailable < 600,000 KB primary, RSS > 2,150,000 KB secondary, the 2.0 GB milestone line); a guard-fired restart spends the round dev-restart allowance (record the fresh-rss line in the OOM curve); the warm-boot steady state is 1.87-1.93 GB (addendum 3) - do NOT read that as a breach. (3) SNAPSHOT DISCIPLINE: forty-eighth. (4) TIMEOUT HYGIENE: node tsc (never bunx on the pipe), long children file-redirected with stdin devnull. (5) JUDGE-LANE WATCH: baseline = the GATES census line of this close; TEN lane labels; an ELEVENTH = unrouted on sight. ROUTE WATCH: THE QUIET DEEPENS - +245m at the r792 witness, past its own +208m record; IF a new bucket landed, band point 21 = quote the rendered gapVal at the four sites per the band-append duty (provenance convention: the r792 close record carries the quiet-continuation context; dual-provenance wording if the r793 close re-witnesses the same bucket); if NO bucket landed and the quiet renders past +245m, record the new depth at the four sites (the break continues); the band append and the quiet witness stay mutually exclusive per round. (6) CADENCE: band 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62/57/58/122/78/61 (20 points as of r792 - the quiet witness is NOT a band point; the next LANDING is point 21) - a 100+ gapVal after the deepening break confirms the regime shift, a 60s return holds the old regime. (7) Increment queue, IN ORDER: (a) QA-found bugs first, always; (b) the freeze-watch follow-ups continue (the corpus strip cap shipped r792; the remaining candidate is virtualizing the board chips); (c) small verifiable polish/honesty increments; the P1 backlog rows stay Owner-blocked; (d) TASKS.md re-triage if the Owner unblocks rows. (8) CORTEX P1: the app-side two-paste carrier shipped r787 - the deploy now waits on the Owner source paste; record the edge version + lane matrix if the Owner reports the probe state. (9) Owner queue (carried): PLATFORM REPORT URGENT - three wipes + .archive-snapshot-1028 disposition; THE OOM CURVE - the mem-guard mitigation is live AND PROVEN (the 22:58:36 graceful restart fired before the kernel killer; tuned thresholds avail 600 MB / RSS 2.15 GB; the warm-boot steady state 1.87-1.93 GB documented; the curve now reads as a managed sawtooth instead of an unbounded climb); vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); AIHubMix relay arc: r774 recovering -> r775 adrift -> r776 flat-adrift -> r777 amber lull -> wave-16 q -> wave-17 q-lean-x2 -> wave-18 q-lean-x3 -> wave-19 q-lean-x5 at 122 -> wave-20 letterless at 78 -> wave-21 lettered q at 61 -> the r791 quiet pass (+208m) -> the r792 quiet continuation (+245m, the break deepens). (10) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.")
N2.append("Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the corpus strip render cap is a named freeze-watch mechanism verified live with the lift arithmetic 25 -> 57; the mem-guard end-to-end proof is a named mechanism witness on live data; the quiet continuation at four sites; full golden QA anchored in scripts/qa_r792.txt).")
BLOCK2 = "\n".join('L.append("' + t + '")' for t in N2) + "\n"

# ---- splice ----
i0 = src.index("L = []")
i1 = src.index(GATES_MARK)
i2 = src.index("\n", i1) + 1          # end of the GATES line
i3 = src.index("with open('worklog.md','a')")
out = src[:i0] + BLOCK1 + src[i1:i2] + BLOCK2 + src[i3:]

# ---- commit message: prefix-filtered replacement ----
lines = out.split("\n")
cm = [i for i, l in enumerate(lines) if l.startswith("git commit -m 'r792:")]
require(len(cm) == 1, "commit line filter mismatch: %d matches" % len(cm))
NEW_COMMIT = "git commit -m 'r792: THE FREEZE-WATCH FOLLOW-UP - the corpus strip render cap (the unfiltered strip rendered every pill - 56 runs and climbing at +2-3 per patrol slot of unbounded DOM on the heaviest board surface; now CORPUS_STRIP_CAP 24 at render time per the r227 truth class: tally + census keep the whole-corpus numbers, the shown chip reads the render truth 24 of 56 shown, an honest +32 older runs not shown footer carries a violet-hover Show-all affordance, filters always lift the cap, the lift is session-local; live-verified with the lift arithmetic 25 -> 57 pills) + the mem-guard end-to-end proof witnessed (the old-threshold in-process guard fired its one graceful restart at 22:58:36 - RSS 1.96 GB > the 1.74 GB threshold - BEFORE the kernel killer, the fresh boot armed the tuned guard avail 600 MB / RSS 2.15 GB, the addendum-3 doctrine validated) + the r792 quiet continuation at the four on-page sites (no new bucket by the 23:12 UTC witness, quiet +245m - the break deepens past its own +208m record, the amber regime five witnesses deep). QA green first-try + gates first-try (tsc 0, lint 0 errors / 33 warnings); snapshot forty-seventh.'"
lines[cm[0]] = NEW_COMMIT
out = "\n".join(lines)

# ---- structural re-validation ----
require(out.count("L = []") == 1, "post: L = [] not unique")
require(out.count("with open('worklog.md','a')") == 1, "post: open marker not unique")
require(out.count("f.write") >= 1, "post: f.write missing")
require("THE FREEZE-WATCH FOLLOW-UP" in out, "post: freeze-watch marker missing")
require("+245m" in out, "post: quiet-continuation marker missing")
require("mem-guard" in out, "post: mem-guard marker missing")
require(out.count("git commit -m 'r792:") == 1, "post: commit line not unique")

open(P, "w", encoding="utf-8").write(out)
print("patch_r792_close: narrative block 1 (%d lines), block 2 (%d lines), commit message rewritten OK" % (len(N1), len(N2)))
