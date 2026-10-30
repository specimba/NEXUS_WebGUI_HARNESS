#!/usr/bin/env python3
# r791: rewrite the sed-inherited r790 narrative in scripts/r791_close.sh with
# the TRUE r791 record (the Owner bug round), per the patch_r789_close.py
# pattern: assert the heredoc structure first, then rewrite the L.append block
# and the git commit message. Abort on any mismatch - never half-patch.
import sys

P = "scripts/r791_close.sh"
src = open(P, encoding="utf-8").read()


def require(cond, msg):
    if not cond:
        print("PATCH ABORT: " + msg)
        sys.exit(1)


GATES_MARK = 'L.append("- GATES: tsc_exit='
require(src.count("L = []") == 1, "L = [] marker not unique")
require(src.count("with open('worklog.md','a')") == 1, "worklog open marker not unique")
require(src.count(GATES_MARK) == 1, "GATES append marker not unique")
require(src.count("Task ID: r791") == 1, "r791 task marker not unique")

# ---- narrative block 1: from "L = []" up to (not incl.) the GATES line ----
N1 = []
N1.append("Task ID: r791")
N1.append("Agent: NEXUS patrol (main agent - job 473388, 06:37 slot; opened on the r790 handoff; HEAD df43b934b = the r790 sweep artifact atop 715b6565f; tree NOT clean at open - the r791 round arrived as mid-flight WIP from a prior session that died before gates/close: the six-file increment diff, the golden-QA marker already GREEN in scripts/qa_r791.txt, and the untracked r791 scripts + mem-guard.sh were audited line-by-line, adopted and completed; server 200 first-try, no restart needed; opening witness: next-server rss ~1.93 GB hovering at the stall mark)")
N1.append("Task: Patrol round 791 - THE OWNER BUG ROUND: the Owner reported (a) the React duplicate-key console error (two children with the same key `exa`) and (b) the Chrome page-unresponsive freeze cycle (~20 minutes per occurrence, the recovery refresh risking a sandbox wipe) and asked for a RAM/efficiency deep dive. (a) EXA FIX: exa lived in BOTH provider registries - the FREE_PROVIDERS spread (browser-key providers) and the acquisition-registry candidates - so with a browser exa key saved and no exa slot yet, the vault mirror strip rendered two children keyed exa; fixed with the !providerById(p.id) guard on the acquisition candidates (the two sources are now provably disjoint; registry-only ids brightdata/webshare kept). (b) THE FREEZE WATCH, two halves: CLIENT - the .cv-auto class (content-visibility: auto + contain-intrinsic-size: auto 260px) on the Frontier / GitHub Stars / Papers card grids so offscreen cards skip layout+paint (the DOM stays complete, census/probe queries unaffected); SERVER - scripts/mem-guard.sh, the pre-OOM graceful-restart watchdog (RSS threshold 1.70 GB fires the canonical dev-restart.sh BEFORE the kernel killer, dead-server revive after two failed health probes, 300s cooldown, 120s probe cadence, flock single-instance, log bounded at 400 lines). (c) THE QUIET-PASS WITNESS per the r790 handoff duty: no new bucket by the 22:34 UTC witness and the quiet rendered +208m - PAST the 122 band max, the longest zero-growth stretch on record (the genuine cadence break) - recorded at all four on-page sites (route-state title interval + quiet halves, interval-readout title, quiet-readout title); the amber past-ceiling regime four witnesses deep (+67/+99/+122/+208m).")
N1.append("Work Log:")
N1.append("- R1 open + adoption audit: the r790 handoff items (1)-(5) were found PART-EXECUTED by the prior session - the DUAL-sed r791 scripts in place, the golden QA already run GREEN (marker scripts/qa_r791.txt: board 56 runs / 200 ev / 35 verdicts / 24u / 141nj, chips 57 - the census GREW 3 runs / 14 rows into older slots; the ld witness held the TEN-lane baseline, no eleventh; paste 799; cron 1/1; console 0 errors, page errors none); the increment diff (the exa guard + cv-auto x3 + the four-site quiet-pass witness) was reviewed line-by-line and adopted; no source changes needed this session.")
N1.append("- R2 witness: the r791 pass judged per the r790 handoff item (4) - NO new bucket landed (the newest chip still bucket 10-30 19:00 UTC / gapVal 61) and the quiet readout rendered +208m at the 22:34 UTC witness: the band-append duty and the quiet-pass duty are mutually exclusive, the QUIET PASS is the live one (past 122 = the longest stretch on record, the genuine cadence break); the same-round census growth (3 runs / 14 rows) went into older slots without moving the newest bucket - the quiet counts only the newest bucket newest row, disclosed on-page.")
N1.append("- R3 exa-fix verification live: the settings probe found the vault card + mirror strip mounted, ZERO exa duplicate entries (exaButtons 0), the registry-only acquisition candidate kept (acqButtons 1), and 0 same-key occurrences in console and page errors - the Owner-reported console error is gone at the registry-disjointness level (providerById imported at automation-vault-card.tsx:51, tsc clean).")
N1.append("- R4 gates on the adopted tree: node tsc 0 + lint 0 errors (33 warnings baseline) FIRST-TRY, file-redirected with stdin devnull (never bunx tsc on the pipe); the close re-ran both gates on the final tree - see the GATES line.")
N1.append("- R5 close: the close script sed-inherited narrative was rewritten by scripts/patch_r791_close.py (the stale r790 story replaced with the true r791 record; the commit line prefix-filtered on the r791 message marker then replaced); close probes: chip presence GATED / tone recorded; tier-state RECORDED; wave-strip presence GATED; the bucket-title probes GATED; letterless RECORDED-only; keyboard-bridge GATED; divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (forty-sixth) + worklog + commit + dual push. AFTER the close: mem-guard.sh launched session-detached (setsid nohup, flock single-instance) - deliberately AFTER the probes because the opening rss ~1.93 GB sits above its 1.70 GB threshold, so its first 120s probe gracefully restarts the server and resets the curve; the guard does NOT survive sandbox recycles - every patrol open must relaunch it until the Owner side adopts it (handoff item 2).")
for t in N1:
    print("built", len(t))
