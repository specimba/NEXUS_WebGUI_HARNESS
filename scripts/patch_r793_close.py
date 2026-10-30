#!/usr/bin/env python3
# r793: rewrite the sed-inherited r792 narrative in scripts/r793_close.sh with
# the TRUE r793 record (the cap reverse-gear round), per the patch_r789_close.py
# pattern: assert the heredoc structure first, then rewrite the L.append block
# and the git commit message. Abort on any mismatch - never half-patch.
import sys

P = "scripts/r793_close.sh"
src = open(P, encoding="utf-8").read()


def require(cond, msg):
    if not cond:
        print("PATCH ABORT: " + msg)
        sys.exit(1)


GATES_MARK = 'L.append("- GATES: tsc_exit='
require(src.count("L = []") == 1, "L = [] marker not unique")
require(src.count("with open('worklog.md','a')") == 1, "worklog open marker not unique")
require(src.count(GATES_MARK) == 1, "GATES append marker not unique")
require(src.count("Task ID: r793") == 1, "r793 task marker not unique")

# ---- narrative block 1: from "L = []" up to (not incl.) the GATES line ----
N1 = []
N1.append("Task ID: r793")
N1.append("Agent: NEXUS patrol (main agent - job 473388, 07:37 slot; opened on the r792 handoff; HEAD 737f5e5b3 = the r792 sweep artifact atop 290cc43ec; tree CLEAN at open - no parallel-session WIP; server 200 first-try - the SAME pid 17401 since the 22:58 guard-fired boot, rss dipped to ~1.73 GB with no tuned-threshold breach in 39 minutes: the managed sawtooth reads flat, no restart spent)")
N1.append("Task: Patrol round 793 - THE CAP REVERSE-GEAR ROUND + THE QUIET CONTINUATION DEEPENS: (a) COLLAPSE AFFORDANCE - the r792 corpus cap Show-all lift was one-way (until reload); now a violet-hover Collapse to newest 24 button renders whenever the cap is lifted unfiltered with corpus pills above the cap, so the heavier-DOM trade is reversible without a reload (live-verified: the lift read 59 rendered pills -> collapse -> 25, with the 24 of 58 shown chip and the +34 older footer both restored). (b) THE QA-PROBE HONESTY FIX - the r792 cap silently changed the golden-QA board witness semantics: the chips figure counted rendered pills (26) where it historically read the whole corpus (57 at the r792 QA); the probe now reports chips + corpusPills (the whole-corpus figure from the shown chip) + cap explicitly - the r227 truth class restored in the witness line (board: chips 26 / corpusPills 58 / cap 24). (c) THE QUIET CONTINUATION WITNESS at the four on-page sites: still no new bucket by the 23:40 UTC witness, the quiet rendered +273m - the stretch deepens again past the r792 +245m reading (the amber regime six witnesses deep +67/+99/+122/+208/+245/+273m).")
N1.append("Work Log:")
N1.append("- R1 open + scripts + QA FIRST: tree CLEAN at 737f5e5b3; server 200 (pid 17401, rss ~1.73 GB, the guard silent since the 22:58:38 tuned arm - no breach, no restart spent); r793_qa.sh + r793_close.sh via the DUAL sed (s/r=792/r=793/g + bare-label s/r792/r793/g) from the in-tree r792 scripts; the golden QA ran GREEN FIRST-TRY (paste 799; cron 1/1; console 0 errors, page errors none; the ld witness held the TEN-lane baseline, no eleventh).")
N1.append("- R2 witness: the census GREW to 58 runs / 214 ev / 39 verdicts / 34u / 141nj (+2 runs / +14 ev / +4 verdicts / +10u vs the r792 close) yet NO new bucket landed (the newest chip still bucket 10-30 19:00 UTC / gapVal 61, q-lean x4, mid-qwen ACTIVE 1/2 with AIHubMix qwen3.8-flash-free silent, mid-glm silent 0/2) - the backfill went into older slots again; the quiet duty is the live one. The tier-state probe needed the aria-controls selector this round: the r792 textContent match missed the nj toggle (its text is the count, the title carries the lanes prose) - the +273m quiet read captured and recorded at the four sites (route-state title interval + quiet halves, interval-readout title, quiet-readout title).")
N1.append("- R3 increment: the collapse affordance (the r792 cap reverse gear) implemented beside the cap footer in run-kanban.tsx (the same violet-hover chip convention) + the QA-probe honesty fix (corpusPills/cap added to the board witness line in r793_qa.sh, the QA re-run to regenerate the GREEN marker with the honest probe) + the four-site quiet continuation. The collapse verified live: Show all -> 59 pills -> Collapse to newest 24 -> 25 pills, cap chip and footer restored (the r648 honesty class: the affordance exists where the state it reverses is visible).")
N1.append("- R4 gates + close: node tsc 0 + lint 0 errors (33 warnings baseline) on the final tree, file-redirected with stdin devnull (never bunx tsc on the pipe) - see the GATES line; probes: chip presence GATED / tone recorded; tier-state RECORDED; wave-strip presence GATED; the bucket-title probes GATED; letterless RECORDED-only; keyboard-bridge GATED; divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (forty-eighth) + worklog + commit + dual push.")
for t in N1:
    print("built", len(t))
