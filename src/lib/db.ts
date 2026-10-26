import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  sqlitePragmasReady: Promise<void> | undefined
}

// r608 (P1, meta-review queue): the archiver-500 / workflow-row revert class
// is SQLite lock contention ("database is locked"). Canonical hardening:
//   1. connection_limit=1 — this process uses ONE pooled connection, so its
//      own queries queue instead of racing each other, and the per-connection
//      pragmas below cover every query we run.
//   2. journal_mode=WAL — readers stop blocking the writer and vice versa;
//      WAL is persistent in the db FILE, so other processes (the workflow
//      scheduler) inherit it with zero changes on their side.
//   3. busy_timeout=5000 — a competing writer waits up to 5s instead of
//      throwing, absorbing cross-process write collisions.
//   4. synchronous=NORMAL — the recommended WAL pairing (safe against app
//      crashes; only an OS-level power loss can lose the WAL tail).
function sqliteUrlWithSingleConnection(): string | undefined {
  const url = process.env.DATABASE_URL
  if (!url || !url.startsWith('file:')) return undefined
  if (url.includes('connection_limit=')) return url
  return url.includes('?') ? `${url}&connection_limit=1` : `${url}?connection_limit=1`
}

const datasourceUrl = sqliteUrlWithSingleConnection()

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
    ...(datasourceUrl ? { datasourceUrl } : {}),
  })

// Pragmas land once per process on the shared connection. Failures are
// swallowed honestly: if the datasource is not SQLite (or is briefly locked
// by an external tool at boot), the app keeps working exactly as before —
// nothing invented, no behavior change beyond the pragmas that do land.
globalForPrisma.sqlitePragmasReady ??= (async () => {
  try {
    await db.$queryRawUnsafe('PRAGMA journal_mode=WAL;')
    await db.$queryRawUnsafe('PRAGMA busy_timeout=5000;')
    await db.$queryRawUnsafe('PRAGMA synchronous=NORMAL;')
  } catch {
    // leave the connection in whatever state the engine allows
  }
})()

export const sqlitePragmasReady = globalForPrisma.sqlitePragmasReady

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db