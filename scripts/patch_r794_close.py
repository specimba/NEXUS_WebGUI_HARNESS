#!/usr/bin/env python3
# r794: rewrite the sed-inherited r793 narrative in scripts/r794_close.sh with
# the TRUE r794 record (the render-containment round), per the patch_r792_close.py
# pattern: assert the structure first, then rewrite the L.append lines and the
# git commit message. Abort on any mismatch - never half-patch.
import sys

P = "scripts/r794_close.sh"
src = open(P, encoding="utf-8").read()


def require(cond, msg):
    if not cond:
        print("PATCH ABORT: " + msg)
        sys.exit(1)


def replace_line(prefix, new_line, label):
    global src
    lines = src.split("\n")
    hits = [i for i, l in enumerate(lines) if l.startswith(prefix)]
    require(len(hits) == 1, label + ": expected 1 line with prefix, got " + str(len(hits)))
    lines[hits[0]] = new_line
    src = "\n".join(lines)


require('L.append("Task ID: r794")' in src, "task id anchor missing")
require(src.count('L.append("Task ID: r794")') == 1, "task id not unique")
require("git commit -m 'r794:" in src, "commit anchor missing")

replace_line(
    'L.append("Agent: ',
    'L.append("Agent: NEXUS patrol (main agent - job 473388, 08:07 slot; opened on the r793 handoff; HEAD e903090d8 = the r793 sweep artifact atop 525c262e3; tree CLEAN at open - no parallel-session WIP; server 200 first-try - the SAME pid 17401 since the 22:58 guard-fired boot, rss read 1,770,156 KB at open with no tuned-threshold breach since 22:58:38: the managed sawtooth reads flat, no restart spent)")',
    "agent",
)

replace_line(
    'L.append("Task: Patrol round ',
    'L.append("Task: Patrol round 794 - THE RENDER-CONTAINMENT ROUND + THE QUIET CONTINUATION DEEPENS: (a) CONTENT-VISIBILITY RENDER CONTAINMENT on the corpus strip (the freeze-watch third increment after the r792 cap and the r793 reverse gear): the strip container (the heaviest DOM surface - the 24 capped pills + the lane legend) now carries content-visibility:auto + contain-intrinsic-size, so while it sits scrolled out of view the browser skips its layout and paint entirely; the DOM stays intact (the QA probes read it unchanged) and the strip renders normally on approach - live-verified via the computed style. (b) THE QUIET CONTINUATION WITNESS at the four on-page clauses: still no new bucket by the 00:14 UTC witness, the quiet rendered +309m - the stretch deepens again past the r793 +273m reading (the amber regime seven witnesses deep +67/+99/+122/+208/+245/+273m/+309m).")',
    "task",
)

replace_line(
    'L.append("- R1 open',
    'L.append("- R1 open + scripts + QA FIRST: tree CLEAN at e903090d8; server 200 (pid 17401, rss read 1,770,156 KB at open, the guard silent since the 22:58:38 tuned arm - no breach, no restart spent, the sawtooth flat); r794_qa.sh + r794_close.sh + patch_r794_close.py via the DUAL sed (s/r=793/r=794/g + bare-label s/r793/r794/g) from the in-tree r793 scripts; the golden QA ran GREEN FIRST-TRY (board: chips 26 / corpusPills 58 / cap 24; paste 799; cron 1/1; console 0 errors, page errors none; the ld witness held the TEN-lane baseline, no eleventh).")',
    "R1",
)

replace_line(
    'L.append("- R2 witness',
    'L.append("- R2 witness: the census HELD FLAT at 58 runs / 214 ev / 39 verdicts / 34u / 141nj (identical to the r793 close read) and NO new bucket landed (the interval tag still reads +61m since prior, the q-lean x4 tag held, the newest chip still bucket 10-30 19:00 UTC) - a zero-growth round on both sides; the quiet duty is the live one. The tier-state line needed the legend expansion this round: the quiet tags live behind the nj toggle click (aria-controls corpus-lane-legend), so the witness probe clicked the toggle first, then read +309m quiet / +61m since prior rendered - recorded at the four on-page clauses (route-state title interval + quiet halves, interval-readout title, quiet-readout title).")',
    "R2",
)

replace_line(
    'L.append("- R3 increment',
    'L.append("- R3 increment: the render-containment classes implemented on the strip container in run-kanban.tsx (content-visibility:auto + contain-intrinsic-size:auto_340px Tailwind arbitrary utilities - pure styling, no logic, DOM untouched) + the four-clause quiet continuation. One mid-round slip caught before any probe relied on the tree: the r794 JSX note first landed as a braced comment in expression position (a parse-error class - the r792 slip pattern), flagged at edit time and corrected to a plain block comment in the same round. The containment verified live post-HMR: computed content-visibility auto on the strip, the strip probes unchanged.")',
    "R3",
)

replace_line(
    'L.append("- R4 gates + close',
    'L.append("- R4 gates + close: node tsc 0 + lint 0 errors (33 warnings baseline) on the final tree, file-redirected with stdin devnull (never bunx tsc on the pipe) - see the GATES line; probes: chip presence GATED / tone recorded; tier-state RECORDED; wave-strip presence GATED; the bucket-title probes GATED; letterless RECORDED-only; keyboard-bridge GATED; divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (forty-ninth) + worklog + commit + dual push.")',
    "R4",
)

replace_line(
    'L.append("Stage Summary: ',
    'L.append("Stage Summary: the corpus strip gains render containment (content-visibility:auto - the freeze-watch third increment: the heaviest DOM surface skips layout and paint while out of view, honestly invisible, DOM intact for every probe); the quiet continuation deepens to +309m at seven witnesses with the census held flat; QA green first-try + gates first-try; committed and pushed to origin + fork.")',
    "stage",
)

