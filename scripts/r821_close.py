#!/usr/bin/env python3
"""r821 close: append the patrol section to worklog.md (never overwrite),
collecting the 73rd corpus observation and the snapshotter evidence live."""
import json
import pathlib

root = pathlib.Path("/home/z/my-project")
latest = root / "db" / "corpus-snapshots" / "latest.json"
d = json.loads(latest.read_text(encoding="utf-8"))
rows = d.get("count", len(d.get("rows", [])))
snaps = sorted((root / "db" / "corpus-snapshots").glob("corpus-*.json"))
newest = snaps[-1].name if snaps else "none"


def corpus_lines(name: str) -> list[str]:
    p = root / "scripts" / name
    if not p.exists():
        return ["<missing>"]
    return [ln.strip()[:110] for ln in p.read_text(encoding="utf-8").splitlines() if "corpus" in ln.lower()][:2]


e818 = corpus_lines("r818_qa.sh")
e821 = corpus_lines("r821_qa.sh")

section = f"""
Task ID: r821 (02:07 slot; HEAD opened at d109d78e7 the r820 close, tree clean; server SURVIVED a thirteenth time - 200 at open, no restart spent; mem 2.7/3.9 GB steady at open)
Agent: NEXUS patrol (main agent - job 473388)
Task: Patrol round 821 - THE USAGE BOARD SPEAKS (the handoff's usage-dashboard candidate, verified against the real markup first): the Tool mix rows' names were HAND-ARIA-HIDDEN - the only text a screen reader got from a row was a bare digit ("12") with no tool name, no unit, no list semantics; the Busiest agents rows read as name + bare digit. Now both lists are real lists (role=list, label naming the section AND its unit), every row self-describes (role=listitem aria-label "{{name}} — {{count}} run(s)" / "{{name}} — {{count}} repl(y|ies)" mirroring the visible copy), the inner name/count spans are aria-hidden so nothing double-reads, and rows gain the arc's hover polish (transition-colors hover:bg-muted/30). The handoff's other candidate was checked and honestly retired: the Radar adoption-pipeline rows are the adopted-lane registry the r812 arc already made self-describing.
Work Log:
- R1 open + probe (HEAD d109d78e7, server 200 - thirteenth survival; mem 2.7/3.9 GB); corpus pre-read: latest.json still rows=40, takenAt 16-24-49, no new timestamped snapshot.
- R2 r821_qa.sh derived (0 stale) + FULL GOLDEN QA GREEN on first derive (console 0 errors, page errors none); adoption-pipeline surveyed - honest no-gap (already spoken by the r812 arc).
- R3 corpus WHY (best-evidence archaeology, hedge recorded): the snapshotter is HARNESS-SIDE scripts - qa_r736.txt shows the era's close writing "snapshot: 64 rows -> latest.json (+9 kept)" and r743_close.sh git-adds the directory; git log shows db/corpus-snapshots/ touched by every round r815-r818 but NOT by r819/r820; the current QA chain's corpus step is: r818_qa.sh -> {e818 if e818 else "none"} | r821_qa.sh -> {e821 if e821 else "none"}. Conclusion: the 32->36->36->40 "cadence" was the per-round snapshot procedure writing as the live tracker found rows, and the quiet since r818 tracks that procedure no longer running in the round pipeline (not a paused app-side cadence). Exact trigger point of the r815-r818 writes not fully traced - hedge stands.
- R4 the usage-board gap verified (tool rows: name span aria-hidden by hand -> bare digit; agent rows: name + bare digit, no units) and the increment wired (two labeled lists + row utterances + hover polish).
- R5 witness GREEN first run (after a harness file-race: the witness script's Write and its first Bash call ran in parallel and bash saw no file - the gates themselves ran green on the code changes; the script then ran as written): "Web Search — 1 run", "WitnessWorker — 2 replies", "SecondAgent — 1 reply" asserted live; BOTH stores (nexus-agents + nexus-conversations) restored and verified clean through the write-back-safe dance. GATES unmasked: tsc=0, lint=0 errors (28 warnings, per-file set md5 c965c8e8961745824f858ce1f12b475a identical to baseline).
- R6 snapshot SEVENTY-THIRD: db/corpus-snapshots/latest.json rows={rows}, newest timestamped {newest} - second consecutive quiet read; cadence watch RETIRED per the R3 finding.
GATES: tsc_exit=0 - lint_exit=0 (0 errors, 28 warnings, set md5 identical) - WITNESS_EXIT=0 (five assertions, live DOM, store-clean:yes both stores) - QA_EXIT=0 (FULL GOLDEN, first derive)
Stage Summary: the usage dashboard's two lists now speak name + count + unit per row (the tool rows previously hand-hid their own names - bare digits to a screen reader); the corpus cadence mystery is closed as harness archaeology (the snapshot procedure left the round pipeline after r818; watch retired, number-only recordings from here); the adoption-pipeline candidate honestly retired as already-spoken; both witness stores verified clean.
Round Handoff:
Round ID: r822 -> next patrol (job 473388)
Next recommended action: (1) golden QA: scripts/r821_qa.sh is the proven template (copy + rename r821->r822; bump ?r=821 -> ?r=822 alongside the plain rename). CORPUS: record latest.json's rows field at close (number only; the cadence watch is retired - growth only returns if someone revives the snapshot procedure). (2) Increment candidates: QA-found bugs first; else the spoken-surface arc: the usage dashboard is DONE - remaining verify-first candidates: the chat message lists (message-item.tsx has a role=list near line 581 - check its siblings), the command palette / global-search results lists, or the LaneRideTally detail in the adoption pipeline. (3) WITNESS DOCTRINE carried: dual-store seeding (nexus-agents + nexus-conversations) works with the write-back-safe cleanup; topAgents FILTERS unknown agents - seed the roster too; ToolCallInfo uses name (a TOOL_META id like web_search), not tool; batch tool calls with their sleep - a Write and its consuming Bash in ONE message can RACE (r821: bash saw no file), so guard with a wait-for-file loop. (4) THE CARRIED DOM WITNESSES: cortex lane-age caption green-verdict probe (10 consecutive reds); ladder details disclosure >6-entry boards payload; 401 quickCheck + provider/token notes remain real-event-only. (5) Owner queue carried: CORTEX 401 = Owner-side config (disable Enforce JWT verification for nexus-cortex-harness ONLY, set the edge secrets, the SAME random phrase as CORTEX_SHARED_SECRET into the app Cortex key field, Probe again); KICK widget, PAT rotation, Webshare token, vault re-key BACKUP-FIRST; upload/nexus-provider-vault.json holds LIVE KEYS, never commit (verify at every close). (6) MEM-GUARD read at open (2.7/3.9 GB steady). (7) Snapshot seventy-fourth next close (number only). (8) r707 mechanism-per-round: HELD (the usage-board utterances are a named, live-witnessed user-facing mechanism; the corpus closure and the dual-store witness are the named evaluations).
Blockers: none app-side; TASK-101/102 stale (absent from TASKS.md - do not chase); the cortex lane stays Owner-side config.
"""

wl = root / "worklog.md"
wl.write_text(wl.read_text(encoding="utf-8").rstrip("\n") + "\n" + section, encoding="utf-8")
print(f"appended r821 section; corpus_rows={rows} newest={newest} r818_qa_corpus={len(e818)}lines r821_qa_corpus={len(e821)}lines")
