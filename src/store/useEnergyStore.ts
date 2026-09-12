import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  decodeTags,
  getLatestTodayCheckin,
  getTodayEnergyStats,
  insertEnergyCheckin,
  localDateKey,
  updateCheckinTags,
} from '@/db/localDb';
import { StorageKeys, zustandMMKVStorage } from '@/services/storage';

/**
 * Ephemeral session state.
 *
 * Division of labour in this app:
 *  - SQLite owns the durable record (every session, every check-in, forever).
 *  - This store owns what the UI needs *right now* -- the day's average energy,
 *    the picked soundscape, whether detox mode is armed -- so screens read
 *    synchronously without a query round-trip.
 *  - MMKV backs the `persist` middleware so a cold start restores the last
 *    known state instantly, before SQLite has been read.
 *
 * Anything that needs history belongs in SQLite, not here.
 */

export type EnergyScore = 1 | 2 | 3 | 4 | 5;
export type Soundscape = 'none' | 'brown-noise' | 'rain' | 'deep-drone' | 'forest';

export const ENERGY_LABELS: Record<EnergyScore, string> = {
  1: 'Вигорання',
  2: 'Низька',
  3: 'Рівна',
  4: 'Добра',
  5: 'Піковий фокус',
};

/**
 * Quick tags for a check-in (FE-202). Stored by stable `id`, shown by `label`
 * -- so a future locale swap changes only the labels, not the rows on disk.
 */
export const ENERGY_TAGS = [
  { id: 'coffee', label: 'Після кави' },
  { id: 'screen-fatigue', label: 'Втома від екрана' },
  { id: 'sleepy', label: 'Сонливість' },
  { id: 'after-walk', label: 'Після прогулянки' },
] as const;

export type EnergyTagId = (typeof ENERGY_TAGS)[number]['id'];

export const SOUNDSCAPE_LABELS: Record<Soundscape, string> = {
  none: 'Silence',
  'brown-noise': 'Brown noise',
  rain: 'Rain',
  'deep-drone': 'Deep drone',
  forest: 'Forest',
};

interface EnergyState {
  /** Mean of today's check-ins, rounded to one decimal. Null before any today. */
  todayAverage: number | null;
  /** How many check-ins have been logged today. */
  todayCount: number;
  /** The most recent reading's score, for the selector's resting position. */
  latestScore: EnergyScore | null;
  /** Local date the figures above belong to; used to expire them at midnight. */
  energyDate: string | null;
  /** Row id of the most recent check-in, so the tag sheet can edit it. */
  lastCheckinId: string | null;
  /** Tags on that most recent check-in. */
  lastTags: string[];

  soundscape: Soundscape;
  detoxArmed: boolean;
  detoxStartedAt: number | null;

  breathCyclesToday: number;
  breathDate: string | null;

  hydrated: boolean;
}

interface EnergyActions {
  /** Appends a check-in. Optimistic: the average moves on the same frame as the
   *  tap, then SQLite is written and the figures reconciled. Returns the row id. */
  logEnergy: (score: EnergyScore) => Promise<string>;
  /** Replaces the tags on the most recent check-in. */
  setLastTags: (tags: string[]) => Promise<void>;

  setSoundscape: (soundscape: Soundscape) => void;
  armDetox: () => void;
  releaseDetox: () => void;
  recordBreathCycle: () => void;
  hydrateFromDb: () => Promise<void>;
}

