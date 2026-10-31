#!/usr/bin/env python3
# r795: rewrite the sed-inherited r794 narrative in scripts/r795_close.sh with
# the TRUE r795 record (the column-containment round), per the patch_r792_close.py
# pattern: assert the structure first, then rewrite the L.append lines and the
# git commit message. Abort on any mismatch - never half-patch.
import sys

P = "scripts/r795_close.sh"
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


require('L.append("Task ID: r795")' in src, "task id anchor missing")
require(src.count('L.append("Task ID: r795")') == 1, "task id not unique")
require("git commit -m 'r795:" in src, "commit anchor missing")

replace_line(
    'L.append("Agent: ',
    'L.append("Agent: NEXUS patrol (main agent - job 473388, 08:37 slot; opened on the r794 handoff; HEAD 59053c641 = the r794 render-containment round atop the 913a0c453 sweep artifact; tree CLEAN at open - no parallel-session WIP; SERVER DOWN AT OPEN (curl 000, no next-server process) - the first death of the guard era: the 00:18:38 milestone line recorded RSS 2,003,984 KB crossing 2.0 GB with MemAvailable 967,248 KB, BOTH tuned tripwires untripped (avail above the 600 MB pressure line, RSS below the 2.15 GB secondary), and the death landed un-witnessed between the r794 close probes (00:35, live) and the r795 open (00:38, dead); the ONE dev-restart allowance spent at open - fresh boot 200, fresh rss 1,961,108 KB settling to 1,729,040 KB by the witness probes, the sawtooth resets)")',
    "agent",
)

replace_line(
    'L.append("Task: Patrol round ',
    'L.append("Task: Patrol round 795 - THE COLUMN-CONTAINMENT ROUND + THE CHIP WEDGE RESOLVED + THE QUIET CONTINUATION DEEPENS: (a) per-column render containment on the four board sections (the freeze-watch fourth increment after the r792 cap, the r793 reverse gear and the r794 strip containment): the kanban grid stacks below xl (grid-cols-1 / sm:grid-cols-2), the lower columns sit below the fold and now carry content-visibility:auto + contain-intrinsic-size - layout+paint skipped until scrolled near, DOM intact for every probe. (b) THE R794 CHIP FALSE RESOLVED: the chip probe retried on the fresh daemon reads TRUE (chip true, text 58 in corpus) - the r794 close GUARD was the wedged-tab artifact, the chip element itself untouched (workflows-view.tsx, not in the r794 commit). (c) THE CV INNERTEXT BOUNDARY DISCLOSED: the r794 strip containment excludes offscreen contained subtrees from body.innerText - the DOM-level probe reads (textContent, querySelectorAll) are immune, the golden QA reads DOM-level and stayed green, the witness probes moved to the tier-state span textContent. (d) THE QUIET CONTINUATION at the four clauses: still no new bucket by the 00:41 UTC witness, the quiet rendered +335m (eight witnesses deep +67/+99/+122/+208/+245/+273m/+309m/+335m; the gap held 61m).")',
    "task",
)

replace_line(
    'L.append("- R1 open',
    'L.append("- R1 open + restart + scripts + QA FIRST: server DOWN at open (curl 000, no next-server) after the 00:18 2.0 GB milestone line; the one dev-restart spent (dev-restart OK, fresh boot 200, fresh rss 1.96 GB settling to 1.73 GB); r795_qa.sh + r795_close.sh + patch_r795_close.py via the DUAL sed (s/r=794/r=795/g + bare-label s/r794/r795/g) from the in-tree r794 scripts; the board route prewarmed before the QA (fresh-boot first compile); the golden QA ran GREEN FIRST-TRY (board: chips 26 / corpusPills 58 / cap 24; paste 799; cron 1/1; console 0 errors, page errors none; the ld witness held the TEN-lane baseline, no eleventh).")',
    "R1",
)

replace_line(
    'L.append("- R2 witness',
    'L.append("- R2 witness: the census HELD FLAT at 58 runs / 214 ev / 39 verdicts / 34u / 141nj and NO new bucket landed (the interval still +61m since prior, the q-lean x4 tag held) - a zero-growth round again; the quiet witness needed the DOM-LEVEL read this round (the r794 strip containment excludes the offscreen strip from body.innerText - see the disclosure): the tier-state span textContent read +335m quiet / +61m since prior rendered - recorded at the four on-page clauses (route-state title interval + quiet halves, interval-readout title, quiet-readout title). The chip probe retried TRUE on the fresh daemon (the r794 false resolved as the wedge artifact).")',
    "R2",
)

