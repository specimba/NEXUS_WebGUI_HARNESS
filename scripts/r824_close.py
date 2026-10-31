#!/usr/bin/env python3
# r824 close: verify the round's ground truth (witness green + store-clean,
# tsc 0, lint 0 errors with the baseline warning set), record the corpus
# snapshot number-only (watch retired per r821), verify the vault stays
# gitignored, and ONLY THEN append the round handoff to worklog.md (never
# overwrite). Any failed check aborts before the append.
import glob
import hashlib
import json
import os
import subprocess
import sys

PROJ = "/home/z/my-project"
LINT_BASELINE_MD5 = "c965c8e8961745824f858ce1f12b475a"

entry_tail = """Task ID: r824 (03:37 slot; HEAD opened at 30d2d1698 the r823 close, tree clean, origin AND fork 0 ahead at open; server SURVIVED a sixteenth time - 200 at open, no restart spent; mem 2.6/4.0 GB at open)
Agent: NEXUS patrol (main agent - job 473388)
Task: Patrol round 824 - THE SIDEBAR ROWS SPEAK (the handoff's conversation-list candidate; the other named candidate LaneRideTally was honestly retired at survey: it is a single self-describing paragraph (<p data-testid="lane-ride-tally">) with no list and no interactive rows - nothing to speak that it does not already say): the conversation sidebar's rows were BARE FRAGMENTS to a screen reader - divs and buttons with no list semantics anywhere (no grouping, no count, no unit), the row's accessible name was title + time + count concatenated with no story, the lane chip (server-relay / browser-direct) was aria-hidden with a VISUAL-ONLY tooltip, and the pin was an icon-level aria-label. Now every date-bucket group is a labeled list ("Today - 2 chats"), every row is a listitem, and the row's open-button utters the WHOLE story in one sentence ("{{title}}, with {{agent}} - {{relTime}}, {{n}} message(s)[, pinned][, last reply via server relay / browser-direct (key stayed local)]") on the BUTTON per the r822 interactive-row rule (the listitem groups, the button names); the inner pin icon is aria-hidden so the pinned state has ONE source of truth; styling polish: keyboard focus now tints the row exactly like hover does (has-[button:focus-visible]:bg-accent/60) and the kebab options button reveals on focus-visible like on hover.
Work Log:
- R1 open + probe (HEAD 30d2d1698, server 200 - sixteenth survival, no restart; mem 2.6/4.0 GB); r823 handoff verified as the last section; this slot ran as r824 against it.
- R2 candidates surveyed BEFORE any edit: LaneRideTally = honest no-gap (single self-describing paragraph, already speaks "N of M adopted lanes ride the chain - cap X"); conversation-list sidebar rows = real gap (see Task). r824_qa.sh derived via the new inject recipe (scripts/r824_inject.py: rename r823->r824 + 0 stale verified + the handoff's suggested SEARCH GUARD LEG added to the golden).
- R3 FULL GOLDEN QA GREEN on first derive (console 0 errors, page errors none) INCLUDING the new leg on its first run: palette -> "Search all chats" -> real-keyboard 2-char query -> dialogOpen:true options:3 - the r823 crash class is now guarded in every future golden.
- R4 the increment wired: labeled group lists + listitem rows + the one-utterance open-button + aria-hidden pin + focus/hover parity polish.
- R5 witness v1 GUARDed honestly and its own data named the cause: the utterance rendered PERFECTLY first try ("r824 witness conv - just now, 1 message, last reply via server relay"; list:true, "Today - 2 chats", 4/4 buttons labeled) but the assert demanded the ", with WitnessWorker" clause while the seeded conv had NO agentId (the clause correctly did not render - assert bug, not app bug). Recovery per the mid-dance doctrine: sessionStorage true-priors restored manually, store-clean verified BEFORE the re-run (a blind re-run would have saved the SEEDED stores as priors - the r822 pollution-chain trap); the witness script then gained a self-healing recovery preamble.
- R6 witness v2 GREEN (seed gains agentId:'a-wit'): the full utterance "r824 witness conv, with WitnessWorker - just now, 1 message, last reply via server relay" asserted live through the #/chat/conv-r824-witness deep link; both stores (nexus-agents + nexus-conversations) restored and verified clean through the write-back-safe dance.
- R7 GATES unmasked: tsc=0, lint=0 errors (28 warnings, per-file set md5 identical to baseline); snapshot SEVENTY-SIXTH: latest.json rows={rows} (newest timestamped: {newest} - number only, watch retired); vault-gitignored:{vault_ok}.
GATES: tsc_exit=0 - lint_exit=0 (0 errors, 28 warnings, set md5 identical) - WITNESS_EXIT=0 (three assertions: list semantics + group label + full utterance, live DOM, store-clean:yes both stores) - QA_EXIT=0 (FULL GOLDEN + search-guard leg, first derive)
Stage Summary: the conversation sidebar now speaks its groups and every row tells its whole story (agent, recency, size, pin, lane) in one utterance on the button; the golden QA carries the search-crash guard forever; LaneRideTally honestly retired as already-spoken; the witness's assert-vs-seed mismatch became another mid-dance recovery drill (preamble now self-heals).
Round Handoff:
Round ID: r825 -> next patrol (job 473388)
Next recommended action: (1) golden QA: scripts/r824_qa.sh is the proven template (copy + rename r824->r825; bump ?r=824 -> ?r=825 alongside the plain rename) - it now carries the SEARCH GUARD LEG (palette -> Search all chats -> 2-char real-keyboard query -> dialogOpen:true) - keep it in every future derive. (2) Increment candidates: QA-found bugs first; else the spoken-surface arc's NAMED candidates are all landed or honestly retired (relay lists r815-817, run rows r818-819, fleet header r820, usage board r821, tool strip r822, search dialog r823, sidebar rows r824; LaneRideTally retired as already-spoken) - next round should run a fresh VERIFY-FIRST CENSUS: sweep the src tree for unlabeled lists / interactive rows (role="list" gaps, bare .map( renders of buttons without aria-label) and let the biggest honest gap name the increment. (3) WITNESS DOCTRINE carried + re-proven: mid-dance GUARD => manual true-priors restore + verify CLEAN before any re-run (the r824 witness now self-heals via preamble); interactive rows name on the BUTTON; CONSOLE-FIRST on missing DOM; the #/chat/<id> deep link needs NO UI clicks; seed the CONV's agentId too when the assert checks the ", with {{agent}}" clause. (4) THE CARRIED DOM WITNESSES: cortex lane-age caption green-verdict probe (10 consecutive reds); ladder details disclosure >6-entry boards payload; 401 quickCheck + provider/token notes remain real-event-only. (5) Owner queue carried: CORTEX 401 = Owner-side config (disable Enforce JWT verification for nexus-cortex-harness ONLY, set the edge secrets, the SAME random phrase as CORTEX_SHARED_SECRET into the app Cortex key field, Probe again); KICK widget, PAT rotation, Webshare token, vault re-key BACKUP-FIRST; upload/nexus-provider-vault.json holds LIVE KEYS, never commit (verify at every close). (6) MEM-GUARD read at open. (7) Snapshot seventy-seventh next close (number only; watch retired). (8) r707 mechanism-per-round: HELD (the sidebar utterances + the golden's search guard are named, live-witnessed user-facing mechanisms; the LaneRideTally honest retirement and the mid-dance recovery drill are the named evaluations).
Blockers: none app-side; TASK-101/102 stale (absent from TASKS.md - do not chase); the cortex lane stays Owner-side config.


"""