replace_line(
    'L.append("Round ID: r',
    'L.append("Round ID: r795 -> next patrol (job 473388)")',
    "round-id",
)

replace_line(
    'L.append("Next recommended action: ',
    'L.append("Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r794_qa.sh sed-adapted (DUAL pattern s/r=794/r=795/g + bare-label s/r794/r795/g; the r769-r794 scripts are committed in-tree; if swept, recover from git history). ORDER: QA FIRST (the marker gates the close snapshot; the r786 slip is the standing lesson). (2) MEM-GUARD WATCH: the guard is IN-PROCESS (arms at every next-server boot via the instrumentation hook); at open read scripts/mem-guard.log for armed/restart lines - the tuned thresholds (MemAvailable < 600,000 KB primary, RSS > 2,150,000 KB secondary, the 2.0 GB milestone line); a guard-fired restart spends the round dev-restart allowance (record the fresh-rss line in the OOM curve); the warm-boot steady state is 1.87-1.93 GB (the r791 addendum 3) - do NOT read that as a breach; the r794 open read ~1.77 GB with the guard silent since 22:58:38, the sawtooth flat. (3) SNAPSHOT DISCIPLINE: fiftieth. (4) TIMEOUT HYGIENE: node tsc (never bunx on the pipe), long children file-redirected with stdin devnull. (5) JUDGE-LANE WATCH: baseline = the GATES census line of this close; TEN lane labels; an ELEVENTH = unrouted on sight. ROUTE WATCH: the quiet deepens again (+309m at the r794 witness, seven witnesses deep); IF a new bucket landed, band point 21 = quote the rendered gapVal at the four clauses per the band-append duty (provenance convention: the r794 close record carries the quiet-continuation context; dual-provenance wording if the r795 close re-witnesses the same bucket); if NO bucket landed and the quiet renders past +309m, record the new depth at the four clauses (the break continues); the band append and the quiet witness stay mutually exclusive per round; NOTE the quiet tags live behind the nj toggle click (aria-controls corpus-lane-legend) - expand the legend before reading the quiet witness. (6) CADENCE: band 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62/57/58/122/78/61 (20 points as of r794 - the quiet witness is NOT a band point; the next LANDING is point 21) - a 100+ gapVal after the deepening break confirms the regime shift, a 60s return holds the old regime. (7) Increment queue, IN ORDER: (a) QA-found bugs first, always; (b) the freeze-watch follow-ups continue (the strip render containment shipped r794; the remaining candidates: the same containment on the run-detail panel and the board card columns); (c) small verifiable polish/honesty increments; the P1 backlog rows stay Owner-blocked; (d) TASKS.md re-triage if the Owner unblocks rows. (8) CORTEX P1: the app-side two-paste carrier shipped r787 - the deploy now waits on the Owner source paste; record the edge version + lane matrix if the Owner reports the probe state. (9) Owner queue (carried): PLATFORM REPORT URGENT - three wipes + .archive-snapshot-1028 disposition; THE OOM CURVE - the mem-guard mitigation is live AND PROVEN (the 22:58:36 graceful restart fired before the kernel killer; tuned thresholds avail 600 MB / RSS 2.15 GB; the r794 open read ~1.77 GB stable); vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); AIHubMix relay arc: r774 recovering -> r775 adrift -> r776 flat-adrift -> r777 amber lull -> wave-16 q -> wave-17 q-lean-x2 -> wave-18 q-lean-x3 -> wave-19 q-lean-x5 at 122 -> wave-20 letterless at 78 -> wave-21 lettered q at 61 -> the r791 quiet pass (+208m) -> the r792 continuation (+245m) -> the r793 continuation (+273m) -> the r794 continuation (+309m, the break deepens). (10) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.")',
    "next-action",
)

replace_line(
    'L.append("Blockers: ',
    'L.append("Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the render-containment increment is a named freeze-watch mechanism verified live via the computed style; the quiet continuation at four clauses; full golden QA anchored in scripts/qa_r794.txt).")',
    "blockers",
)

# git commit message
lines = src.split("\n")
hits = [i for i, l in enumerate(lines) if l.startswith("git commit -m 'r794:")]
require(len(hits) == 1, "commit line: expected 1, got " + str(len(hits)))
lines[hits[0]] = (
    "git commit -m 'r794: THE RENDER-CONTAINMENT ROUND - the corpus strip gains content-visibility:auto "
    "render containment (the freeze-watch third increment after the r792 cap and the r793 reverse gear: the "
    "heaviest DOM surface - the 24 capped pills + the lane legend - skips layout and paint while scrolled out "
    "of view, DOM intact for every probe, renders normally on approach, live-verified via the computed style) "
    "+ the four-clause quiet continuation (no new bucket by the 00:14 UTC witness, quiet +309m - the break "
    "deepens past the r793 +273m reading, the amber regime seven witnesses deep +67/+99/+122/+208/+245/+273m/+309m; "
    "the census held flat 58 runs / 214 ev and the interval held 61m). QA green first-try + gates first-try "
    "(tsc 0, lint 0 errors / 33 warnings); snapshot forty-ninth.'"
)
src = "\n".join(lines)

# structural re-verification
require(src.count("+309m") >= 6, "309m marker count too low: " + str(src.count("+309m")))
require(src.count("content-visibility") >= 2, "containment marker missing")
require("seven witnesses deep" in src, "seven-witness marker missing")
require("forty-ninth" in src, "snapshot marker missing")
require("r795" in src, "handoff round marker missing")
require("00:14 UTC witness" in src, "witness time marker missing")

with open(P, "w", encoding="utf-8") as f:
    f.write(src)
print("PATCH OK: r794_close.sh carries the true r794 record")