export const useEnergyStore = create<EnergyState & EnergyActions>()(
  persist(
    (set, get) => ({
      todayAverage: null,
      todayCount: 0,
      latestScore: null,
      energyDate: null,
      lastCheckinId: null,
      lastTags: [],

      soundscape: 'brown-noise',
      detoxArmed: false,
      detoxStartedAt: null,
      breathCyclesToday: 0,
      breathDate: null,
      hydrated: false,

      logEnergy: async (score) => {
        const today = localDateKey();
        const state = get();

        // Optimistic average: fold the new score into the running mean so the
        // battery and the home stat move before SQLite has been touched. A new
        // day starts the mean from this reading alone.
        const sameDay = state.energyDate === today;
        const prevCount = sameDay ? state.todayCount : 0;
        const prevSum = sameDay ? (state.todayAverage ?? 0) * prevCount : 0;
        const nextCount = prevCount + 1;
        const optimisticAvg = Math.round(((prevSum + score) / nextCount) * 10) / 10;

        set({
          latestScore: score,
          todayAverage: optimisticAvg,
          todayCount: nextCount,
          energyDate: today,
          lastTags: [],
        });

        const id = await insertEnergyCheckin(score);
        // Reconcile against the authoritative aggregate (fixes rounding, and any
        // rows written on another surface since hydrate).
        const stats = await getTodayEnergyStats();
        set({
          lastCheckinId: id,
          todayAverage: stats.average,
          todayCount: stats.count,
          latestScore: (stats.latest as EnergyScore) ?? score,
        });
        return id;
      },

      setLastTags: async (tags) => {
        const { lastCheckinId } = get();
        set({ lastTags: tags });
        if (lastCheckinId) await updateCheckinTags(lastCheckinId, tags);
      },

      setSoundscape: (soundscape) => set({ soundscape }),
      armDetox: () => set({ detoxArmed: true, detoxStartedAt: Date.now() }),
      releaseDetox: () => set({ detoxArmed: false, detoxStartedAt: null }),

      recordBreathCycle: () => {
        const today = localDateKey();
        const { breathDate, breathCyclesToday } = get();
        set({
          breathDate: today,
          breathCyclesToday: breathDate === today ? breathCyclesToday + 1 : 1,
        });
      },

      hydrateFromDb: async () => {
        const today = localDateKey();
        const state = get();
        const patch: Partial<EnergyState> = { hydrated: true };

        // Roll anything stamped with a previous day back to empty before trusting
        // the persisted snapshot.
        if (state.energyDate !== today) {
          patch.todayAverage = null;
          patch.todayCount = 0;
          patch.latestScore = null;
          patch.lastCheckinId = null;
          patch.lastTags = [];
          patch.energyDate = today;
        }
        if (state.breathDate !== today) {
          patch.breathCyclesToday = 0;
          patch.breathDate = today;
        }

        // SQLite is authoritative for the figures the dashboard shows.
        const [stats, latest] = await Promise.all([
          getTodayEnergyStats(),
          getLatestTodayCheckin(),
        ]);
        patch.todayAverage = stats.average;
        patch.todayCount = stats.count;
        patch.latestScore = (stats.latest as EnergyScore) ?? null;
        patch.energyDate = today;
        patch.lastCheckinId = latest?.id ?? null;
        patch.lastTags = decodeTags(latest?.context ?? null);

        set(patch);
      },
    }),
    {
      name: StorageKeys.energyStore,
      storage: createJSONStorage(() => zustandMMKVStorage),
      partialize: ({ hydrated: _hydrated, ...rest }) => rest,
      // Bumped from 1: the shape changed from a single daily score to an
      // averaged, multi-check-in model. The old persisted blob is discarded
      // rather than migrated -- it only held one transient day's figures.
      version: 2,
    },
  ),
);

/**
 * Selector hooks. Subscribing to one field rather than the whole store means the
 * breathing screen does not re-render when the soundscape changes -- which
 * matters when a Skia canvas is running at 120fps behind it.
 */
export const useTodayAverage = () => useEnergyStore((s) => s.todayAverage);
export const useTodayCount = () => useEnergyStore((s) => s.todayCount);
export const useLatestScore = () => useEnergyStore((s) => s.latestScore);
export const useSoundscape = () => useEnergyStore((s) => s.soundscape);
export const useDetoxArmed = () => useEnergyStore((s) => s.detoxArmed);
export const useBreathCycles = () => useEnergyStore((s) => s.breathCyclesToday);
