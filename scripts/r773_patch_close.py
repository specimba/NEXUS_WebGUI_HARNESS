#!/usr/bin/env python3
# r773: patch the sed-generated close script with the round narrative.
# Line-prefix replacement + insertion; every anchor must match or we exit 1
# BEFORE the close runs (guarded patching - no partial rewrite).
import sys

P = "scripts/r773_close.sh"
lines = open(P).read().split("\n")
out = []
inserted_probe = False
inserted_envline = False
export_done = False

LNT_BLOCK = [
    '# r773: letterless-title probe - the increment witness, content GATED (the feature is young).',
    r"""LNT=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/^Bucket /.test(e.getAttribute('title')||'')):[]; const t=c.length?c[c.length-1].getAttribute('title'):''; return JSON.stringify({chips:c.length,hasLanes:/lanes named here/.test(t),hasWhy:/no route letter: no middle-tier lane dialed/.test(t),tail:t.slice(-150)}); })()" 2>&1 | tail -1)""",
    'echo "letterless title: $LNT"',
    "echo \"$LNT\" | grep -Eq 'hasLanes\\\\?\":true' || { echo 'GUARD letterless lanes'; exit 1; }",
    "echo \"$LNT\" | grep -Eq 'hasWhy\\\\?\":true' || { echo 'GUARD letterless why'; exit 1; }",
]

TASK = (
    "L.append('Task: Patrol round 773 - DOC DEBT PAID: the letterless-bucket chip title now names its lanes and states why it carries no letter. "
    "Opening check: HEAD 35979fa6b = a system-side cron commit (one tee line in scripts/qa_r772_close.txt - benign, disclosed; the r771-era twin 7013126a5 rode out the same way), "
    "tree clean, server 200 first-try. Golden QA GREEN FIRST-TRY: tally 38 runs / 148 ev / 22 verdicts / 15u / 111nj (no growth during the round), the ld lane census listed the TEN labels - NO eleventh (no unrouted signal), "
    "console 0 errors, page errors empty. The strip: 01:00 x4 q / 02:00 x3 q / 03:00 x4 q / 04:00 x3 q / 04:45 x8 q / 05:00 x3 letterless (5 lanes) - NO wave 13; the letterless 05:00 bucket stayed newest all round. "
    "Tier-state at the witness: +6m since prior, +43m quiet (amber correctly OFF, under the 62 ceiling), both middle routes silent 0/2 and 0/2 with the silent lanes named inline - the BOTH-SILENT carry UNCHANGED (no newer bucket, "
    "so the two-in-a-row test stays pending the next lettered bucket); the lean counter stays RESTARTED (no lettered bucket since the break, so no fresh run yet). Shipped: (a) per-bucket named-lane list in every corpus-mode strip chip hover "
    "(lanes named here: ... - the r757 per-lane claim now true on the strip itself); (b) letterless buckets state the letterless semantics on the hover: no route letter: no middle-tier lane dialed in this slot, the lanes above are outer-rung lanes "
    "(the letter needs a middle-tier qwen or glm dial) - the r772 investigation bound (the one-instant span, no lane names) is closed on-page; (c) the legend title r757 sentence forward-corrected (lane chip title wording + the r773 note); "
    "(d) styling polish: transition-colors on the legend lane chips (the amber filter-flip smooths, the r771 quiet-tag convention).')"
)

