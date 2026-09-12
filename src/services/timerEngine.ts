import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { cancelScheduled, scheduleAt } from '@/services/notifications';
import { StorageKeys, storage } from '@/services/storage';

/**
 * Delta-timestamp timer engine.
 *
 * The rule this file exists to enforce: **we never count down.** JS intervals
 * are throttled in the background, suspended when the screen locks, and killed
 * outright when the OS reclaims the app. A decrementing counter would drift or
 * freeze, and a 90-minute ultradian block would end minutes late.
 *
 * Instead we persist one absolute instant -- `targetEndTimestamp` -- to MMKV,
 * and every render derives `remaining = targetEndTimestamp - Date.now()`. The
 * interval below only drives repaints; it is not the source of truth. A local
 * notification scheduled with the OS covers the case where the process is dead
 * at completion time.
 *
 * Pausing is expressed the same way: we store `pausedAt` and, on resume, push
 * `targetEndTimestamp` forward by the elapsed pause. No accumulator, no drift.
 */

export type TimerKind = 'focus' | 'break' | 'detox' | 'winddown';

export interface ActiveTimer {
  id: string;
  kind: TimerKind;
  label: string;
  /** Absolute ms epoch at which this block completes. The single source of truth. */
  targetEndTimestamp: number;
  /** Full configured length, used for progress ratio (survives pausing). */
  durationMs: number;
  startedAt: number;
  /** Set while paused; `targetEndTimestamp` is stale until resume rebases it. */
  pausedAt?: number;
  /** OS notification id, so we can cancel it if the user finishes early. */
  notificationId?: string | null;
}

const NOTIFICATION_COPY: Record<TimerKind, { title: string; body: string }> = {
  focus: {
    title: 'Block complete',
    body: 'Ninety minutes done. Stand up and look at something far away.',
  },
  break: {
    title: 'Break over',
    body: 'Twenty minutes of recovery banked. Ready for the next block?',
  },
  detox: {
    title: 'Screen-free window finished',
    body: 'You stayed off the glass. Log how it felt.',
  },
  winddown: {
    title: 'Wind-down starts now',
    body: 'Lights down, screens away. Sleep pressure is highest right now.',
  },
};

// --- Persistence -----------------------------------------------------------

export function getActiveTimer(): ActiveTimer | null {
  return storage.getJSON<ActiveTimer | null>(StorageKeys.activeTimer, null);
}

// A tiny synchronous pub/sub so several mounted screens observing the same
// timer stay consistent without routing this through Zustand or Query.
type Subscriber = (timer: ActiveTimer | null) => void;
const subscribers = new Set<Subscriber>();

function writeActiveTimer(timer: ActiveTimer | null): void {
  if (timer) storage.setJSON(StorageKeys.activeTimer, timer);
  else storage.remove(StorageKeys.activeTimer);
  subscribers.forEach((fn) => fn(timer));
}