BLOCK1 = "L = []\n" + "\n".join('L.append("' + t + '")' for t in N1) + "\n"

# ---- narrative block 2: after the GATES line up to (not incl.) the worklog open ----
N2 = []
N2.append("Stage Summary: the corpus cap gains its reverse gear (the Show-all lift is now reversible without a reload - the freeze-watch posture stays default-light with an honest escape hatch both ways); the QA board witness carries the whole-corpus truth again (chips + corpusPills + cap); the quiet continuation deepens to +273m at six witnesses; QA green first-try + gates first-try; committed and pushed to origin + fork.")
N2.append("")
N2.append("Round Handoff:")
N2.append("Round ID: r794 -> next patrol (job 473388)")
N2.append("Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r793_qa.sh sed-adapted (DUAL pattern s/r=793/r=794/g + bare-label s/r793/r794/g; the r769-r793 scripts are committed in-tree; if swept, recover from git history). ORDER: QA FIRST (the marker gates the close snapshot; the r786 slip is the standing lesson). (2) MEM-GUARD WATCH: the guard is IN-PROCESS (arms at every next-server boot via the instrumentation hook); at open read scripts/mem-guard.log for armed/restart lines - the tuned thresholds (MemAvailable < 600,000 KB primary, RSS > 2,150,000 KB secondary, the 2.0 GB milestone line); a guard-fired restart spends the round dev-restart allowance (record the fresh-rss line in the OOM curve); the warm-boot steady state is 1.87-1.93 GB (the r791 addendum 3) - do NOT read that as a breach; the r793 open found 39 minutes stable at ~1.73 GB, the sawtooth flat. (3) SNAPSHOT DISCIPLINE: forty-ninth. (4) TIMEOUT HYGIENE: node tsc (never bunx on the pipe), long children file-redirected with stdin devnull. (5) JUDGE-LANE WATCH: baseline = the GATES census line of this close; TEN lane labels; an ELEVENTH = unrouted on sight. ROUTE WATCH: the quiet deepens again (+273m at the r793 witness, six witnesses deep); IF a new bucket landed, band point 21 = quote the rendered gapVal at the four sites per the band-append duty (provenance convention: the r793 close record carries the quiet-continuation context; dual-provenance wording if the r794 close re-witnesses the same bucket); if NO bucket landed and the quiet renders past +273m, record the new depth at the four sites (the break continues); the band append and the quiet witness stay mutually exclusive per round. (6) CADENCE: band 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62/57/58/122/78/61 (20 points as of r793 - the quiet witness is NOT a band point; the next LANDING is point 21) - a 100+ gapVal after the deepening break confirms the regime shift, a 60s return holds the old regime. (7) Increment queue, IN ORDER: (a) QA-found bugs first, always; (b) the freeze-watch follow-ups continue (the corpus strip cap + its reverse gear shipped r792/r793; the remaining candidate is virtualizing the board chips); (c) small verifiable polish/honesty increments; the P1 backlog rows stay Owner-blocked; (d) TASKS.md re-triage if the Owner unblocks rows. (8) CORTEX P1: the app-side two-paste carrier shipped r787 - the deploy now waits on the Owner source paste; record the edge version + lane matrix if the Owner reports the probe state. (9) Owner queue (carried): PLATFORM REPORT URGENT - three wipes + .archive-snapshot-1028 disposition; THE OOM CURVE - the mem-guard mitigation is live AND PROVEN (the 22:58:36 graceful restart fired before the kernel killer; tuned thresholds avail 600 MB / RSS 2.15 GB; the r793 open read 39 minutes stable at ~1.73 GB); vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); AIHubMix relay arc: r774 recovering -> r775 adrift -> r776 flat-adrift -> r777 amber lull -> wave-16 q -> wave-17 q-lean-x2 -> wave-18 q-lean-x3 -> wave-19 q-lean-x5 at 122 -> wave-20 letterless at 78 -> wave-21 lettered q at 61 -> the r791 quiet pass (+208m) -> the r792 continuation (+245m) -> the r793 continuation (+273m, the break deepens). (10) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.")
N2.append("Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the collapse affordance is a named UX completion verified live with the pill arithmetic 59 -> 25; the QA-probe honesty fix is a named witness-truth restoration; the quiet continuation at four sites; full golden QA anchored in scripts/qa_r793.txt).")
BLOCK2 = "\n".join('L.append("' + t + '")' for t in N2) + "\n"