def sh(*args: str) -> str:
    return subprocess.run(args, cwd=PROJ, capture_output=True, text=True).stdout.strip()


def fail(msg: str) -> None:
    print(f"CLOSE-ABORT: {msg}")
    sys.exit(1)


def main() -> None:
    # 1. witness ground truth
    wit = open("/tmp/r824_witness.out", encoding="utf-8").read() if os.path.exists(
        "/tmp/r824_witness.out"
    ) else ""
    if "== r824 WITNESS GREEN ==" not in wit:
        fail("witness log lacks GREEN marker")
    if "store-clean:yes" not in wit:
        fail("witness log lacks store-clean:yes")

    # 2. tsc gate
    tsc = open("/tmp/r824_tsc.log", encoding="utf-8").read() if os.path.exists(
        "/tmp/r824_tsc.log"
    ) else "MISSING"
    if tsc == "MISSING" or tsc.strip() != "":
        fail(f"tsc not clean: {tsc[:200]!r}")

    # 3. lint gate + baseline warning set
    lint = open("/tmp/r824_lint.log", encoding="utf-8").read() if os.path.exists(
        "/tmp/r824_lint.log"
    ) else "MISSING"
    if lint == "MISSING":
        fail("lint log missing")
    if "0 errors" not in lint:
        fail(f"lint has errors: {lint[-300:]!r}")
    files = sorted(line for line in lint.splitlines() if line.startswith("/home"))
    md5 = hashlib.md5(("\n".join(files) + "\n").encode()).hexdigest()
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

    # 6. append (never overwrite)
    entry = entry_tail.format(rows=rows, newest=newest, vault_ok=vault_ok)
    with open(f"{PROJ}/worklog.md", "a", encoding="utf-8") as fh:
        fh.write(entry)
    print(f"CLOSE-OK rows={rows} newest={newest} vault_gitignored={vault_ok} lint_md5={md5}")


if __name__ == "__main__":
    main()