R_LINES = [
    ("L.append('- R1 open", "L.append('- R1 open: parallel-session check clean (the worklog tail handed off r773; git log showed no r773 commit; the cron-tagged 35979fa6b matched the r771-era 7013126a5 pattern - one tee line, same author); server 200 first-try; tree clean.')"),
    ("L.append('- R2 census", "L.append('- R2 QA: scripts/r773_qa.sh via the DUAL sed from the in-tree r772 script; ran GREEN FIRST-TRY (board strip true, tally 38 runs / 148 ev / 22 verdicts / 15u / 111nj, chips 39; ld all lanes with intern+fast+paid asserted, TEN labels, no eleventh; settings census+relay; radar frontier aria-click; 799-char long-paste witnessed; cron chip 1/1; console 0 errors, page errors empty).')"),
    ("L.append('- R3 QA", "L.append('- R3 witnesses + fix site: the strip re-read on a deep link (6 buckets, 05:00 letterless x3, 5 lanes); the route-state line missed inside the strip container (it lives in the legend, closed at probe time) - legend opened: +6m since prior, +43m quiet, amber false, both middle routes silent (0/2 - silent: AIHubMix qwen3.8-flash-free, AIHubMix qwen3.8-max-free); the waveStrip memo read: route letters derive from middle-tier dial counts per bucket, so a letterless bucket provably has zero middle-tier dials and the named-lane list is derivable from laneBuckets.lanes - the honest-title fix designed from data in hand.')"),
    ("L.append('- R4 witnesses", "L.append('- R4 increment (run-kanban.tsx, five edits): the named map in the waveStrip memo (same scan, same single dependency); the chip hover carries lanes named here + the letterless why-sentence (corpus mode only); the legend title r757 sentence forward-corrected; transition-colors on the legend lane chips.')"),
    ("L.append('- R5 increment", "L.append('- R5 gates + pre-witness: tsc 0 / lint 0 errors (33 warnings baseline) on the increment tree; the letterless title pre-witnessed live on the HMR board (the 05:00 chip: lanes named here intern-systemone, Inception Labs mercury-3, OrcaRouter google/gemini-3.8-flash, fast-judge, jev (paid rung) + the why-sentence; tier-state +6m / +43m quiet / amber false).')"),
    ("L.append('- R6 gates", "L.append('- R6 close: chip presence GATED / tone recorded; legend GATED (the legend view edited this round); tier-state RECORDED; wave-strip presence GATED / text RECORDED; letterless-title content GATED (the increment witness); divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (twenty-ninth) + worklog + commit + dual push.')"),
]

STAGE1 = (
    "L.append('- DOC DEBT PAID: the letterless chip hover now names its lanes and states why it carries no letter - the r772 investigation bound is closed on-page and the r757 per-lane claim is true on the strip itself "
    "(the lane chips keep their per-lane lists; the bucket chips gained the per-bucket view). No wave 13 during the round: the letterless 05:00 bucket stayed newest, quiet +43m at witness time (amber correctly off under the 62 ceiling), "
    "interval +6m unchanged; TEN lane labels held (no eleventh, no unrouted); the lean counter stays restarted with no fresh run; the BOTH-SILENT carry is unchanged (0/2 and 0/2, silent lanes named inline) - the two-in-a-row test still pends "
    "the next lettered bucket. Snapshot discipline twenty-ninth close. Witness eight-legged (board, ld, chip, legend, tier state, lane filter, wave strip, letterless title) + the divergence census + the quietAmber read.')"
)
STAGE2 = (
    "L.append('- CANDIDATE NOTE (no deviation): the builtin box extraction stays parked for an explicitly requested refactor round; TASKS.md P1 rows stay Owner-blocked; QA green first-try (no bugs found); "
    "the queued doc debt (d) is PAID this round - no new doc debt queued.')"
)

HANDOFF = (
    "L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r773_qa.sh sed-adapted (DUAL pattern s/r=773/r=774/g; the r769-r773 scripts are committed in-tree; if swept, recover from git history); "
    "surgery lessons stand (apostrophe-free AND single-quote-free new texts; block replacement with a compile() pre-flight and a 5-line commit-line window scan is the kept pattern). Probes: chip presence gated / tone recorded; "
    "legend GATED if the round touches the strip/legend/tier-state/run-card view, else RECORDED; tier-state RECORDED ONLY (lean r767, interval r768, quiet r769, amber tone r770, band docs r771-r772, silent-lane names r772, named-lane chip lists r773); "
    "wave-strip presence GATED / text RECORDED; letterless-title content GATED (the r773 increment witness - keep it gated while the feature is young); divergence RECORDED ONLY; tally gated. (2) SNAPSHOT DISCIPLINE (thirtieth). (3) TIMEOUT HYGIENE. "
    "(4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; TEN lane labels; an ELEVENTH = unrouted on sight. ROUTE WATCH: the lean counter is RESTARTED and IDLE (no lettered bucket since the 05:00 break) - the next lettered bucket starts "
    "a fresh run: a deepening q run, a g return (alternation resumed), or an m bucket (the first both-routes witness) all read from the restarted counter; BOTH-SILENT carried: if the next lettered bucket is also both-silent, that is two in a row - "
    "then watch the relay lanes directly per the r770 doctrine (the 04:45 bucket ran x8 q - the middle tier was healthy one bucket before the silent one). (5) CADENCE: band 13/16/41/58/13/42/62/57/61/70/6; quiet crossed +43m at the r773 witness with the amber "
    "self-arming past 62 - if wave 13 lands, the round that witnesses it records the new interval forward; a quiet stretch PAST the ceiling with no wave = the amber burst-end witness on-page. (6) Increment queue: (a) the builtin box extraction (~90 lines, "
    "parked since r567) for an Owner-asked refactor round; (b) TASKS.md re-triage if the Owner unblocks rows; (c) QA-found bugs first, always; (d) the letterless-title doc debt is PAID (r773) - new candidates from QA findings only. "
    "(7) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (8) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; "
    "vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); AIHubMix relay: the restart (+6m), "
    "the verdict growth (21 -> 22) and the both-silent 05:00 bucket stand as witnessed; no wave 13 through the r773 close (quiet +43m and climbing) - the platform report describes the restart + verdict growth + the silent bucket, not an outage. "
    "(9) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')"
)

