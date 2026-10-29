#!/usr/bin/env bash
# r745 recovery: seed runtime tables (AutomationWorkflow) post-recycle, verify, QA.
# Every external step is timeout-wrapped — no hangs (R10 timeout lesson).
set -u
cd /home/z/my-project
echo '--- worklog seed precedent ---'
grep -n "seed" worklog.md | tail -4 || true
echo '--- seeder heads ---'
head -8 scripts/seedwrite.ts || true
echo '--- attempt 1: seedwrite.ts ---'
timeout 90 bun scripts/seedwrite.ts 2>&1 | tail -3 || echo 'seedwrite-FAILED-OR-TIMEOUT'
WF=$(python3 -c "import sqlite3;c=sqlite3.connect('file:/home/z/my-project/db/custom.db?mode=ro',uri=True);print(c.execute('select count(*) from AutomationWorkflow').fetchone()[0])")
echo "wf_after_1:$WF"
if [ "$WF" = "0" ]; then
  echo '--- attempt 2: qa-server-run-seed.ts ---'
  timeout 90 bun scripts/qa-server-run-seed.ts 2>&1 | tail -3 || echo 'server-run-seed-FAILED-OR-TIMEOUT'
  WF=$(python3 -c "import sqlite3;c=sqlite3.connect('file:/home/z/my-project/db/custom.db?mode=ro',uri=True);print(c.execute('select count(*) from AutomationWorkflow').fetchone()[0])")
  echo "wf_after_2:$WF"
fi
echo '--- final table state ---'
python3 -c "
import sqlite3,json
c=sqlite3.connect('file:/home/z/my-project/db/custom.db?mode=ro',uri=True)
print(json.dumps({'eval':c.execute('select count(*) from EvalEvent').fetchone()[0],'wf':c.execute('select count(*) from AutomationWorkflow').fetchone()[0],'runs':c.execute('select count(*) from AutomationRun').fetchone()[0]}))"
echo '--- page check ---'
curl -s -o /dev/null -w 'page:%{http_code}\n' "http://localhost:3000/?r=745rec2#workflows" || true
echo '--- golden QA ---'
bash scripts/r745_qa.sh