BLOCK1 = "L = []\n" + "\n".join('L.append("' + t + '")' for t in N1) + "\n"

# ---- narrative block 2: after the GATES line up to (not incl.) the worklog open ----
N2 = []
N2.append("Stage Summary: the Owner duplicate-key error is fixed at the registry-disjointness level and verified live (0 exa duplicates, 0 same-key console entries); the freeze watch ships both halves (cv-auto client + mem-guard server, the guard launched post-close and its graceful restart expected within minutes); the quiet-pass witness (+208m, past the 122 max, the genuine cadence break) is on-page at four sites with the amber series; QA green (adopted mid-flight marker) + gates first-try; committed and pushed to origin + fork.")
N2.append("")
N2.append("Round Handoff:")
N2.append("Round ID: r792 -> next patrol (job 473388)")
N2.append("Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r791_qa.sh sed-adapted (DUAL pattern s/r=791/r=792/g + bare-label s/r791/r792/g; the r769-r791 scripts are committed in-tree; if swept, recover from git history). ORDER: QA FIRST (the marker gates the close snapshot; the r786 slip is the standing lesson). (2) MEM-GUARD WATCH (NEW - the r791 mitigation is LIVE): at open read scripts/mem-guard.log - if the guard restarted the server, record the fresh-rss line in the OOM curve and treat that restart as the round dev-restart allowance SPENT (no second restart); RELAUNCH if not running: setsid nohup bash scripts/mem-guard.sh </dev/null >/dev/null 2>&1 & (it does not survive sandbox recycles); never rely on it mid-round before server probes - its 120s probe can restart the server under them; launch at open BEFORE probes only if the log shows a healthy cool-down, otherwise AFTER the close. Threshold 1.70 GB, 300s cooldown, flock single-instance. (3) SNAPSHOT DISCIPLINE: forty-seventh. (4) TIMEOUT HYGIENE: node tsc (never bunx on the pipe), long children file-redirected with stdin devnull. (5) JUDGE-LANE WATCH: baseline = the GATES census line of this close; TEN lane labels; an ELEVENTH = unrouted on sight. ROUTE WATCH: the r791 QUIET PASS fired (+208m past the 122 max, the genuine cadence break) - the NEXT bucket to land is band point 21: quote the rendered gapVal at the four sites per the band-append duty (provenance convention: the r791 close record carries the quiet-pass context; dual-provenance wording if the r792 close re-witnesses the same bucket); the quiet resets when the bucket lands; the band append and the quiet pass stay mutually exclusive per round. (6) CADENCE: band 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62/57/58/122/78/61 (20 points as of r791 - the quiet pass is NOT a band point; the next LANDING is point 21) - a 100+ gapVal after the break confirms the regime shift, a 60s return holds the old regime. (7) Increment queue, IN ORDER: (a) QA-found bugs first, always; (b) the freeze-watch follow-ups if the Owner still sees stalls (candidates: virtualize the board chips, cap the corpus strip shown window); (c) small verifiable polish/honesty increments; the P1 backlog rows stay Owner-blocked; (d) TASKS.md re-triage if the Owner unblocks rows. (8) CORTEX P1: the app-side two-paste carrier shipped r787 - the deploy now waits on the Owner source paste; record the edge version + lane matrix if the Owner reports the probe state. (9) Owner queue (carried): PLATFORM REPORT URGENT - three wipes + .archive-snapshot-1028 disposition; THE OOM CURVE - the mem-guard mitigation is live (threshold 1.70 GB, graceful restart before the kernel killer); the historical witnesses stand (kills 1.82/1.71/1.56 GB, the ~1.92 GB stall, the regrowth to ~2.05 GB at +423m, ~1.93 GB at the r791 open); vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); AIHubMix relay arc: r774 recovering -> r775 adrift -> r776 flat-adrift -> r777 amber lull -> wave-16 q -> wave-17 q-lean-x2 -> wave-18 q-lean-x3 -> wave-19 q-lean-x5 at 122 -> wave-20 letterless at 78 -> wave-21 lettered q at 61 -> the r791 quiet pass (+208m, the genuine cadence break). (10) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.")
N2.append("Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the exa registry-disjointness fix is a named bug fix closed against the Owner console report; the mem-guard watchdog is a named mechanism; the quiet-pass witness at four sites; full golden QA anchored in scripts/qa_r791.txt).")
BLOCK2 = "\n".join('L.append("' + t + '")' for t in N2) + "\n"