replace_line(
    'L.append("- R3 increment',
    'L.append("- R3 increment: per-column containment classes on the four board sections in run-kanban.tsx (content-visibility:auto + contain-intrinsic-size:auto_280px Tailwind arbitrary utilities - pure styling, no logic, DOM untouched) + the four-clause quiet continuation. Verified live post-HMR: computed content-visibility auto on a section, the section and strip probes unchanged.")',
    "R3",
)

replace_line(
    'L.append("- R4 gates + close',
    'L.append("- R4 gates + close: node tsc 0 + lint 0 errors (33 warnings baseline) on the final tree, file-redirected with stdin devnull (never bunx tsc on the pipe) - see the GATES line; probes: chip presence GATED (TRUE on the fresh daemon) / tone recorded; tier-state RECORDED; wave-strip presence GATED; the bucket-title probes GATED; letterless RECORDED-only; keyboard-bridge GATED; divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (fiftieth) + worklog + commit + dual push.")',
    "R4",
)

replace_line(
    'L.append("Stage Summary: ',
    'L.append("Stage Summary: the board columns gain per-column render containment (the freeze-watch fourth increment, the stacked-grid paint skip, live-verified); the r794 chip false resolved as the wedge artifact (retry TRUE on the fresh daemon); the cv innerText boundary disclosed with the DOM-level probe migration; the quiet continuation deepens to +335m at eight witnesses with the census held flat; the server death + one-restart restart recorded in the OOM curve; QA green first-try + gates first-try; committed and pushed to origin + fork.")',
    "stage",
)

replace_line(
    'L.append("Round ID: r',
    'L.append("Round ID: r796 -> next patrol (job 473388)")',
    "round-id",
)

replace_line(
    'L.append("Next recommended action: ',
    'L.append("Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r795_qa.sh sed-adapted (DUAL pattern s/r=795/r=796/g + bare-label s/r795/r796/g; the r769-r795 scripts are committed in-tree; if swept, recover from git history). ORDER: QA FIRST (the marker gates the close snapshot; the r786 slip is the standing lesson). (2) MEM-GUARD WATCH: the guard is IN-PROCESS (arms at every next-server boot via the instrumentation hook); at open read scripts/mem-guard.log for armed/restart/milestone lines - the tuned thresholds (MemAvailable < 600,000 KB primary, RSS > 2,150,000 KB secondary, the 2.0 GB milestone line); the OOM CURVE HAS A NEW ROW: the r795 open found the server DEAD un-witnessed (between the 00:35 r794 close probes and the 00:38 open) after the 00:18 2.0 GB milestone with MemAvailable 967 MB - both tripwires untripped; the one dev-restart was spent; the fresh boot re-arms the guard; IF the server is down again at open, spend the one restart and keep going serverless afterwards; the warm-boot steady state is 1.87-1.96 GB (do NOT read as a breach). (3) SNAPSHOT DISCIPLINE: fifty-first. (4) TIMEOUT HYGIENE: node tsc (never bunx on the pipe), long children file-redirected with stdin devnull. (5) JUDGE-LANE WATCH: baseline = the GATES census line of this close; TEN lane labels; an ELEVENTH = unrouted on sight. ROUTE WATCH: the quiet deepens again (+335m at the r795 witness, eight witnesses deep); IF a new bucket landed, band point 21 = quote the rendered gapVal at the four clauses per the band-append duty (provenance convention: the r795 close record carries the quiet-continuation context; dual-provenance wording if the r796 close re-witnesses the same bucket); if NO bucket landed and the quiet renders past +335m, record the new depth at the four clauses (the break continues); the band append and the quiet witness stay mutually exclusive per round; NOTE the witness read MUST be DOM-level (the tier-state span textContent via querySelector) while the strip sits contained offscreen - body.innerText EXCLUDES the cv-skipped subtree (the r795 disclosure). (6) CADENCE: band 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62/57/58/122/78/61 (20 points as of r795 - the quiet witness is NOT a band point; the next LANDING is point 21) - a 100+ gapVal after the deepening break confirms the regime shift, a 60s return holds the old regime. (7) Increment queue, IN ORDER: (a) QA-found bugs first, always; (b) the freeze-watch follow-ups continue (the per-column containment shipped r795; the remaining candidate: the run-detail panel rows); (c) small verifiable polish/honesty increments; the P1 backlog rows stay Owner-blocked; (d) TASKS.md re-triage if the Owner unblocks rows. (8) CORTEX P1: the app-side two-paste carrier shipped r787 - the deploy now waits on the Owner source paste; record the edge version + lane matrix if the Owner reports the probe state. (9) Owner queue (carried): PLATFORM REPORT URGENT - three wipes + .archive-snapshot-1028 disposition; THE OOM CURVE - NEW ROW: the server died un-witnessed between rounds after the 2.0 GB milestone (both tripwires untripped) - the mem-guard guards PRESSURE, and a pressure death with 967 MB still available means the killer fired elsewhere or the process crashed; consider a post-mortem read of the dev-restart/daemon logs when the Owner is back; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); AIHubMix relay arc: r774 recovering -> r775 adrift -> r776 flat-adrift -> r777 amber lull -> wave-16 q -> wave-17 q-lean-x2 -> wave-18 q-lean-x3 -> wave-19 q-lean-x5 at 122 -> wave-20 letterless at 78 -> wave-21 lettered q at 61 -> the r791 quiet pass (+208m) -> the r792 continuation (+245m) -> the r793 continuation (+273m) -> the r794 continuation (+309m) -> the r795 continuation (+335m, the break deepens). (10) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.")',
    "next-action",
)

