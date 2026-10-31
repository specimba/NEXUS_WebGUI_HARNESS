#!/usr/bin/env python3
# r825 close: verify the round's ground truth (witness green + store-clean,
# tsc 0, lint 0 errors with the baseline warning set), record the corpus
# snapshot number-only (watch retired per r821), verify the vault stays
# gitignored, and ONLY THEN append the round handoff to worklog.md (never
# overwrite). Any failed check aborts before the append.
# r824 lessons baked in: md5 over the sorted file list WITH trailing newline
# (the grep|sort|md5sum parity) and live slots via .replace (never .format -
# the entry text contains literal braces).
import glob
import hashlib
import json
import os
import subprocess
import sys

PROJ = "/home/z/my-project"
LINT_BASELINE_MD5 = "c965c8e8961745824f858ce1f12b475a"

entry_tail = """Task ID: r825 (04:07 slot; HEAD opened at e08c1e918 the r824 close, tree clean, origin AND fork 0 ahead at open; server SURVIVED a seventeenth time - 200 at open, no restart spent; mem 2.9/4.0 GB at open, available dipped to 1.1 GB - watch next open)
Agent: NEXUS patrol (main agent - job 473388)
Task: Patrol round 825 - THE BOARD SPEAKS ITS LISTS (the handoff's verify-first census, run exactly as prescribed: the role="list" set enumerated across src (8 files already speak) x a per-file button-density grep ranked the unspoken surfaces, and the workflows board led it at 36 buttons; targeted reads verified the gaps BEFORE any edit): two real gaps, both wired. (a) THE EVOLUTION LEDGER (the ranked experiments panel): its rows were bare fragments - name + bare counts, the novelty trail dots and the experiment/delta chips were TITLE-TOOLTIP ONLY, and the container had no list semantics; now it is a labeled list ("Evolution ledger - N pipelines with done runs"), every row is a listitem whose ONE utterance carries the whole story (name, done count, recency, experiment provenance + label, and the full novelty trail oldest-to-newest with stall flags), the name/meta/trail/chips are aria-hidden so nothing double-reads, and rows gain the arc's hover polish (transition-colors + hover tint). (b) THE CARD GRID: the board's pipeline cards were a bare grid; now the grid is a labeled list ("Workflow pipelines - N pipelines") and each card is a listitem (the card's h3 still names it; the actions button already spoke).
Work Log:
- R1 open + probe (HEAD e08c1e918, server 200 - seventeenth survival, no restart; mem 2.9/4.0 GB); r824 handoff verified as the last section; this slot ran as r825.
- R2 r825_qa.sh derived (0 stale, 6 cache-busters, the SEARCH GUARD LEG carried) + FULL GOLDEN QA GREEN on first derive (console 0 errors, page errors none).
- R3 the verify-first census (role="list" spoken-set grep x button-density grep): workflows-view.tsx led the unspoken surfaces (36 buttons; run-kanban 22, workflow-run-panel 21, automation-vault-card 17, server-autopilot 14 behind it); targeted reads verified the Evolution-ledger rows and the bare card grid as the round's gaps.
- R4 the increment wired: ledger labeled list + row utterances + aria-hidden visuals + hover polish; card grid labeled list + listitem cards.
- R5 witness GREEN first run (the self-healing recovery preamble shipped from the start per the r824 doctrine, and the seed carries every field the assert checks - the r824 agentId lesson applied: the done run carries novelty:72): "Evolution ledger - 1 pipeline with done runs", the row utterance "r825 witness pipeline - 1 done run, last ..., novelty trail oldest to newest: 72%" and the card-grid listitem holding the seeded pipeline asserted live through the #/workflows/board deep link; both stores (nexus-agents + nexus-workflows) restored and verified clean through the write-back-safe dance.
- R6 GATES unmasked: tsc=0, lint=0 errors (28 warnings, per-file set md5 identical to baseline); snapshot SEVENTY-SEVENTH: latest.json rows=__ROWS__ (newest timestamped: __NEWEST__ - number only, watch retired); vault-gitignored:__VAULT__.
GATES: tsc_exit=0 - lint_exit=0 (0 errors, 28 warnings, set md5 identical) - WITNESS_EXIT=0 (four assertions: ledger list + row utterance + card grid + card listitem, live DOM, store-clean:yes both stores) - QA_EXIT=0 (FULL GOLDEN, first derive)
Stage Summary: the workflows board now speaks both of its remaining unspoken surfaces (the Evolution ledger's ranked rows with their full novelty stories, and the pipeline card grid); the census recipe (spoken-set grep x button-density grep) named the target cleanly and is the round's named evaluation; golden QA green on first derive; witness green first run.
Round Handoff:
Round ID: r826 -> next patrol (job 473388)
Next recommended action: (1) golden QA: scripts/r825_qa.sh is the proven template (copy + rename r825->r826; bump ?r=825 -> ?r=826 alongside the plain rename) - keep the SEARCH GUARD LEG in every future derive. (2) Increment candidates: QA-found bugs first; else continue the census-named backlog: run-kanban.tsx (22 buttons) and workflow-run-panel.tsx (21 - the r818 arc covered only its STEP rows) are the next unspoken surfaces, then automation-vault-card.tsx (17) and server-autopilot.tsx (14); verify-first reads before any edit, honest retirement if a surface already speaks. (3) WITNESS DOCTRINE carried: self-healing recovery preamble FIRST (r824/r825 proven); seed every field the assert checks (r824 agentId, r825 novelty on the done run); interactive rows name on the BUTTON, informational rows may name on the listitem (r821 rule); write-back-safe cleanup with the per-round key prefix. (4) THE CARRIED DOM WITNESSES: cortex lane-age caption green-verdict probe (10+ consecutive reds); ladder details disclosure >6-entry boards payload; 401 quickCheck + provider/token notes remain real-event-only. (5) Owner queue carried: CORTEX 401 = Owner-side config (disable Enforce JWT verification for nexus-cortex-harness ONLY, set the edge secrets, the SAME random phrase as CORTEX_SHARED_SECRET into the app Cortex key field, Probe again); KICK widget, PAT rotation, Webshare token, vault re-key BACKUP-FIRST; upload/nexus-provider-vault.json holds LIVE KEYS, never commit (verify at every close). (6) MEM-GUARD read at open (2.9/4.0 GB, available 1.1 GB - if it dips further consider a serverless-only round). (7) Snapshot seventy-eighth next close (number only; watch retired). (8) r707 mechanism-per-round: HELD (the ledger row utterances + the card-grid list are named, live-witnessed user-facing mechanisms; the census recipe is the named evaluation).
Blockers: none app-side; TASK-101/102 stale (absent from TASKS.md - do not chase); the cortex lane stays Owner-side config.


"""