# ---- splice ----
i0 = src.index("L = []")
i1 = src.index(GATES_MARK)
i2 = src.index("\n", i1) + 1          # end of the GATES line
i3 = src.index("with open('worklog.md','a')")
out = src[:i0] + BLOCK1 + src[i1:i2] + BLOCK2 + src[i3:]

# ---- commit message: prefix-filtered replacement ----
lines = out.split("\n")
cm = [i for i, l in enumerate(lines) if l.startswith("git commit -m 'r791:")]
require(len(cm) == 1, "commit line filter mismatch: %d matches" % len(cm))
NEW_COMMIT = "git commit -m 'r791: THE OWNER BUG ROUND - the exa duplicate-key fix (exa lived in BOTH the FREE_PROVIDERS spread and the acquisition-registry candidates; with a browser exa key saved and no exa slot yet the vault mirror strip rendered two children with the same key exa - the !providerById guard makes the two candidate sources provably disjoint, registry-only ids brightdata/webshare kept) + the freeze watch in two halves (client: the cv-auto class, content-visibility auto + contain-intrinsic-size, on the Frontier / GitHub Stars / Papers card grids so offscreen cards skip layout+paint while the DOM stays complete for probes; server: scripts/mem-guard.sh the pre-OOM graceful-restart watchdog - RSS threshold 1.70 GB fires the canonical dev-restart.sh BEFORE the kernel killer, dead-server revive after two failed probes, 300s cooldown, flock single-instance, launched session-detached after the close) + the r791 quiet-pass witness at the four on-page sites (no new bucket by the 22:34 UTC witness, the quiet rendered +208m - PAST the 122 band max, the longest zero-growth stretch on record, the genuine cadence break, the amber past-ceiling regime four witnesses deep +67/+99/+122/+208m). QA green (adopted mid-flight marker) + gates first-try (tsc 0, lint 0 errors / 33 warnings); snapshot discipline forty-sixth close.'"
lines[cm[0]] = NEW_COMMIT
out = "\n".join(lines)

# ---- structural re-validation ----
require(out.count("L = []") == 1, "post: L = [] not unique")
require(out.count("with open('worklog.md','a')") == 1, "post: open marker not unique")
require(out.count("f.write") >= 1, "post: f.write missing")
require("THE OWNER BUG ROUND" in out, "post: owner-bug marker missing")
require("+208m" in out, "post: quiet-pass marker missing")
require("mem-guard" in out, "post: mem-guard marker missing")
require(out.count("git commit -m 'r791:") == 1, "post: commit line not unique")

open(P, "w", encoding="utf-8").write(out)
print("patch_r791_close: narrative block 1 (%d lines), block 2 (%d lines), commit message rewritten OK" % (len(N1), len(N2)))
