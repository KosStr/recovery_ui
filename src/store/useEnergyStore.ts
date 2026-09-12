import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { getTodayCheckin, localDateKey, upsertEnergyCheckin } from '@/db/localDb';
import { zustandMMKVStorage } from '@/services/storage';
import { StorageKeys } from '@/services/storage';

/**
 * Ephemeral session state.
 *
 * Division of labour in this app:
 *  - SQLite owns the durable record (every session, every check-in, forever).
 *  - This store owns what the UI needs *right now* -- today's score, the picked
 *    soundscape, whether detox mode is armed -- so screens read synchronously
 *    without a query round-trip.
 *  - MMKV backs the `persist` middleware so a cold start restores the last
 *    known state instantly, before SQLite has been read.
 *
 * Anything that needs history belongs in SQLite, not here.
 */

export type EnergyScore = 1 | 2 | 3 | 4 | 5;
export type Soundscape = 'none' | 'brown-noise' | 'rain' | 'deep-drone' | 'forest';

export const ENERGY_LABELS: Record<EnergyScore, string> = {
  1: 'Depleted',
  2: 'Low',
  3: 'Steady',
  4: 'Good',
  5: 'Charged',
};

export const SOUNDSCAPE_LABELS: Record<Soundscape, string> = {
  none: 'Silence',
  'brown-noise': 'Brown noise',
  rain: 'Rain',
  'deep-drone': 'Deep drone',
  forest: 'Forest',
};

interface EnergyState {
  /** Today's self-reported energy, or null before the first check-in of the day. */
  todayScore: EnergyScore | null;
  /** Local date key the score belongs to; used to expire it at midnight. */
  scoreDate: string | null;

  soundscape: Soundscape;
  /** Detox mode is armed by the user and released explicitly or on timer end. */
  detoxArmed: boolean;
  detoxStartedAt: number | null;

  /** Count of completed breathing sessions today -- drives the dashboard streak. */
  breathCyclesToday: number;
  breathDate: string | null;

  hydrated: boolean;
}

interface EnergyActions {
  setEnergy: (score: EnergyScore, context?: string) => Promise<void>;
  setSoundscape: (soundscape: Soundscape) => void;
  armDetox: () => void;
  releaseDetox: () => void;
  recordBreathCycle: () => void;
  /** Reconciles the store against SQLite and rolls the day over if needed. */
  hydrateFromDb: () => Promise<void>;
}

export const useEnergyStore = create<EnergyState & EnergyActions>()(
  persist(
    (set, get) => ({
      todayScore: null,
      scoreDate: null,
      soundscape: 'brown-noise',
      detoxArmed: false,
      detoxStartedAt: null,
      breathCyclesToday: 0,
      breathDate: null,
      hydrated: false,

      setEnergy: async (score, context) => {
        // Optimistic: the dial should respond on the same frame as the tap.
        set({ todayScore: score, scoreDate: localDateKey() });
        await upsertEnergyCheckin(score, context);
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

        // Roll over anything stamped with a previous day before trusting it.
        const patch: Partial<EnergyState> = { hydrated: true };
        if (state.scoreDate !== today) {
          patch.todayScore = null;
          patch.scoreDate = null;
        }
        if (state.breathDate !== today) {
          patch.breathCyclesToday = 0;
          patch.breathDate = today;
        }

        // SQLite is authoritative: a check-in made on another surface, or one
        // written before MMKV was flushed, wins over the persisted snapshot.
        const row = await getTodayCheckin();
        if (row) {
          patch.todayScore = row.score as EnergyScore;
          patch.scoreDate = today;
        }

        set(patch);
      },
    }),
    {
      name: StorageKeys.energyStore,
      storage: createJSONStorage(() => zustandMMKVStorage),
      // `hydrated` is a runtime flag, not durable state.
      partialize: ({ hydrated: _hydrated, ...rest }) => rest,
      version: 1,
    },
  ),
);

/**
 * Selector hooks.
 *
 * Subscribing to one field rather than the whole store means the breathing
 * screen does not re-render when the soundscape changes -- which matters when a
 * Skia canvas is running at 120fps behind it.
 */
export const useTodayEnergy = () => useEnergyStore((s) => s.todayScore);
export const useSoundscape = () => useEnergyStore((s) => s.soundscape);
export const useDetoxArmed = () => useEnergyStore((s) => s.detoxArmed);
export const useBreathCycles = () => useEnergyStore((s) => s.breathCyclesToday);
