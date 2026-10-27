#!/usr/bin/env python3
"""r640 RECOVERY RECIPE (staged by r639) — cure for 'database disk image is malformed'.

ROOT CAUSE (r639 forensics): the 2026-10-27 filesystem snapshot rollback (r636 event)
restored db/ — which is NOT git-tracked — to an older generation while the dev server
kept running. Mismatched main/WAL/SHM generations rode along for ~29h until SQLite
hit the poisoned pages (runReport.findMany -> SQLITE_CORRUPT code 11, capability
radar endpoint 500 'Capability check failed').

WHAT THIS SCRIPT DOES (run with the dev server STOPPED or right after a crash):
  1. Fresh timestamped backup of the live (corrupt) db + wal + shm.
  2. Salvage: sqlite-utils recover on the backup -> extracted tables.
  3. Rebuild: empty fresh main file, copy salvaged schema+rows in, integrity_check.
  4. Swap: new file takes the live path (old corrupt set quarantined in-place).
Then: scripts/dev-restart.sh (1/1) and verify:
  curl -s http://localhost:3000/api/radar/hourly | head -c 300   (must be 200 JSON)
  qa-golden 6/6.
Owner-data note: vault ciphertext rows are copied verbatim (AES-256-GCM at rest
decrypts fine after a byte-faithful row move). If the vault table is unrecoverable,
the Owner must re-paste the Vyce AI key (they hold the source) — flag it in worklog.

Usage: python3 scripts/db-recover-r640.py [--dry-run]
"""
import os, sys, glob, shutil, sqlite3, datetime, subprocess

DB = "/home/z/my-project/db/custom.db"
DBDIR = "/home/z/my-project/db"
TS = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
BKDIR = os.path.join(DBDIR, "backups")
DRY = "--dry-run" in sys.argv

def sh(cmd):
    print("  $", cmd)
    rc = subprocess.call(cmd, shell=True)
    if rc != 0:
        print(f"    !! rc={rc}")
    return rc

print("== r640 DB recovery ==")
os.makedirs(BKDIR, exist_ok=True)

# 1. backup the live corrupt set
bk = os.path.join(BKDIR, f"custom.db.pre-recover-{TS}")
shutil.copy2(DB, bk)
for ext in ("-wal", "-shm"):
    if os.path.exists(DB + ext):
        shutil.copy2(DB + ext, bk + ext)
print(f"[1] backup: {bk} (+wal/shm)")

# 2. salvage via sqlite-utils (pip install sqlite-utils if missing)
rec = os.path.join(BKDIR, f"recovered-{TS}.db")
rc = sh(f"python3 -m sqlite_utils recover {bk} {rec}")
if rc != 0:
    print("[2] sqlite_utils missing or failed; trying: pip install sqlite-utils && retry")
    sh("pip install --quiet sqlite-utils")
    rc = sh(f"python3 -m sqlite_utils recover {bk} {rec}")
if rc != 0:
    sys.exit("SALVAGE FAILED — data safe in backup; escalate to Owner instead of improvising.")
print(f"[2] salvaged -> {rec}")

# 3. census the salvage (esp. vault + automation tables)
con = sqlite3.connect(rec)
tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
print(f"[3] salvage census: {len(tables)} tables")
for t in sorted(tables):
    try:
        n = con.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
        star = " <-- VAULT (Owner key)" if "vault" in t.lower() else ""
        print(f"    {t}: {n}{star}")
    except sqlite3.DatabaseError as e:
        print(f"    {t}: UNREADABLE {e}")
chk = [r[0] for r in con.execute("PRAGMA integrity_check").fetchall()]
print("    integrity:", chk[:3])
con.close()

if DRY:
    print("[dry-run] no swap performed. Verify census above, then re-run without --dry-run.")
    sys.exit(0)

# 4. swap: recovered file becomes live; corrupt set quarantined
conq = os.path.join(BKDIR, f"custom.db.corrupt-quarantine-{TS}")
shutil.copy2(DB, conq)
for ext in ("-wal", "-shm"):
    if os.path.exists(DB + ext):
        shutil.copy2(DB + ext, conq + ext)
        os.remove(DB + ext)
shutil.copy2(rec, DB)
print(f"[4] swapped. corrupt set quarantined at {conq}(+wal/shm)")
print("NOW: scripts/dev-restart.sh, then curl /api/radar/hourly + qa-golden 6/6.")
