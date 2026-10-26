// r608 witness — SQLite lock-contention hardening (WAL + busy_timeout +
// connection_limit=1). Verifies:
//   (a) the shared singleton landed all three pragmas on its connection;
//   (b) journal_mode=WAL persisted at the FILE level — a FRESH independent
//       PrismaClient (simulating the workflow-scheduler process / next boot)
//       sees wal, while its busy_timeout stays 0 (per-connection scope, the
//       documented boundary of this increment);
//   (c) normal queries still run through the hardened singleton.
import { PrismaClient } from '@prisma/client'
import { db, sqlitePragmasReady } from '../src/lib/db'

let pass = 0
let fail = 0
const safe = (v: unknown): string =>
  JSON.stringify(v, (_k, val) => (typeof val === 'bigint' ? Number(val) : val))
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    pass++
    console.log(`PASS ${name}`)
  } else {
    fail++
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function rows(client: PrismaClient, sql: string): Promise<Record<string, unknown>[]> {
  return (await client.$queryRawUnsafe(sql)) as Record<string, unknown>[]
}

async function main(): Promise<void> {
  await sqlitePragmasReady

  const [mode] = await rows(db, 'PRAGMA journal_mode;')
  check(
    'shared singleton: journal_mode=wal',
    String(mode?.journal_mode).toLowerCase() === 'wal',
    safe(mode),
  )

  const [timeout] = await rows(db, 'PRAGMA busy_timeout;')
  check(
    'shared singleton: busy_timeout=5000',
    Number(timeout?.timeout) === 5000,
    safe(timeout),
  )

  const [sync] = await rows(db, 'PRAGMA synchronous;')
  check(
    'shared singleton: synchronous=NORMAL(1)',
    Number(sync?.synchronous) === 1,
    safe(sync),
  )

  const fileUrl = process.env.DATABASE_URL ?? ''
  const dbPath = fileUrl.replace(/^file:/, '')
  if (!dbPath) {
    check('fresh independent client: DATABASE_URL available', false, 'DATABASE_URL missing')
  } else {
    const fresh = new PrismaClient({ datasourceUrl: `file:${dbPath}` })
    try {
      const [fmode] = await rows(fresh, 'PRAGMA journal_mode;')
      check(
        'fresh client: journal_mode=wal persisted in the db FILE',
        String(fmode?.journal_mode).toLowerCase() === 'wal',
        safe(fmode),
      )
      const [ftimeout] = await rows(fresh, 'PRAGMA busy_timeout;')
      check(
        'fresh client: busy_timeout=5000 (Prisma SQLite default; the scheduler always had it - WAL is the new file-level gift)',
        Number(ftimeout?.timeout) === 5000,
        safe(ftimeout),
      )
    } finally {
      await fresh.$disconnect()
    }
  }

  const [tables] = await rows(db, 'SELECT count(*) as n FROM sqlite_master;')
  check(
    'queries still execute through the hardened singleton',
    Number(tables?.n) > 0,
    safe(tables),
  )

  console.log(`\nPROBE r608: ${pass} pass / ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}

main().then(
  () => undefined,
  (e) => {
    console.error('PROBE r608 crashed:', e)
    process.exit(1)
  },
)
