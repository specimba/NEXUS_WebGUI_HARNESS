#!/usr/bin/env python3
"""r639 salvage probe: read-only census on the BACKUP copy (mode=ro avoids recovery-on-open).
Also probes rowid-range reads on corrupt tables to estimate salvageability."""
import sqlite3, glob, os

BK = [f for f in sorted(glob.glob("/home/z/my-project/db/backups/custom.db.corrupt-*"))
      if not f.endswith(("-wal", "-shm"))][-1]
print("PROBE TARGET:", BK)

# read-only open: never mutates, skips WAL recovery attempts
con = sqlite3.connect(f"file:{BK}?mode=ro", uri=True)
try:
    rows = con.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()
    print("SCHEMA OK via ro:", len(rows), "tables")
    tables = [r[0] for r in rows]
except sqlite3.DatabaseError as e:
    print("SCHEMA FAIL even ro:", e)
    tables = []
finally:
    con.close()

for t in tables:
    c = sqlite3.connect(f"file:{BK}?mode=ro", uri=True)
    try:
        n = c.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
        print(f"  OK      {t}: {n}")
    except sqlite3.DatabaseError:
        # try rowid-range salvage estimate
        salvaged = 0
        gap = 0
        max_id = 0
        try:
            max_id = c.execute(f'SELECT MAX(rowid) FROM "{t}"').fetchone()[0] or 0
        except sqlite3.DatabaseError:
            pass
        for lo in range(0, max_id + 1, 50):
            try:
                salvaged += len(c.execute(f'SELECT rowid FROM "{t}" WHERE rowid>{lo} AND rowid<={lo+50}').fetchall())
            except sqlite3.DatabaseError:
                gap += 1
        print(f"  PARTIAL {t}: max_rowid={max_id} salvageable~{salvaged} bad_ranges={gap}")
    finally:
        c.close()