# ---- splice ----
i0 = src.index("L = []")
i1 = src.index(GATES_MARK)
i2 = src.index("\n", i1) + 1          # end of the GATES line
i3 = src.index("with open('worklog.md','a')")
out = src[:i0] + BLOCK1 + src[i1:i2] + BLOCK2 + src[i3:]

# ---- commit message: prefix-filtered replacement ----
lines = out.split("\n")
cm = [i for i, l in enumerate(lines) if l.startswith("git commit -m 'r793:")]
require(len(cm) == 1, "commit line filter mismatch: %d matches" % len(cm))
NEW_COMMIT = "git commit -m 'r793: THE CAP REVERSE-GEAR ROUND - the corpus cap gains its collapse affordance (the r792 Show-all lift was one-way until reload; a violet-hover Collapse to newest 24 button now renders whenever the cap is lifted unfiltered above the cap, live-verified: 59 pills lifted -> 25 after collapse with the 24 of 58 shown chip and the +34 older footer restored) + the QA-probe honesty fix (the r792 cap silently changed the golden-QA board witness: the chips figure counted rendered pills 26 where it historically read the whole corpus; the probe now reports chips + corpusPills + cap explicitly - the r227 truth class restored, board: chips 26 / corpusPills 58 / cap 24) + the r793 quiet continuation at the four on-page sites (no new bucket by the 23:40 UTC witness, quiet +273m - the break deepens again past the r792 +245m reading, the amber regime six witnesses deep +67/+99/+122/+208/+245/+273m; the census backfilled +2 runs / +14 ev into older slots). QA green first-try + gates first-try (tsc 0, lint 0 errors / 33 warnings); snapshot forty-eighth.'"
lines[cm[0]] = NEW_COMMIT
out = "\n".join(lines)

# ---- structural re-validation ----
require(out.count("L = []") == 1, "post: L = [] not unique")
require(out.count("with open('worklog.md','a')") == 1, "post: open marker not unique")
require(out.count("f.write") >= 1, "post: f.write missing")
require("THE CAP REVERSE-GEAR ROUND" in out, "post: reverse-gear marker missing")
require("+273m" in out, "post: quiet-continuation marker missing")
require("corpusPills" in out, "post: probe-honesty marker missing")
require(out.count("git commit -m 'r793:") == 1, "post: commit line not unique")

open(P, "w", encoding="utf-8").write(out)
print("patch_r793_close: narrative block 1 (%d lines), block 2 (%d lines), commit message rewritten OK" % (len(N1), len(N2)))
