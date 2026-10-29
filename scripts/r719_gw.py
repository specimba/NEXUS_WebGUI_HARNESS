#!/usr/bin/env python3
# r719 gates runner + self-witnessing worklog appender (r709 pattern; r716/r718
# fixes carried: escaped-JSON parsing, honest rc, END-MARKER-aware page-error
# split — the r718 parser-recovery lesson).
import subprocess, pathlib, sys, re
ROOT = pathlib.Path("/home/z/my-project")
WL = ROOT / "worklog.md"
wl = WL.read_text(encoding="utf-8")
if "Task ID: r719" in wl:
    print("GUARD: r719 section already present — refusing to double-append"); sys.exit(1)

def run(cmd):
    r = subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True, text=True)
    return (r.stdout + ("\n" + r.stderr if r.stderr.strip() else "")).strip(), r.returncode

def read(p):
    f = ROOT / p
    return f.read_text(encoding="utf-8") if f.exists() else ""

# ---- gates ----
fixture_out, fixture_rc = run("bun scripts/qa-gate-census.ts")
cortex_out, cortex_rc = run("bun scripts/qa-cortex-census.ts")
tsc_out, tsc_rc = run("node_modules/.bin/tsc --noEmit")
lint_out, lint_rc = run("bun run lint")
fx = re.search(r"qa-gate-census: (\d+)/(\d+)", fixture_out)
cx = re.search(r"qa-cortex-census: (\d+)/(\d+)", cortex_out)
lint_line = next((l for l in lint_out.splitlines() if "problems" in l), "(no lint summary line)")
gates_ok = (fixture_rc == 0 and fx and fx.group(1) == fx.group(2) == "48"
            and tsc_rc == 0 and lint_rc == 0
            and cortex_rc == 0 and cx and cx.group(1) == cx.group(2))
gates_txt = (f"── fixture ──\n{fixture_out}\n── cortex fixtures ──\n{cortex_out}\n"
             f"── tsc ──\ntsc_exit={tsc_rc}\n── lint ──\n{lint_line}\n")
(ROOT / "scripts/qa_r719_gates.txt").write_text(gates_txt, encoding="utf-8")
print(gates_txt)
if not gates_ok:
    print("GATES FAILED — worklog NOT appended, chain aborts"); sys.exit(1)

# ---- witnesses (self-witnessing: embed real values) ----
watch = read("scripts/qa_r719_watch.txt")
browser = read("scripts/qa_r719_browser.txt")
qk = re.search(r'quick_check: (.+)', watch)
wm = re.search(r"WATCH: verdict=(\d+) \(PASS (\d+) / FAIL (\d+)\) · uncertain=(\d+) · nojudge=(\d+)", watch)
if not wm:
    print("watch mapping line not found — refusing to append a blind worklog"); sys.exit(1)

census_ok = re.search(r'census\\?":true', browser) is not None
relay_ok = re.search(r'relay\\?":true', browser) is not None
aria = "frontier-aria-clicked" if "frontier-aria-clicked" in browser else "ARIA-MISS"
paste = re.search(r"paste-len:(\d+)", browser)
backup_btn = "backup-btn-clicked" if "backup-btn-clicked" in browser else "backup-btn-MISS"
confirm_dlg = re.search(r'confirmDialog\\?":true', browser) is not None
paste_box = re.search(r'pasteBox\\?":true', browser) is not None
export_btn = "export-btn-clicked" if "export-btn-clicked" in browser else "export-btn-MISS"
empty_toast = re.search(r'emptyToast\\?":true', browser) is not None
dlg_closed = re.search(r'dialogClosed\\?":true', browser) is not None
cron_chip = re.search(r'\n(n/a|\?/\?|\d+/\d+)\n', browser)
cron_chip_val = cron_chip.group(1) if cron_chip else "?"
console_block = browser.split("--- console", 1)[-1].split("--- page errors ---")[0] if "--- console" in browser else ""
err_classes = sorted(set(re.findall(r"\[(?:error)\] ([^\n]{0,90})", console_block)))
page_errors = browser.split("--- page errors ---")[-1].split("=== r719 QA end ===")[0].strip() if "--- page errors ---" in browser else ""

vault_landed = ("window.confirm" not in read("src/components/nexus/settings/automation-vault-card.tsx")
                and "restoreVaultText" in read("src/components/nexus/settings/automation-vault-card.tsx")
                and 'aria-label="Paste a backup JSON to restore"' in read("src/components/nexus/settings/automation-vault-card.tsx"))
cron_landed = '?/?' not in read("src/components/nexus/shell.tsx")
fixnote_landed = 'round: "r719"' in read("src/components/nexus/settings/whats-fixed.tsx")

if err_classes or page_errors:
    print(f"CONSOLE NOT CLEAN — error classes: {err_classes} · page errors: {page_errors} — fix before commit"); sys.exit(1)

verdicts, p_, f_, unc, nj = wm.groups()