replace_line(
    'L.append("Blockers: ',
    'L.append("Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the per-column containment is a named freeze-watch mechanism verified live via the computed style; the chip-wedge resolution is a named witness restoration; the cv innerText boundary is a named probe-migration disclosure; the quiet continuation at four clauses; full golden QA anchored in scripts/qa_r795.txt).")',
    "blockers",
)

# git commit message
lines = src.split("\n")
hits = [i for i, l in enumerate(lines) if l.startswith("git commit -m 'r795:")]
require(len(hits) == 1, "commit line: expected 1, got " + str(len(hits)))
lines[hits[0]] = (
    "git commit -m 'r795: THE COLUMN-CONTAINMENT ROUND - the board columns gain per-column content-visibility:auto "
    "render containment (the freeze-watch fourth increment after the r792 cap, the r793 reverse gear and the r794 "
    "strip containment: the stacked grid below xl puts the lower columns below the fold, their layout+paint skipped "
    "until scrolled near, DOM intact for every probe, live-verified via the computed style) + the r794 chip false "
    "RESOLVED (the probe retry on the fresh daemon reads chip true / 58 in corpus - the r794 GUARD was the wedged-tab "
    "artifact, the chip element untouched) + the cv innerText boundary disclosed (offscreen contained subtrees drop "
    "out of body.innerText; the DOM-level probes immune, the witness moved to the tier-state span textContent) + the "
    "four-clause quiet continuation (no new bucket by the 00:41 UTC witness, quiet +335m, eight witnesses deep "
    "+67/+99/+122/+208/+245/+273m/+309m/+335m, the gap held 61m) + the OOM curve row: the server died un-witnessed "
    "between the r794 close (00:35 live) and the r795 open (00:38 dead) after the 00:18 2.0 GB milestone line "
    "(MemAvailable 967 MB, both tripwires untripped); the one dev-restart spent, the fresh boot settled 1.96 -> 1.73 GB. "
    "QA green first-try + gates first-try (tsc 0, lint 0 errors / 33 warnings); snapshot fiftieth.'"
)
src = "\n".join(lines)

# structural re-verification
require(src.count("+335m") >= 6, "335m marker count too low: " + str(src.count("+335m")))
require(src.count("content-visibility") >= 2, "containment marker missing")
require("eight witnesses deep" in src, "eight-witness marker missing")
require("fiftieth" in src, "snapshot marker missing")
require("r796" in src, "handoff round marker missing")
require("00:41 UTC witness" in src, "witness time marker missing")
require("wedged-tab artifact" in src, "chip resolution marker missing")

with open(P, "w", encoding="utf-8") as f:
    f.write(src)
print("PATCH OK: r795_close.sh carries the true r795 record")
