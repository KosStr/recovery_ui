import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Easing,
  runOnJS,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';

/**
 * The physiological sigh, as a state machine.
 *
 * Two inhales through the nose -- a long one, then a short sniff that reinflates
 * collapsed alveoli -- followed by a long, slow exhale. The exhale is roughly
 * twice the length of both inhales combined; that ratio is what actually slows
 * heart rate, so it is the one number here not worth "tuning" for aesthetics.
 *
 * The animation lives entirely on the UI thread. `lungFullness` is a
 * SharedValue driven by a single `withSequence`, which means it keeps running
 * at display refresh rate even if the JS thread is busy writing to SQLite. The
 * only JS-thread work is the haptic cue and the phase label, hopped over with
 * `runOnJS` from each segment's completion callback.
 */

export type BreathPhase = 'idle' | 'inhale1' | 'inhale2' | 'exhale' | 'rest';

export const PHASE_COPY: Record<BreathPhase, string> = {
  idle: 'Ready',
  inhale1: 'Inhale through your nose',
  inhale2: 'Sip a little more',
  exhale: 'Long, slow exhale',
  rest: 'Rest',
};

const TIMING = {
  /** Long first inhale, to about two-thirds of capacity. */
  inhale1: 1600,
  /** Short second sniff that tops the lungs off. */
  inhale2: 700,
  /** The part that does the work. Deliberately longer than both inhales. */
  exhale: 5500,
  /** Beat of stillness before the next cycle, so it never feels like a metronome. */
  rest: 900,
} as const;

/** Fullness at the end of the first inhale. The sniff covers the rest. */
const INHALE_1_PEAK = 0.68;

export const CYCLE_MS = TIMING.inhale1 + TIMING.inhale2 + TIMING.exhale + TIMING.rest;

export interface SighCycle {
  /** 0 (empty) to 1 (full). Drive every visual from this. */
  lungFullness: SharedValue<number>;
  phase: BreathPhase;
  /** Completed cycles in this session. */
  completedCycles: number;
  isRunning: boolean;
  start: () => void;
  stop: () => void;
}

export function useSighCycle(options?: {
  /** Stop automatically after this many cycles. Omit to run until stopped. */
  targetCycles?: number;
  onCycleComplete?: (count: number) => void;
  onFinished?: () => void;
}): SighCycle {
  const lungFullness = useSharedValue(0);

  const [phase, setPhase] = useState<BreathPhase>('idle');
  const [completedCycles, setCompletedCycles] = useState(0);
  const [isRunning, setIsRunning] = useState(false);

  // Read inside worklet callbacks that must not capture stale state.
  const runningRef = useRef(false);
  const cyclesRef = useRef(0);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  /** Phase entry: fire the matching haptic and update the caption together. */
  const enterPhase = useCallback((next: BreathPhase) => {
    setPhase(next);
    switch (next) {
      case 'inhale1':
        haptics.inhalePrimary();
        break;
      case 'inhale2':
        haptics.inhaleSecondary();
        break;
      case 'exhale':
        haptics.exhale();
        break;
      default:
        break;
    }
  }, []);

  const finishCycle = useCallback(() => {
    cyclesRef.current += 1;
    const count = cyclesRef.current;
    setCompletedCycles(count);
    optionsRef.current?.onCycleComplete?.(count);

    const target = optionsRef.current?.targetCycles;
    if (target !== undefined && count >= target) {
      runningRef.current = false;
      setIsRunning(false);
      setPhase('idle');
      haptics.success();
      optionsRef.current?.onFinished?.();
      return;
    }

    if (runningRef.current) runCycleRef.current?.();
  }, []);

  // Held in a ref because `runCycle` schedules itself, and a plain useCallback
  // would need to reference its own not-yet-assigned identity.
  const runCycleRef = useRef<(() => void) | undefined>(undefined);

  const runCycle = useCallback(() => {
    if (!runningRef.current) return;

    enterPhase('inhale1');

    lungFullness.value = withSequence(
      // Inhale 1 -- eases out, so the chest fills quickly then settles.
      withTiming(
        INHALE_1_PEAK,
        { duration: TIMING.inhale1, easing: Easing.out(Easing.cubic) },
        (finished) => {
          'worklet';
          if (finished) runOnJS(enterPhase)('inhale2');
        },
      ),
      // Inhale 2 -- short and sharp; linear reads as a distinct second action.
      withTiming(1, { duration: TIMING.inhale2, easing: Easing.linear }, (finished) => {
        'worklet';
        if (finished) runOnJS(enterPhase)('exhale');
      }),
      // Exhale -- the long release. `inOut` keeps it from stalling at the end.
      withTiming(0, { duration: TIMING.exhale, easing: Easing.inOut(Easing.quad) }, (finished) => {
        'worklet';
        if (finished) runOnJS(enterPhase)('rest');
      }),
      // Rest -- holds at empty. Animating to the same value is the cheapest way
      // to express "wait" inside a sequence.
      withTiming(0, { duration: TIMING.rest, easing: Easing.linear }, (finished) => {
        'worklet';
        if (finished) runOnJS(finishCycle)();
      }),
    );
  }, [enterPhase, finishCycle, lungFullness]);

  runCycleRef.current = runCycle;

  const start = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    cyclesRef.current = 0;
    setCompletedCycles(0);
    setIsRunning(true);
    lungFullness.value = 0;
    runCycle();
  }, [lungFullness, runCycle]);

  const stop = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
    setPhase('idle');
    // Ease back to empty rather than snapping, so an abort still feels calm.
    lungFullness.value = withTiming(0, { duration: 600, easing: Easing.out(Easing.quad) });
  }, [lungFullness]);

  // Leaving the screen mid-cycle must not leave a sequence running against an
  // unmounted component's callbacks.
  useEffect(() => {
    return () => {
      runningRef.current = false;
    };
  }, []);

  return { lungFullness, phase, completedCycles, isRunning, start, stop };
}
