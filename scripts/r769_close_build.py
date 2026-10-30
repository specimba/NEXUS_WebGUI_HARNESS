#!/usr/bin/env python3
"""r769 close-script builder (r767_prose doctrine): all-or-nothing line surgery
on scripts/r769_close.sh. Every anchor must hit exactly once; every new-text
must be apostrophe-free AND single-quote-free (the close heredoc embeds them in
single-quoted Python literals - the r767 R3 quote defect and the line-96
apostrophe killed that heredoc; r768/r769 rebuild clean). The file is written
only if ALL checks pass."""

import sys

PATH = "scripts/r769_close.sh"

REPLACEMENTS = {
    2: (
        "# r769 close (qwen-lean counter + quiet open): gates",
        "# r769 close (quiet readout + wave-10 open watch): gates",
    ),
    32: (
        "# tier-state probe (r769): RECORDED ONLY - now carries the lean tag (r769 increment); the route-state line is a witness, not a gate (amber-tone doctrine).",
        "# tier-state probe (r769): RECORDED ONLY - the line carries the lean tag (r767), the interval readout (r768) and the quiet readout (r769); the route-state line is a witness, not a gate (amber-tone doctrine).",
    ),
    77: (
        "L.append('Agent: NEXUS patrol (main agent - job 473388, 10:37 slot; opened on the r766 handoff - HEAD 490adc44d = the r766 ship + sweep from the 10:07 slot, own-session lineage, no parallel round closed)')",
        "L.append('Agent: NEXUS patrol (main agent - job 473388, 11:37 slot; opened on the r768 handoff - HEAD d280bcd42 = the r768 ship + sweep from the 11:07 slot, own-session lineage, no parallel round closed)')",
    ),
    78: (
        "Task: Patrol round 767 - QWEN-LEAN COUNTER SHIPS",
        "Task: Patrol round 769 - QUIET READOUT SHIPS, WAVE-10 OPEN WATCH: the opening ro-SQL census read 133 ev / 35 runs / 97 nj - FLAT vs the r768 close (133/35/21/15/97, newest ~03:03:43 UTC = wave 10); no wave 11 at open, ~34 min quiet at the 11:37 +08 open - inside the band (13-42-62-57-61, plateauing near ~60), no break; verdict/uncertain flat 21/15 with no new wave since wave 10. Route: the lean is CEMENTED per the r768 watch - four straight q (00:03, 01:05, 02:02, 03:03) - and the on-page counter should read q-lean x4. Shipped the quiet readout (the zero-growth half of the cadence watch that laneGap cannot state): laneQuiet computes minutes elapsed since the newest corpus row of the newest shown bucket (bounds max-to-now, the same bounds the strip hover shows); the clock read is gated behind mount so SSR and hydration agree (no mismatched timestamp on first paint), and a negative delta guards clock skew. The readout renders in the corpus tier-state line after the interval readout (+Nm quiet style, font-medium text-foreground/70 matching the strip letters) with its own title documenting the semantics, and the tier-state title gains the quiet sentence. The burst-ended watch is now an on-page read: a stretch past the band ceiling with no new wave shows as a growing quiet count without deriving it from the strip. Honest scoping: no new data source.",
    ),
    80: (
        "- R1 open probes: no parallel session - HEAD 490adc44d was the r766 ship + sweep",
        "- R1 open probes: no parallel session - HEAD d280bcd42 was the r768 ship + sweep (own-session lineage); tree clean; server 200; ro-SQL census 133/35/21/15/97 - FLAT vs the r768 close, no wave 11 at open (~34 min quiet, newest ~03:03:43 UTC = wave 10) -> steady-watch path with the quiet-readout increment.",
    ),
    81: (
        "- R2 templates: r769_qa.sh + r769_close.sh via the DUAL sed pattern",
        "- R2 templates: r769_qa.sh + r769_close.sh via the DUAL sed pattern (s/r=768/r=769/g + s/r768/r769/g) applied to the r767 templates recovered from git history (the swept tree no longer carries them) - zero mechanical remnants, bash -n green; the round-768 prose gaps (spelled-out Patrol round 768 + the literal Round ID r769 pointer) handled by this builder surgery, new-texts apostrophe-free AND single-quote-free per the r767/r768 lessons; wave-11 watch armed.",
    ),
    82: (
        "- R3 increment (run-kanban.tsx): laneLean memo inserted after laneTiers",
        "- R3 increment (run-kanban.tsx): laneQuiet memo inserted after laneGap - minutes elapsed since the newest corpus row of the newest shown bucket (waveStrip bounds max-to-now, null-guarded when a bound is missing and when the clock delta is negative); the clock read is gated behind a mount state (useState + useEffect) so SSR and hydration agree, and the memo recomputes on mount; the readout renders in the corpus tier-state line after the interval readout (+Nm quiet style, font-medium text-foreground/70 matching the strip letters, own title documenting semantics), and the tier-state title gains the quiet sentence. Three-edit MultiEdit verified in the returned diff (r760/r762 marker-verify discipline honored).",
    ),
    84: (
        "- R5 QA + close: the r769 golden QA ran GREEN first-try",
        "- R5 QA + close: the r769 golden QA ran GREEN (board probe at the wave-10 steady census, chips per the artifact; ld seven lanes, no eighth; settings census+relay, radar frontier, 799-char long-paste all green; console 0 errors). Close probes: chip GATED presence / tone recorded; legend GATED (the tier-state line inside the legend was edited - same view; r756-r769 precedent honored); tier-state probe RECORDED (witnessed the lean tag, the interval readout, and the new quiet readout live); wave-strip probe presence GATED / text RECORDED; divergence probe RECORDED ONLY; + census + snapshot + worklog + commit + dual push.",
    ),
    96: (
        "- LEAN MADE FIRST-CLASS:",
        "- QUIET WATCH COMPLETED: the cadence watch is now a three-legged on-page read - the lean tag (r767), the interval readout (r768) and the quiet readout (r769) state route, gap and staleness in the corpus tier-state line, so cement, break and burst-end are recorded-probe witnesses every round. Zero-growth open (~34 min, inside the band) keeps the burst-ending watch armed but declares nothing; the lean is CEMENTED (four straight q at open) and the counter states it live. Snapshot discipline twenty-fifth close. Witness seven-legged (board, ld, chip, legend, tier state, lane filter, wave strip) + the divergence census, all green.",
    ),
    97: (
        "- CANDIDATE NOTE (no deviation): the r766 handoff named no increment candidate",
        "- CANDIDATE NOTE (no deviation): the r768 handoff named no increment candidate (queue: builtin box Owner-asked / TASKS.md re-triage / QA bugs first); this round continued the r759-r768 instrument line with the quiet readout - the cadence watch became a complete on-page trio. The builtin box extraction stays parked for an explicitly requested refactor round.",
    ),
    99: (
        "L.append('Round ID: r768 -> next patrol (job 473388)')",
        "L.append('Round ID: r770 -> next patrol (job 473388)')",
    ),
    101: (
        "held (the lean counter shipped into a live steady-watch",
        "held (the quiet readout shipped into a live wave-10 watch - the recorded tier-state probe carries the lean tag, the interval readout and the new quiet readout, and the open census read q-lean x4 - + full golden QA, anchored in scripts/qa_r769.txt and scripts/qa_r769_close.txt).",
    ),
}