export function subscribeToTimer(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

// --- Derived values --------------------------------------------------------

/** Milliseconds left, clamped at zero. Frozen while paused. */
export function remainingMs(timer: ActiveTimer | null, now: number = Date.now()): number {
  if (!timer) return 0;
  const reference = timer.pausedAt ?? now;
  return Math.max(0, timer.targetEndTimestamp - reference);
}

/** 0 to 1 completion ratio, for rings and progress bars. */
export function progressRatio(timer: ActiveTimer | null, now: number = Date.now()): number {
  if (!timer || timer.durationMs <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - remainingMs(timer, now) / timer.durationMs));
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

// --- Commands --------------------------------------------------------------

export async function startTimer(input: {
  kind: TimerKind;
  label: string;
  durationMs: number;
}): Promise<ActiveTimer> {
  // Only one timer owns the foreground at a time; clear whatever was there so
  // we never leak an orphaned OS notification.
  await cancelActiveTimer();

  const now = Date.now();
  const targetEndTimestamp = now + input.durationMs;

  const copy = NOTIFICATION_COPY[input.kind];
  const notificationId = await scheduleAt(new Date(targetEndTimestamp), {
    title: copy.title,
    body: copy.body,
    data: { kind: input.kind },
  });

  const timer: ActiveTimer = {
    id: `${input.kind}-${now}`,
    kind: input.kind,
    label: input.label,
    targetEndTimestamp,
    durationMs: input.durationMs,
    startedAt: now,
    notificationId,
  };

  writeActiveTimer(timer);
  return timer;
}

export async function pauseTimer(): Promise<ActiveTimer | null> {
  const timer = getActiveTimer();
  if (!timer || timer.pausedAt) return timer;

  // The notification's fire time is now wrong, so retract it. It is rescheduled
  // against the rebased target on resume.
  await cancelScheduled(timer.notificationId);

  const paused: ActiveTimer = { ...timer, pausedAt: Date.now(), notificationId: null };
  writeActiveTimer(paused);
  return paused;
}

export async function resumeTimer(): Promise<ActiveTimer | null> {
  const timer = getActiveTimer();
  if (!timer?.pausedAt) return timer;

  // Rebase rather than accumulate: push the finish line forward by exactly how
  // long we sat paused. This keeps `remaining` correct to the millisecond no
  // matter how many pause cycles happened.
  const pausedFor = Date.now() - timer.pausedAt;
  const targetEndTimestamp = timer.targetEndTimestamp + pausedFor;

  const copy = NOTIFICATION_COPY[timer.kind];
  const notificationId = await scheduleAt(new Date(targetEndTimestamp), {
    title: copy.title,
    body: copy.body,
    data: { kind: timer.kind },
  });

  const resumed: ActiveTimer = {
    ...timer,
    targetEndTimestamp,
    notificationId,
    pausedAt: undefined,
  };
  writeActiveTimer(resumed);
  return resumed;
}

/** Aborts the block and retracts its pending notification. */
export async function cancelActiveTimer(): Promise<void> {
  const timer = getActiveTimer();
  if (!timer) return;
  await cancelScheduled(timer.notificationId);
  writeActiveTimer(null);
}

/**
 * Clears a timer that has genuinely reached zero. Distinct from cancelling:
 * the caller is expected to have already written a completed session row.
 */
export function clearCompletedTimer(): void {
  const timer = getActiveTimer();
  if (timer && remainingMs(timer) <= 0) writeActiveTimer(null);
}

// --- React binding ---------------------------------------------------------

export interface CountdownState {
  timer: ActiveTimer | null;
  remaining: number;
  progress: number;
  isRunning: boolean;
  isPaused: boolean;
  hasCompleted: boolean;
}

/**
 * Subscribes to the active timer and repaints once a second.
 *
 * `onComplete` fires exactly once per timer id, on whichever tick first
 * observes zero -- including the tick forced by returning to the foreground, so
 * a block that ended while the app was backgrounded still resolves correctly.
 */
export function useCountdown(onComplete?: (timer: ActiveTimer) => void): CountdownState {
  const [timer, setTimer] = useState<ActiveTimer | null>(() => getActiveTimer());
  const [now, setNow] = useState(() => Date.now());

  // Held in a ref so a caller passing an inline arrow does not resubscribe.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Guards against double-firing when several ticks land on an expired timer.
  const completedIdRef = useRef<string | null>(null);

  useEffect(() => subscribeToTimer(setTimer), []);

  useEffect(() => {
    if (!timer || timer.pausedAt) return;

    const tick = () => setNow(Date.now());
    tick();
    const interval = setInterval(tick, 1000);

    // Returning to the foreground must resync immediately: the interval was
    // throttled or suspended while backgrounded, so its last value is stale.
    const onAppStateChange = (state: AppStateStatus) => {
      if (state === 'active') tick();
    };
    const subscription = AppState.addEventListener('change', onAppStateChange);

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [timer]);

  const remaining = remainingMs(timer, now);
  const hasCompleted = timer !== null && remaining <= 0;

  useEffect(() => {
    if (!timer || !hasCompleted) return;
    if (completedIdRef.current === timer.id) return;
    completedIdRef.current = timer.id;
    onCompleteRef.current?.(timer);
  }, [hasCompleted, timer]);

  return {
    timer,
    remaining,
    progress: progressRatio(timer, now),
    isRunning: timer !== null && !timer.pausedAt && !hasCompleted,
    isPaused: Boolean(timer?.pausedAt),
    hasCompleted,
  };
}

/** Stable command wrappers so screens read declaratively. */
export function useTimerControls() {
  return {
    start: useCallback(
      (kind: TimerKind, label: string, durationMs: number) => startTimer({ kind, label, durationMs }),
      [],
    ),
    pause: useCallback(() => pauseTimer(), []),
    resume: useCallback(() => resumeTimer(), []),
    cancel: useCallback(() => cancelActiveTimer(), []),
  };
}

/** Ultradian rhythm defaults: ~90 minutes of work, ~20 minutes of true rest. */
export const ULTRADIAN = {
  focusMs: 90 * 60 * 1000,
  breakMs: 20 * 60 * 1000,
} as const;