section = f"""
---
Task ID: r719
Agent: NEXUS patrol (main agent)
Task: Patrol round 719 (job 473388) — the Owner's third wipe answered where it hurts: the vault backup round trip moved entirely in-app (confirm dialog, copyable plaintext, paste-restore), recovered from a crashed first pass that left tsc red, and the cron chip stopped printing a cryptic '?/?'
Work Log:
- CRASHED-PASS RECOVERY (the round opened on a dirty tree): a prior r719 attempt died mid-flight after landing E1–E6 (in-app backup states + confirm removal) but before E7–E12, leaving tsc red (TS2322: parseBackupText's double-cast ternary defeats Array.isArray narrowing) and the Backup buttons wired to a dialog that did not exist yet. This pass: the parser fixed via a const + Array.isArray narrowing, the r719_edits2.py fixup completed E7–E12 (restore refactor + paste-restore, both dialogs, three-rebuilds ledger truth, cron n/a, FixNote), gates re-run green.
- VERDICT-FLOW WATCH (r715 probe, corrected classifier from r718): verdict {verdicts} (PASS {p_} / FAIL {f_}) · uncertain {unc} · no-judge {nj} — the durable baseline reads honest since the r718 both-families fix.
- VAULT FORENSICS (the Owner's report): the third wipe (Oct 29) is confirmed server-side — AutomationVault 0 rows in the r718/r719 probes — while 17 browser-saved mirror candidates SURVIVE in localStorage; the export failure is now explained in code: window.confirm is silently blocked (returns false) in sandboxed preview iframes, so the export died BEFORE running, and the anchor-click download can be swallowed while the success toast still fires. Both roads moved in-app.
- GOLDEN QA: settings census={census_ok} relay={relay_ok} · radar "{aria}" (r712 stable aria-name) · workflows paste-len:{paste.group(1) if paste else '?'} · vault witnesses: backup-btn {backup_btn} → confirm-dialog {confirm_dlg} + paste-box {paste_box} → export {export_btn} → empty-toast {empty_toast} (the vault IS empty — the honest no-op) + dialog-closed {dlg_closed} · cron chip reads "{cron_chip_val}" · console class verdict: {"clean" if not err_classes else "ERROR CLASSES: " + "; ".join(err_classes)} · page errors: {page_errors or "none"}.
- SHIP: (1) backupVault: confirm → in-app Dialog; plaintext ALWAYS lands in a copyable dialog (download stays best-effort) — the backup travels even when the iframe eats the file; (2) restore gains the paste road: parseBackupText shared by file + paste, one POST mapping (postRestoreSlots) — "Restore from pasted text" needs neither picker nor download; (3) durability ledger truth: twice → three rebuilds (Oct 27, 28 and 29); (4) sidebar cron chip '?/?' → honest 'n/a' while forensics is unreachable (landed={cron_landed}); (5) FixNote r719 (landed={fixnote_landed}). Vault round trip landed={vault_landed}.
- GATES: gate-census {fx.group(1) if fx else '?'}/{fx.group(2) if fx else '?'} · cortex {cx.group(1) if cx else '?'}/{cx.group(2) if cx else '?'} · tsc_exit={tsc_rc} · lint {lint_line}
- BUDGET: ~7 rounds — dirty-tree forensics, type fix + fixup chain, server restart, QA with vault witnesses, gates/worklog/push.
Stage Summary:
- The backup that never arrives is now impossible by construction: the confirm cannot be silently refused, the plaintext always renders, and the restore path accepts the same document back as pasted text. The keys lost to the third wipe stay lost (nothing to restore from — the Owner's next bridge is the 17 browser-saved mirror candidates); the NEXT wipe meets a round trip that works inside the iframe.
Round Handoff:
Round ID: r720 -> next patrol (job 473388)
Next recommended action: (1) DB-HEALTH PROBE standing at open (scripts/r715_watch.js one-command). (2) VERDICT-FLOW WATCH with the corrected-classifier durable baseline: verdict {verdicts} (PASS {p_} / FAIL {f_}) · uncertain {unc} · no-judge {nj} — watch rework→PASS follow-through on the FAIL runs. (3) VAULT REHYDRATION WITNESS (new, Owner-side): when the Owner mirrors any of the 17 browser-saved candidates into the vault, the paste-restore round trip is the witnessed path — Backup → copy dialog → (wipe) → paste-restore. (4) U/NJ CHIP DOM WITNESS attempt #13: the in-browser palette route (r668 precedent); the board renders chips + legend + tonal suffixes now. (5) CORTEX P1 (witnesses): the card reads CORTEX // DIRECT · UPSTASH 1/3 — real-key UPSTASH 3/3 + HB ✓ when the Owner probes; MIRROR-STRIP armed since r707. Owner-side note carried: the Supabase AI session applied the cortex migration to project thgvcrwejojlwcjpsgsu while the verification URL points at vwottesqbdgcsmvvvzok — the mismatch must be resolved before nexus-cortex-harness deploys. (6) VAULT-DRAIN TRIPWIRE (design candidate, unshipped): record vault count+timestamp durably on each mutation so the next wipe leaves a last-seen marker. (7) Owner queue (r693 carry): sibling-sandbox push history + .archive-snapshot-1028/ disposition; per-run ledger read proposal (r683); vault re-key BACKUP-FIRST; KICK widget URL fix (needs Owner's r693 context); optional v29c-f re-download.
Blockers: none. Standing constraint (r707): mechanism or named evaluation every round — held (the export-failure forensics named two silent browser traps and removed both by construction; the crashed-pass recovery is the mechanism's own hardening).
"""
WL.write_text(wl + section, encoding="utf-8")
print("worklog: r719 section appended (Task ID guard passed, gates green, console clean)")