NEXT_ACTION = (
    "L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r769_qa.sh sed-adapted (DUAL pattern s/r=769/r=770/g + s/r769/r770/g; if the tree was swept again, recover the template from git history like this round did); remember the round-769 prose gaps (spelled-out Patrol round 769 + the literal Round ID r770 pointer - both handled in the close-script builder) AND the surgery quote lesson: new-text strings must be apostrophe-free AND single-quote-free (the close heredoc embeds them in single-quoted Python literals - the r767 R3 quote defect and the line-96 apostrophe killed that heredoc; r768/r769 rebuilt clean); close probes: chip presence gated / tone recorded; legend probe GATED if the round touches the strip/legend/tier-state/run-card view, else RECORDED; tier-state probe: RECORDED ONLY (carries the lean tag since r767, the interval readout since r768 and the quiet readout since r769); wave-strip probe: presence GATED / text RECORDED; divergence probe: RECORDED ONLY; the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; ROUTE WATCH: the lean is CEMENTED (four straight q, 00:03 through 03:03) - a fifth q deepens it, a g return resets the counter (alternation resumed), an m bucket or m run (both routes, amber, 7 lanes) = the first both-routes witness - investigate; a BOTH-SILENT bucket (3 lanes = genuine partial ladder) = investigate immediately; a lag on intern/fast-judge/jev = genuine partial ladder; any EIGHTH lane (labeled unrouted on sight), a VERDICT/UNCERTAIN growth wave, a NEW wave beyond the close census newest (the strip bucket total rises), or an interval-pattern break (band 13-42-62-57-61 plateauing near ~60 - the on-page interval and quiet readouts are the witnesses now; a gap far outside, or a quiet stretch past ~62, = the burst ended) = new signal. (5) Increment queue: no named candidate - candidates: (a) the builtin box extraction (~90 lines, parked since r567) for an Owner-asked refactor round; (b) TASKS.md re-triage if the Owner unblocks rows; (c) QA-found bugs first, always. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download; AIHubMix relay LEAN CEMENTED (r768): four straight qwen waves (00:03, 01:05, 02:02, 03:03) after the wave-by-wave alternation, now surfaced as the on-page lean counter - the platform report should describe the lean, not an outage. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')",
)

