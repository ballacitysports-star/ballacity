/**
 * Keeps the original of an image you just uploaded on THIS device, so its crop
 * can be adjusted later without hunting for the file again.
 *
 * Only the cropped result is uploaded. The original stays in this browser's
 * IndexedDB and never reaches the server, because a crop is often used to cut
 * something out (a person, a background) and a stored original, even a hidden
 * one, would undo that. It is keyed by the signed-in user and the uploaded
 * URL, and trimmed to a few recent files.
 */
export type StoredOriginal = { key: string; blob: Blob; name: string; savedAt: number };

export interface OriginalStore {
  get(key: string): Promise<StoredOriginal | undefined>;
  put(item: StoredOriginal): Promise<void>;
  delete(key: string): Promise<void>;
  all(): Promise<StoredOriginal[]>;
}

/** Largest original worth keeping; bigger ones are skipped, not failed. */
export const MAX_ORIGINAL_BYTES = 15 * 1024 * 1024;
export const MAX_ENTRIES = 30;
export const MAX_TOTAL_BYTES = 60 * 1024 * 1024;

export function originalKey(ownerId: string, url: string): string {
  return `${ownerId}|${url}`;
}

export function createOriginalCache(store: OriginalStore, now: () => number = Date.now) {
  return {
    /** Save `file` under `key`, then drop the oldest entries past the limits. */
    async save(key: string, file: File): Promise<boolean> {
      if (!key || file.size === 0 || file.size > MAX_ORIGINAL_BYTES) return false;
      try {
        await store.put({ key, blob: file, name: file.name || "original", savedAt: now() });
        const items = (await store.all()).sort((a, b) => b.savedAt - a.savedAt);
        let total = 0;
        for (const [i, item] of items.entries()) {
          total += item.blob.size;
          if (i >= MAX_ENTRIES || total > MAX_TOTAL_BYTES) {
            // Never evict what was just saved.
            if (item.key !== key) await store.delete(item.key);
          }
        }
        return true;
      } catch {
        return false;
      }
    },

    async has(key: string): Promise<boolean> {
      try {
        return !!(await store.get(key));
      } catch {
        return false;
      }
    },

    /** The saved original as a File ready for the editor, or null. */
    async load(key: string): Promise<File | null> {
      try {
        const item = await store.get(key);
        if (!item) return null;
        return new File([item.blob], item.name, { type: item.blob.type || "image/jpeg" });
      } catch {
        return null;
      }
    },
  };
}

const DB_NAME = "ballacity-originals";
const STORE_NAME = "originals";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore(STORE_NAME, { keyPath: "key" });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

function indexedDbStore(): OriginalStore {
  let db: Promise<IDBDatabase> | null = null;
  const store = async (mode: IDBTransactionMode) => {
    db ??= openDb();
    return (await db).transaction(STORE_NAME, mode).objectStore(STORE_NAME);
  };
  return {
    get: async (key) =>
      request((await store("readonly")).get(key)) as Promise<StoredOriginal | undefined>,
    put: async (item) => void (await request((await store("readwrite")).put(item))),
    delete: async (key) => void (await request((await store("readwrite")).delete(key))),
    all: async () => request((await store("readonly")).getAll()) as Promise<StoredOriginal[]>,
  };
}

/** Does nothing where IndexedDB is missing or blocked (private windows, SSR). */
const noStore: OriginalStore = {
  get: async () => undefined,
  put: async () => {},
  delete: async () => {},
  all: async () => [],
};

let shared: ReturnType<typeof createOriginalCache> | null = null;

/** The browser's shared cache. Safe to call anywhere; a no-op without IndexedDB. */
export function originalImageCache() {
  shared ??= createOriginalCache(typeof indexedDB === "undefined" ? noStore : indexedDbStore());
  return shared;
}
