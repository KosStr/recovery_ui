/**
 * Synchronous key-value storage.
 *
 * MMKV is the real backend: it is memory-mapped and synchronous, which is the
 * only reason `timerEngine` can read `targetEndTimestamp` during the very first
 * render pass without a loading flicker.
 *
 * MMKV is a JSI module and therefore absent in Expo Go. Rather than crash the
 * whole app on import, we degrade to an in-memory Map. Everything keeps working
 * for the length of the session; it just does not survive a reload. That trade
 * is worth it so the UI remains explorable in Expo Go.
 */

interface SyncStore {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
}

function createBackend(): { store: SyncStore; persistent: boolean } {
  try {
    // Required lazily: a static import would throw at module-eval time in Expo Go.
    const { MMKV } = require('react-native-mmkv') as typeof import('react-native-mmkv');
    const mmkv = new MMKV({ id: 'recovery.v1' });
    return {
      store: {
        getString: (k) => mmkv.getString(k),
        set: (k, v) => mmkv.set(k, v),
        delete: (k) => mmkv.delete(k),
      },
      persistent: true,
    };
  } catch {
    const mem = new Map<string, string>();
    if (__DEV__) {
      console.warn(
        '[storage] react-native-mmkv unavailable (Expo Go?). Falling back to in-memory storage — nothing will persist across reloads.',
      );
    }
    return {
      store: {
        getString: (k) => mem.get(k),
        set: (k, v) => void mem.set(k, v),
        delete: (k) => void mem.delete(k),
      },
      persistent: false,
    };
  }
}

const backend = createBackend();

/** False when running without MMKV, so the UI can warn instead of silently losing data. */
export const storageIsPersistent = backend.persistent;

export const storage = {
  getString(key: string): string | undefined {
    return backend.store.getString(key);
  },

  set(key: string, value: string): void {
    backend.store.set(key, value);
  },

  remove(key: string): void {
    backend.store.delete(key);
  },

  /** Reads and parses JSON, returning `fallback` on a miss or on corrupt data. */
  getJSON<T>(key: string, fallback: T): T {
    const raw = backend.store.getString(key);
    if (raw === undefined) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // Corrupt entry: drop it so it cannot keep throwing on every read.
      backend.store.delete(key);
      return fallback;
    }
  },

  setJSON(key: string, value: unknown): void {
    backend.store.set(key, JSON.stringify(value));
  },
};

/** Namespaced so a future migration can wipe one feature without touching others. */
export const StorageKeys = {
  activeTimer: 'timer.active',
  lastEnergyCheckin: 'energy.lastCheckin',
  energyStore: 'store.energy',
  windDownProgress: 'sleep.windDown',
  caffeineCutoff: 'sleep.caffeineCutoff',
  detoxSession: 'detox.activeSession',
  onboardingSeen: 'app.onboardingSeen',
} as const;

/** Zustand `persist` adapter backed by the same store. */
export const zustandMMKVStorage = {
  getItem: (name: string): string | null => storage.getString(name) ?? null,
  setItem: (name: string, value: string): void => storage.set(name, value),
  removeItem: (name: string): void => storage.remove(name),
};