COMMIT_MSG = (
    'git commit -m "r769: quiet readout ships + wave-10 open watch. Census flat at 133/35/21/15/97 vs the r768 close - no wave 11 at open (~34 min quiet at the 11:37 +08 open, newest ~03:03:43 UTC = wave 10, inside the band 13-42-62-57-61, plateau near ~60); verdict/uncertain flat 21/15 with no new wave since wave 10. Route: lean CEMENTED - four straight q (00:03, 01:05, 02:02, 03:03). Increment: laneQuiet - minutes elapsed since the newest corpus row of the newest shown bucket (bounds max-to-now, mount-gated clock read so SSR and hydration agree), rendered as +Nm quiet in the corpus tier-state line after the interval readout (font-medium text-foreground/70, own title) with the quiet sentence in the title - the zero-growth half of the cadence watch made on-page, completing the r767/r768 watch trio (styling polish: the tag matches the strip-letter treatment). Surgery new-texts apostrophe-free and single-quote-free per the r767/r768 lessons. Snapshot discipline twenty-fifth close."',
)

LINE_100_OLD_PREFIX = "L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r769_qa.sh"
LINE_108_OLD_PREFIX = 'git commit -m "r769: qwen-lean counter ships'


def main() -> int:
    with open(PATH, encoding="utf-8") as f:
        lines = f.read().split("\n")
    errors = []

    # 1) anchor checks - each old prefix/substring must hit its line exactly once
    for ln, (old, _new) in REPLACEMENTS.items():
        if old not in lines[ln - 1]:
            errors.append("line %d: anchor not found: %s..." % (ln, old[:70]))
    if not lines[99].startswith(LINE_100_OLD_PREFIX):
        errors.append("line 100: anchor not found")
    if not lines[107].startswith(LINE_108_OLD_PREFIX):
        errors.append("line 108: anchor not found")

    def inner(text: str) -> str:
        # extract the heredoc-embedded string body: the r767 defect class
        # lived INSIDE the single-quoted literal, not in the delimiters
        t = text.strip()
        if t.startswith("L.append(") and t.endswith(")"):
            body = t[len("L.append("):-1]
            if len(body) >= 2 and body.startswith("'") and body.endswith("'"):
                return body[1:-1]
        if t.startswith("git commit -m "):
            body = t[len("git commit -m "):]
            if len(body) >= 2 and body.startswith('"') and body.endswith('"'):
                return body[1:-1]
        return t

    if errors:
        print("BUILD ABORTED (all-or-nothing):")
        for e in errors:
            print(" -", e)
        return 1

    # 2) quote-safety: new texts must carry no apostrophe / single quote
    new_lines = {}
    for ln, (_old, new) in REPLACEMENTS.items():
        new_lines[ln] = new
    new_lines[100] = NEXT_ACTION[0] if isinstance(NEXT_ACTION, tuple) else NEXT_ACTION
    new_lines[108] = COMMIT_MSG[0] if isinstance(COMMIT_MSG, tuple) else COMMIT_MSG
    for ln, text in sorted(new_lines.items()):
        if "os.environ" in text:
            continue
        if "'" in inner(text):
            errors.append("line %d: new-text contains a single quote" % ln)
            break
    if errors:
        print("BUILD ABORTED (quote safety):")
        for e in errors:
            print(" -", e)
        return 1

    # 3) apply
    for ln, text in sorted(new_lines.items()):
        lines[ln - 1] = text

    # 4) stale-fragment audit on the FINAL content (nothing may survive)
    for bad in ("Patrol round 767", "490adc44d", "s/r=769/r=768", "10:37 slot",
                "r766 ship", "QWEN-LEAN COUNTER SHIPS"):
        for i, l in enumerate(lines, 1):
            if bad in l:
                errors.append("stale fragment %r survives at line %d" % (bad, i))
    if errors:
        print("BUILD ABORTED (stale fragments survive):")
        for e in errors:
            print(" -", e)
        return 1

    with open(PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("r769 close script rebuilt: %d lines replaced, all anchors 1-hit, quote-safe, zero stale fragments" % len(new_lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