def sh(*args: str) -> str:
    return subprocess.run(args, cwd=PROJ, capture_output=True, text=True).stdout.strip()


def fail(msg: str) -> None:
    print(f"CLOSE-ABORT: {msg}")
    sys.exit(1)


def main() -> None:
    # 1. witness ground truth
    wit = open("/tmp/r825_witness.out", encoding="utf-8").read() if os.path.exists(
        "/tmp/r825_witness.out"
    ) else ""
    if "== r825 WITNESS GREEN ==" not in wit:
        fail("witness log lacks GREEN marker")
    if "store-clean:yes" not in wit:
        fail("witness log lacks store-clean:yes")

    # 2. tsc gate
    tsc = open("/tmp/r825_tsc.log", encoding="utf-8").read() if os.path.exists(
        "/tmp/r825_tsc.log"
    ) else "MISSING"
    if tsc == "MISSING" or tsc.strip() != "":
        fail(f"tsc not clean: {tsc[:200]!r}")

    # 3. lint gate + baseline warning set (trailing newline = grep|sort|md5sum parity)
    lint = open("/tmp/r825_lint.log", encoding="utf-8").read() if os.path.exists(
        "/tmp/r825_lint.log"
    ) else "MISSING"
    if lint == "MISSING":
        fail("lint log missing")
    if "0 errors" not in lint:
        fail(f"lint has errors: {lint[-300:]!r}")
    files = sorted(line for line in lint.splitlines() if line.startswith("/home"))
    md5 = hashlib.md5(("".join(line + "\n" for line in files)).encode()).hexdigest()
    if md5 != LINT_BASELINE_MD5:
        fail(f"lint warning-set md5 drifted: {md5} (baseline {LINT_BASELINE_MD5})")

    # 4. corpus snapshot (number only)
    latest = f"{PROJ}/db/corpus-snapshots/latest.json"
    rows = "?"
    if os.path.exists(latest):
        data = json.load(open(latest, encoding="utf-8"))
        rows = data.get("count", data.get("rows", "?"))
    snaps = sorted(
        p for p in glob.glob(f"{PROJ}/db/corpus-snapshots/*.json") if not p.endswith("latest.json")
    )
    newest = os.path.basename(snaps[-1]) if snaps else "none"

    # 5. vault stays gitignored
    vault = sh("git", "check-ignore", "-v", "upload/nexus-provider-vault.json")
    vault_ok = "yes" if vault else "NO"
    if not vault:
        fail("vault NOT gitignored")

    # 6. append (never overwrite) - .replace, never .format
    entry = entry_tail.replace("__ROWS__", str(rows)).replace("__NEWEST__", newest).replace(
        "__VAULT__", vault_ok
    )
    with open(f"{PROJ}/worklog.md", "a", encoding="utf-8") as fh:
        fh.write(entry)
    print(f"CLOSE-OK rows={rows} newest={newest} vault_gitignored={vault_ok} lint_md5={md5}")


if __name__ == "__main__":
    main()
