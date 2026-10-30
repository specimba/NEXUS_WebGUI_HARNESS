#!/usr/bin/env python3
"""r770 post-close watch addendum: wave 11 landed MID-ROUND (the pre-declared
reset case). Records which outcome fired, with live census reads - appended
at the end of the r770 worklog section (corrections go FORWARD)."""

import json
import sqlite3
import time

ROOT = "/home/z/my-project"
con = sqlite3.connect("file:%s/db/custom.db?mode=ro" % ROOT, uri=True)
cur = con.cursor()
nj = cur.execute("select count(*) from EvalEvent where kind='gate-no-judge'").fetchone()[0]
vd = cur.execute("select count(*) from EvalEvent where kind='gate-verdict'").fetchone()[0]
un = cur.execute("select count(*) from EvalEvent where kind='gate-uncertain'").fetchone()[0]
runs = cur.execute("select count(distinct runId) from EvalEvent").fetchone()[0]
newest = cur.execute("select max(createdAt) from EvalEvent where kind='gate-no-judge'").fetchone()[0]
con.close()
utc = time.strftime("%H:%M:%S", time.gmtime(newest / 1000))
quiet_now = (int(time.time() * 1000) - newest) // 60000
cen = json.dumps({"total": nj + vd + un, "runs": runs, "verdict": vd, "uncertain": un, "nj": nj})

addendum = (
    "- Post-close watch addendum (r770): WAVE 11 LANDED MID-ROUND - the pre-declared reset case of the "
    "burst-end watch fired: close census " + cen + " (" + str(nj) + " nj, +3 vs the open 97; newest ~" + utc
    + " UTC), the 04:00 bucket is a FIFTH straight q (q-lean x5 - the cement DEEPENS), the interval readout "
    "shows +70m since prior (03:03 -> 04:0x, a NEW band max extending 13-42-62-57-61 to -71), and the quiet "
    "meter RESET to +3m quiet with the amber cleared before the close probe (quietAmber:false, witnessed by "
    "the extended tier-state probe - the reset IS the watch working). Two lane-watch items carried to r771 "
    "(amber-tone doctrine: pattern changes to investigate, not faults): mid-qwen dropped to ACTIVE (1/2) at "
    "the 04:00 bucket (one qwen lane silent), and divergence badges jumped 2 -> 6 (lane last-3-bucket lags - "
    "re-read which lanes before interpreting). Quiet at addendum time: ~" + str(quiet_now) + "m."
)
with open(ROOT + "/worklog.md", "a", encoding="utf-8") as f:
    f.write("\n" + addendum + "\n")
print("addendum appended; census:", cen, "| newest UTC:", utc, "| quiet now:", quiet_now, "m")