BLOCKERS = (
    "L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the letterless chip now names its lanes and states the letterless "
    "semantics - a named mechanism, gated-witnessed in scripts/qa_r773_close.txt; full golden QA anchored in scripts/qa_r773.txt).')"
)

COMMIT = (
    'git commit -m "r773: doc debt paid - the letterless strip chip now names its lanes on hover and states why it carries no letter (no middle-tier lane dialed in this slot; the letter needs a middle-tier qwen or glm dial), '
    'so the r772 one-instant-span investigation bound is closed on-page; every corpus bucket chip hover carries its named-lane list (the r757 per-lane claim true on the strip itself); the legend title r757 sentence forward-corrected. '
    'Styling polish: transition-colors on the legend lane chips. Watch: no wave 13 - the letterless 05:00 bucket stayed newest (+6m interval, +43m quiet at witness, amber correctly off), TEN lanes held, lean counter restarted with no fresh run, '
    'BOTH-SILENT carry unchanged. Snapshot discipline twenty-ninth close."'
)

for ln in lines:
    if ln.startswith("# r773 close (wave 12"):
        out.append("# r773 close (doc debt paid: letterless chip names its lanes + states the letterless semantics; transition-colors polish): gates")
        continue
    if ln.startswith("L.append('Agent: NEXUS patrol"):
        out.append("L.append('Agent: NEXUS patrol (main agent - job 473388, 13:37 slot; opened on the r772 handoff; HEAD 35979fa6b = a system-side cron commit (one line in scripts/qa_r772_close.txt - the r772 tee drift absorbed outside the patrol; benign, disclosed, the same pattern as the r771-era 7013126a5) on top of the r772 sweep ba6b1e986; no parallel round closed (the worklog tail handed off r773; git log showed no r773 commit))')")
        continue
    if ln.startswith("L.append('Task: Patrol round"):
        out.append(TASK); continue
    if ln.startswith("L.append('Task ID:"):
        out.append("L.append('Task ID: r773')"); continue
    replaced_r = False
    for pref, new in R_LINES:
        if ln.startswith(pref):
            out.append(new); replaced_r = True; break
    if replaced_r:
        continue
    if ln.startswith("L.append('  wave strip: '"):
        out.append(ln)
        out.append("L.append('  letterless title: ' + os.environ.get('R773_LNT','(missing)'))")
        inserted_envline = True
        continue
    if ln.startswith("L.append('- WAVE 12 HANDLED"):
        out.append(STAGE1); continue
    if ln.startswith("L.append('- CANDIDATE NOTE"):
        out.append(STAGE2); continue
    if ln.startswith("L.append('Round ID:"):
        out.append("L.append('Round ID: r774 -> next patrol (job 473388)')"); continue
    if ln.startswith("L.append('Next recommended action:"):
        out.append(HANDOFF); continue
    if ln.startswith("L.append('Blockers:"):
        out.append(BLOCKERS); continue
    if ln.startswith("git commit -m"):
        out.append(COMMIT); continue
    if 'R760_TIER="$TIER"' in ln and not export_done:
        out.append(ln.replace('R760_TIER="$TIER"', 'R760_TIER="$TIER" R773_LNT="$LNT"'))
        export_done = True
        continue
    if ln.startswith('echo "$STRIP" | grep -Eq') and not inserted_probe:
        out.append(ln)
        out.extend(LNT_BLOCK)
        inserted_probe = True
        continue
    out.append(ln)

missing = [n for n, f in [("probe", inserted_probe), ("envline", inserted_envline), ("export", export_done)] if not f]
if missing:
    print("PATCH FAILED - anchors missing:", missing)
    sys.exit(1)

open(P, "w").write("\n".join(out))
print("patched: r773_close.sh (probe+envline+export ok)")
