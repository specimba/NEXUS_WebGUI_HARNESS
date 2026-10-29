#!/usr/bin/env python3
# r745 durability increment: snapshot the EvalEvent corpus to db/corpus-snapshots/
# so the next sandbox recycle restores to the LAST CLOSE, not a stale snapshotter.
# Same JSON shape the proven corpus-restore.ts reads: {takenAt, count, rows}.
import sqlite3, json, datetime
c = sqlite3.connect('file:/home/z/my-project/db/custom.db?mode=ro', uri=True)
c.row_factory = sqlite3.Row
rows = [dict(r) for r in c.execute('select * from EvalEvent order by createdAt, id')]
ts = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H-%M-%S')
snap = {'takenAt': ts, 'count': len(rows), 'rows': rows}
with open('db/corpus-snapshots/corpus-' + ts + '.json', 'w') as f:
    json.dump(snap, f)
with open('db/corpus-snapshots/latest.json', 'w') as f:
    json.dump(snap, f)
print('snapshotted', len(rows), 'rows at', ts)
