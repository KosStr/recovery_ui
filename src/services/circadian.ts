import { useCallback, useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { StorageKeys, storage } from '@/services/storage';

/**
 * Circadian anchors (FE-402).
 *
 *   caffeineCutoff = targetSleep − 9h   (adenosine can rebuild before bed)
 *   digitalSunset  = targetSleep − 1h   (melatonin is not suppressed by light)
 *
 * Everything is derived from one number the user sets — target bedtime — so the
 * two cards move together when they change it. Pure functions here; the hook at
 * the bottom just keeps the "time remaining" fresh.
 */

const CAFFEINE_OFFSET_MS = 9 * 60 * 60 * 1000;
const SUNSET_OFFSET_MS = 1 * 60 * 60 * 1000;

/** Bedtime as minutes-from-midnight. Clamped to a sane evening band. */
export const SLEEP_TARGET_MIN = 20 * 60; //   20:00
export const SLEEP_TARGET_MAX = 23 * 60 + 30; // 23:30
export const SLEEP_TARGET_STEP = 30;
const DEFAULT_TARGET = 23 * 60; //             23:00

export function getSleepTargetMinutes(): number {
  const raw = storage.getJSON<number>(StorageKeys.sleepTarget, DEFAULT_TARGET);
  return clampTarget(raw);
}

export function setSleepTargetMinutes(minutes: number): number {
  const clamped = clampTarget(minutes);
  storage.setJSON(StorageKeys.sleepTarget, clamped);
  return clamped;
}

function clampTarget(m: number): number {
  return Math.min(SLEEP_TARGET_MAX, Math.max(SLEEP_TARGET_MIN, Math.round(m / 30) * 30));
}

export function formatClock(minutesFromMidnight: number): string {
  const h = Math.floor(minutesFromMidnight / 60) % 24;
  const m = minutesFromMidnight % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "2г 15хв", "0г 40хв". */
export function formatHm(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}г ${m}хв`;
}

export interface CircadianInfo {
  bedtime: Date;
  caffeineCutoff: Date;
  digitalSunset: Date;
  caffeinePassed: boolean;
  caffeineRemainingMs: number;
  sunsetPassed: boolean;
  sunsetRemainingMs: number;
}

export function computeCircadian(targetMinutes: number, now: Date = new Date()): CircadianInfo {
  const todayTarget = new Date(now);
  todayTarget.setHours(Math.floor(targetMinutes / 60), targetMinutes % 60, 0, 0);

  // Once tonight's bedtime has passed, everything rolls to the next night.
  const bedtime =
    now.getTime() <= todayTarget.getTime()
      ? todayTarget
      : new Date(todayTarget.getTime() + 24 * 60 * 60 * 1000);

  const caffeineCutoff = new Date(bedtime.getTime() - CAFFEINE_OFFSET_MS);
  const digitalSunset = new Date(bedtime.getTime() - SUNSET_OFFSET_MS);

  const caffeineRemainingMs = caffeineCutoff.getTime() - now.getTime();
  const sunsetRemainingMs = digitalSunset.getTime() - now.getTime();

  return {
    bedtime,
    caffeineCutoff,
    digitalSunset,
    caffeinePassed: caffeineRemainingMs <= 0,
    caffeineRemainingMs,
    sunsetPassed: sunsetRemainingMs <= 0,
    sunsetRemainingMs,
  };
}

export interface CircadianBinding {
  targetMinutes: number;
  info: CircadianInfo;
  adjustTarget: (deltaMinutes: number) => void;
}

/** Recomputes every 30 s (and on foreground) so "time remaining" stays honest. */
export function useCircadian(): CircadianBinding {
  const [targetMinutes, setTarget] = useState(() => getSleepTargetMinutes());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') setNow(Date.now());
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, []);

  const adjustTarget = useCallback((deltaMinutes: number) => {
    setTarget((current) => setSleepTargetMinutes(current + deltaMinutes));
  }, []);

  return {
    targetMinutes,
    info: computeCircadian(targetMinutes, new Date(now)),
    adjustTarget,
  };
}
