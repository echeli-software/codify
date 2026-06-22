/**
 * Tiny IndexedDB wrapper.  Two object stores back the offline subsystem:
 *
 *   identity   key='current' → CachedIdentity bundle from GET /me + auth
 *   queue      keyPath='clientEventId' → typed QueuedEvent rows
 *
 * Why no idb / dexie: this is ~80 LOC, the API surface is small, and
 * adding a runtime dep for that would dwarf the code. If the queue grows
 * to thousands of rows or we add encryption-at-rest for quiz keys
 * (per /docs/16-offline §9), we can swap in idb without changing callers.
 */

const DB_NAME = 'codify-offline';
const DB_VERSION = 2;
const STORE_IDENTITY = 'identity';
const STORE_QUEUE = 'queue';
/** Per-course download records (keyPath 'courseId'). Phase 8b. */
const STORE_DOWNLOADS = 'downloads';
/** Downloaded lesson content (keyPath 'lessonId', index 'byCourse'). Phase 8b. */
const STORE_DL_LESSONS = 'dl_lessons';
/** Cached avatar + inventory bundle for the offline dressing room (key 'current'). */
const STORE_ASSETS = 'assets';

let openP: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (openP) return openP;
  openP = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_IDENTITY)) {
        db.createObjectStore(STORE_IDENTITY);
      }
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        const store = db.createObjectStore(STORE_QUEUE, {
          keyPath: 'clientEventId',
        });
        store.createIndex('byTimestamp', 'clientTimestamp', { unique: false });
      }
      // v2: download cache (Phase 8b).
      if (!db.objectStoreNames.contains(STORE_DOWNLOADS)) {
        db.createObjectStore(STORE_DOWNLOADS, { keyPath: 'courseId' });
      }
      if (!db.objectStoreNames.contains(STORE_DL_LESSONS)) {
        const ls = db.createObjectStore(STORE_DL_LESSONS, { keyPath: 'lessonId' });
        ls.createIndex('byCourse', 'courseId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_ASSETS)) {
        db.createObjectStore(STORE_ASSETS);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return openP;
}

/**
 * Run a transaction.  `fn` returns either an `IDBRequest` (single-shot
 * get/put/delete) or a `Promise<T>` (cursor-driven aggregations).  The
 * wrapper resolves to whichever the request produced.
 */
async function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const result = fn(store);
    if (result instanceof IDBRequest) {
      result.onsuccess = () => resolve(result.result);
      result.onerror = () => reject(result.error);
    } else {
      result.then(resolve, reject);
    }
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('aborted'));
  });
}

export const idbStores = {
  STORE_IDENTITY,
  STORE_QUEUE,
  STORE_DOWNLOADS,
  STORE_DL_LESSONS,
  STORE_ASSETS,
};

export { openDb, tx };
