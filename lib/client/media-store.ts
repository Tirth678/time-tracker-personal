/**
 * Keeps the uploaded background file in this browser (IndexedDB), so it is
 * still there on the next visit. localStorage cannot hold files; a server
 * upload would be pointless for a picture only this browser ever shows.
 */

const DB_NAME = "study-tracker";
const STORE = "media";
const KEY = "background";

/** Larger files are refused up front instead of failing halfway into the write. */
export const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, 1);
    } catch (err) {
      // Some privacy modes expose no usable IndexedDB at all.
      reject(err);
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("The browser's storage is busy."));
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = work(transaction.objectStore(STORE));
      // Resolve on completion, not on request success: only then is the data durable.
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? request.error);
      transaction.onabort = () => reject(transaction.error ?? new Error("The browser refused to store the file."));
    });
  } finally {
    db.close();
  }
}

export async function saveBackgroundFile(file: Blob): Promise<void> {
  await run("readwrite", (store) => store.put(file, KEY));
}

/** The stored file, or `null` when there is none (or the browser's data was cleared). */
export async function loadBackgroundFile(): Promise<Blob | null> {
  const value = await run<unknown>("readonly", (store) => store.get(KEY));
  return value instanceof Blob ? value : null;
}

export async function clearBackgroundFile(): Promise<void> {
  await run("readwrite", (store) => store.delete(KEY));
}
