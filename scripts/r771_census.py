#!/usr/bin/env python3
"""r771 open census: wave counts, newest rows, run-table route letters (ro-mode)."""
import sqlite3, json

db = sqlite3.connect("file:/home/z/my-project/db/custom.db?mode=ro", uri=True)
cur = db.cursor()

kinds = dict(cur.execute(
    "SELECT kind, COUNT(*) FROM EvalEvent WHERE kind LIKE 'gate-%' GROUP BY kind"
).fetchall())
total = sum(kinds.values())
runs = cur.execute(
    "SELECT COUNT(DISTINCT runId) FROM EvalEvent WHERE kind LIKE 'gate-%'"
).fetchone()[0]
newest_per_kind = cur.execute(
    "SELECT kind, MAX(createdAt) FROM EvalEvent WHERE kind LIKE 'gate-%' GROUP BY kind"
).fetchall()
overall = cur.execute(
    "SELECT kind, createdAt FROM EvalEvent WHERE kind LIKE 'gate-%' ORDER BY createdAt DESC LIMIT 3"
).fetchall()
print("kinds:", json.dumps(kinds))
print("total:", total, "runs:", runs)
print("newest_per_kind:", newest_per_kind)
print("newest3:", overall)

tables = [r[0] for r in cur.execute(
    "SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
run_tables = [t for t in tables if "run" in t.lower() or "eval" in t.lower()]
print("candidate tables:", run_tables)
for t in run_tables:
    cols = [r[1] for r in cur.execute(f"PRAGMA table_info({t})").fetchall()]
    print(f"--- {t} cols:", cols)
    route_cols = [c for c in cols if any(k in c.lower() for k in ("route", "model", "provider"))]
    if "createdAt" in cols and route_cols:
        sel = ", ".join(["createdAt", "runId"] if "runId" in cols else ["createdAt"]) 
        sel += ", " + ", ".join(route_cols)
        rows = cur.execute(
            f"SELECT {sel} FROM {t} ORDER BY createdAt DESC LIMIT 12").fetchall()
        for r in rows:
            print("   ", r)
db.close()
