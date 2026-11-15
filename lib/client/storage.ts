/** The part of `localStorage` the app uses, so tests can substitute an in-memory one. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function memoryStorage(): KeyValueStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

/** `localStorage`, or an in-memory stand-in when the browser denies access to it. */
export function browserStorage(): KeyValueStorage {
  try {
    // Some privacy settings make this property itself throw.
    return window.localStorage;
  } catch {
    return memoryStorage();
  }
}

export interface JsonStore {
  /** The stored value, or `undefined` when absent or unreadable. */
  read(key: string): unknown;
  /** Stores a value (`null` removes it). Returns false if it could only be kept in memory. */
  write(key: string, value: unknown): boolean;
  /** False while at least one value exists only in memory. */
  healthy(): boolean;
}

/**
 * JSON on top of a storage, in a way that cannot fail: when the browser
 * refuses a write (quota full, storage disabled) the value is kept in memory
 * and later reads return it. The app then keeps working for as long as the tab
 * stays open, instead of silently acting on stale data.
 */
export function createJsonStore(storage: KeyValueStorage): JsonStore {
  const unsaved = new Map<string, unknown>();

  return {
    read(key) {
      if (unsaved.has(key)) return unsaved.get(key);
      try {
        const raw = storage.getItem(key);
        return raw === null ? undefined : JSON.parse(raw);
      } catch {
        return undefined;
      }
    },

    write(key, value) {
      try {
        if (value === null || value === undefined) storage.removeItem(key);
        else storage.setItem(key, JSON.stringify(value));
        unsaved.delete(key);
        return true;
      } catch {
        unsaved.set(key, value ?? undefined);
        return false;
      }
    },

    healthy: () => unsaved.size === 0,
  };
}
