"use client";

// ─── r507: Storage tiers — the browser-native durability layer ───────────────
// Owner ask (r507): the storage warning kept appearing, some steps came back
// thin, and the question on the table was "move to Supabase + Redis, or is
// there a web-browser-style solution?" The researched answer (see the Storage
// Doctor card for the owner-facing verdict):
//
//   Tier 0  localStorage   ~5MB per origin — the HOT index (UI truth source)
//   Tier 1  IndexedDB      ~hundreds of MB (share of disk) — the WARM bulk
//   Tier 2  SQLite server  the durable tier behind /api/runs/archive (r455)
//   Tier 3  Supabase       OPTIONAL BYO cloud mirror (backup, not primary —
//                          free projects pause after 1 week of inactivity)
//
// Redis was evaluated and REJECTED for this app: it is a cache/queue for
// multi-node fan-out, holds no durability win over Tier 2, and adds a third
// external credential. The Doctor card says so explicitly.
//
// This module is the Tier 1 primitive set: a dependency-free IndexedDB
// wrapper (no idb npm dep — ~120 lines), the durable-storage permission
// request, and the quota estimate. Every call is SSR-safe and failure-safe:
// IndexedDB can be blocked (private mode, disabled storage) and then every
// helper degrades to "unavailable" — Tier 0 and Tier 2 keep the app running.

const DB_NAME = "nexus-idb";
const DB_VERSION = 1;
export const RUN_ARCHIVE_IDB_STORE = "run-archive";

/** Human label + one-line verdict per tier — the Doctor card renders these. */
export const STORAGE_TIER_NOTES = {
  hot: "localStorage (~5 MB per site) — the live index. Recent runs keep full output; older history trims automatically.",
  warm: "IndexedDB (share of your disk, typically hundreds of MB) — every settled run is mirrored here in full, including the copies the hot tier sheds.",
  durable: "SQLite on the local server (durable) — the archive API tier. Survives browser clears; agents read it via /api/runs/archive.",
  cloud: "Supabase (optional, BYO) — an off-site mirror for cross-device access. Free projects pause after 1 week idle, so it is treated as backup, never as the primary.",
  rejected: "Redis — evaluated and declined: it is a cache/queue for multi-node fan-out, not durable storage, and the local SQLite tier already covers its role without a third credential.",
} as const;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(RUN_ARCHIVE_IDB_STORE)) {
          db.createObjectStore(RUN_ARCHIVE_IDB_STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onclose = () => {
          dbPromise = null; // allow a clean reopen next call
        };
        resolve(db);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx(db: IDBDatabase, store: string, mode: IDBTransactionMode): IDBObjectStore | null {
  try {
    return db.transaction(store, mode).objectStore(store);
  } catch {
    return null;
  }
}

/** Wrap an IDBRequest into a promise that never rejects (resolves fallback).
 * Takes `unknown` as the request's result type — IDBRequest<T> is invariant
 * in T (its event handlers carry `this` typing), so call sites widen with a
 * single cast instead of fighting variance. */
function toPromise<T>(req: IDBRequest<unknown> | null, fallback: T, timeoutMs = 4000): Promise<T> {
  if (!req) return Promise.resolve(fallback);
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    req.onsuccess = () => {
      clearTimeout(timer);
      resolve(req.result as T);
    };
    req.onerror = () => {
      clearTimeout(timer);
      resolve(fallback);
    };
  });
}

export function idbAvailable(): boolean {
  try {
    return typeof window !== "undefined" && "indexedDB" in window;
  } catch {
    return false;
  }
}

// ─── run-archive store helpers (value = RunArchiveEntry, keyed by id) ───────

export async function idbPutRun(entry: unknown): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  const store = tx(db, RUN_ARCHIVE_IDB_STORE, "readwrite");
  if (!store) return false;
  const req = store.put(entry as never) as unknown as IDBRequest<unknown>;
  return toPromise(req, null).then((v) => v != null);
}

export async function idbGetRun<T>(id: string): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  const store = tx(db, RUN_ARCHIVE_IDB_STORE, "readonly");
  if (!store) return null;
  return toPromise<T | null>(store.get(id) as unknown as IDBRequest<unknown>, null);
}

export async function idbDeleteRun(id: string): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  const store = tx(db, RUN_ARCHIVE_IDB_STORE, "readwrite");
  if (!store) return false;
  const req = store.delete(id) as unknown as IDBRequest<unknown>;
  return toPromise(req, null).then((v) => v != null);
}

export async function idbClearRuns(): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  const store = tx(db, RUN_ARCHIVE_IDB_STORE, "readwrite");
  if (!store) return false;
  const req = store.clear() as unknown as IDBRequest<unknown>;
  return toPromise(req, undefined).then(() => true);
}

/** All archived entries in the warm tier, newest-first by finishedAt. */
export async function idbListRuns<T>(): Promise<T[]> {
  const db = await openDb();
  if (!db) return [];
  const store = tx(db, RUN_ARCHIVE_IDB_STORE, "readonly");
  if (!store) return [];
  const all = await toPromise<T[]>(store.getAll() as unknown as IDBRequest<unknown>, []);
  if (!Array.isArray(all)) return [];
  return all
    .filter((e) => !!e && typeof e === "object")
    .sort((a, b) =>
      String((b as { finishedAt?: string }).finishedAt ?? "").localeCompare(
        String((a as { finishedAt?: string }).finishedAt ?? "")
      )
    );
}

export async function idbCountRuns(): Promise<number> {
  const db = await openDb();
  if (!db) return 0;
  const store = tx(db, RUN_ARCHIVE_IDB_STORE, "readonly");
  if (!store) return 0;
  return toPromise<number>(store.count() as unknown as IDBRequest<unknown>, 0);
}

// ─── quota + durability (StorageManager) ─────────────────────────────────────

export interface StorageEstimateInfo {
  supported: boolean;
  usageBytes: number;
  quotaBytes: number;
  persisted: boolean | null;
}

/** navigator.storage estimate + persist state, all optional-guarded. */
export async function storageEstimate(): Promise<StorageEstimateInfo> {
  const unsupported: StorageEstimateInfo = {
    supported: false,
    usageBytes: 0,
    quotaBytes: 0,
    persisted: null,
  };
  try {
    if (typeof navigator === "undefined" || !navigator.storage) return unsupported;
    const [est, persisted] = await Promise.all([
      navigator.storage.estimate?.() ?? Promise.resolve(null),
      navigator.storage.persisted?.() ?? Promise.resolve(null),
    ]);
    return {
      supported: true,
      usageBytes: Math.max(0, Math.round(est?.usage ?? 0)),
      quotaBytes: Math.max(0, Math.round(est?.quota ?? 0)),
      persisted: typeof persisted === "boolean" ? persisted : null,
    };
  } catch {
    return unsupported;
  }
}

/** Ask the browser to mark this origin's storage as persistent (eviction
 * resistance). Resolves true when granted; false when denied/unsupported. */
export async function requestDurableStorage(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
