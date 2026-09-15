import { useCallback, useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { fadeOutAndStop, stopPlayback } from '@/services/audioPlayer';
import { StorageKeys, storage } from '@/services/storage';

/**
 * Sleep timer (FE-401 AC3).
 *
 * Auto-stops playback after 15 / 30 / 60 minutes, fading the volume out over the
 * final 30 seconds so the room does not go abruptly silent as someone drifts off.
 *
 * Like the focus timer, the source of truth is one absolute instant — `endAt` in
 * MMKV — not a counter. The remaining time is always `endAt − Date.now()`, so a
 * reload or a foreground after the screen was off shows the right value on the
 * first frame.
 *
 * The fade itself needs JS to run (it ramps the volume in steps), which it can:
 * while audio plays in the background the OS keeps the app alive, so the
 * scheduled fade fires. If the app is somehow suspended past `endAt` — audio
 * paused and backgrounded — `reconcile()` catches up on the next foreground and
 * stops cleanly. There is nothing to fade in that case anyway.
 */

const FADE_MS = 30_000;

export interface SleepTimerState {
  /** Absolute ms epoch at which audio should be fully stopped. */
  endAt: number;
  /** Length of the closing fade. */
  fadeMs: number;
  /** The option the user picked, for the UI. */
  minutes: number;
}

export function getSleepTimer(): SleepTimerState | null {
  return storage.getJSON<SleepTimerState | null>(StorageKeys.sleepTimer, null);
}

type Subscriber = (state: SleepTimerState | null) => void;
const subscribers = new Set<Subscriber>();
let timeout: ReturnType<typeof setTimeout> | null = null;

function write(state: SleepTimerState | null): void {
  if (state) storage.setJSON(StorageKeys.sleepTimer, state);
  else storage.remove(StorageKeys.sleepTimer);
  subscribers.forEach((fn) => fn(state));
}

export function subscribeSleepTimer(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

function clearTimer(): void {
  if (timeout) {
    clearTimeout(timeout);
    timeout = null;
  }
}

async function runFade(): Promise<void> {
  clearTimer();
  write(null);
  await fadeOutAndStop(FADE_MS);
}

/** (Re)arms the internal timeout against the persisted `endAt`. */
function schedule(state: SleepTimerState): void {
  clearTimer();
  const now = Date.now();
  const fadeStart = state.endAt - state.fadeMs;

  if (now >= state.endAt) {
    // Missed the whole window (app was suspended): stop now, no fade to run.
    write(null);
    void stopPlayback();
    return;
  }
  if (now >= fadeStart) {
    void runFade();
    return;
  }
  timeout = setTimeout(() => void runFade(), fadeStart - now);
}

export function startSleepTimer(minutes: number): SleepTimerState {
  const state: SleepTimerState = { endAt: Date.now() + minutes * 60_000, fadeMs: FADE_MS, minutes };
  write(state);
  schedule(state);
  return state;
}

/** Cancels the auto-stop. Deliberately leaves audio playing. */
export function cancelSleepTimer(): void {
  clearTimer();
  write(null);
}

/** Re-arms from persisted state after a reload or a return to the foreground. */
export function reconcileSleepTimer(): void {
  const state = getSleepTimer();
  if (state) schedule(state);
}

export interface SleepTimerBinding {
  minutes: number | null;
  remainingMs: number;
  isActive: boolean;
  start: (minutes: number) => void;
  cancel: () => void;
}

/** React binding: repaints once a second and reconciles on foreground. */
export function useSleepTimer(): SleepTimerBinding {
  const [state, setState] = useState<SleepTimerState | null>(() => getSleepTimer());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => subscribeSleepTimer(setState), []);

  // Reconcile on mount, and again whenever the app returns to the foreground.
  useEffect(() => {
    reconcileSleepTimer();
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') {
        reconcileSleepTimer();
        setNow(Date.now());
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!state) return;
    const tick = () => setNow(Date.now());
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [state]);

  const remainingMs = state ? Math.max(0, state.endAt - now) : 0;

  return {
    minutes: state?.minutes ?? null,
    remainingMs,
    isActive: state !== null,
    start: useCallback((minutes: number) => void startSleepTimer(minutes), []),
    cancel: useCallback(() => cancelSleepTimer(), []),
  };
}
