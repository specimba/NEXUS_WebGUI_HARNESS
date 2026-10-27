#!/usr/bin/env python3
"""r639 DB forensics v2: backup-first, then per-table census on live DB.
Maps which tables are readable vs corrupt (esp. vault = Owner's encrypted key)."""
import sqlite3, os, shutil, datetime

DB = "/home/z/my-project/db/custom.db"
TS = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
BKDIR = "/home/z/my-project/db/backups"
os.makedirs(BKDIR, exist_ok=True)
BK = os.path.join(BKDIR, f"custom.db.corrupt-{TS}")

# STEP A: backup everything first (never touch live without a copy)
shutil.copy2(DB, BK)
for ext in ("-wal", "-shm"):
    if os.path.exists(DB + ext):
        shutil.copy2(DB + ext, BK + ext)
print(f"BACKUP: {BK} (+wal/shm)")

# STEP B: schema readability
con = sqlite3.connect(DB)
try:
    rows = con.execute("SELECT name, type FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()
    print(f"SCHEMA: {len(rows)} tables listed")
    print("  tables:", ", ".join(r[0] for r in rows))
except sqlite3.DatabaseError as e:
    print("SCHEMA READ FAIL:", e)
    rows = []
    con.close()
    sys_exit = True
else:
    con.close()

# STEP C: per-table census (each table isolated — one corrupt page must not hide the rest)
if rows:
    print("CENSUS (per-table, isolated connections):")
    for (t,) in [(r[0],) for r in rows]:
        c = sqlite3.connect(DB)
        try:
            n = c.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
            print(f"  OK    {t}: {n} rows")
        except sqlite3.DatabaseError as e:
            print(f"  CORRUPT {t}: {e}")
        finally:
            c.close()
