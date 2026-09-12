import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelAnimation,
  Easing,
  runOnJS,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';

/**
 * The physiological sigh, as a four-phase state machine (FE-201).
 *
 * Two inhales through the nose -- a long one, then a short sniff that reinflates
 * collapsed alveoli -- a brief hold, then a long, slow exhale. The exhale runs
 * roughly twice the length of everything before it; that ratio is what actually
 * slows heart rate, so it is the one number here not worth tuning for looks.
 *
 * The visual runs entirely on the UI thread: `lungFullness` and `glow` are
 * SharedValues driven by Reanimated, so the orb holds frame rate even while the
 * JS thread writes a session row to SQLite. The only JS-thread work per phase is
 * the haptic cue and the caption, hopped over with `runOnJS`.
 *
 * Haptics are the whole point when the eyes are closed, so they are specified
 * per phase:
 *   inhale1  rising ramp of Light taps, accelerating as the lungs fill
 *   inhale2  one Medium tap -- the sharp "довдих"
 *   hold     silence; the orb's glow pulses instead
 *   exhale   one Light tap at the start of the release
 */

export type BreathPhase = 'idle' | 'inhale1' | 'inhale2' | 'hold' | 'exhale';

export const PHASE_COPY: Record<BreathPhase, string> = {
  idle: 'Готові',
  inhale1: 'Вдих носом',
  inhale2: 'Ще трохи повітря',
  hold: 'Затримайте',
  exhale: 'Повільний видих',
};

const TIMING = {
  /** Phase 1 -- long first inhale, 40% -> 85% radius. */
  inhale1: 1500,
  /** Phase 2 -- the sharp "довдих", 85% -> 100%. */
  inhale2: 600,
  /** Phase 3 -- hold at full while the glow pulses. */
  hold: 1000,
  /** Phase 4 -- the long release, 100% -> 40%. */
  exhale: 5000,
} as const;

/**
 * Fullness 0..1 maps to radius 40%..100% in the visual. The first inhale stops
 * at 85% radius, which is fullness (0.85 - 0.40) / (1.0 - 0.40) = 0.75.
 */
const INHALE_1_PEAK = 0.75;

export const CYCLE_MS = TIMING.inhale1 + TIMING.inhale2 + TIMING.hold + TIMING.exhale;

export interface SighCycle {
  /** 0 (40% radius) to 1 (100% radius). Drive the orb's size from this. */
  lungFullness: SharedValue<number>;
  /** 0..1 pulsing intensity, non-zero only during the hold phase. */
  glow: SharedValue<number>;
  phase: BreathPhase;
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
  const glow = useSharedValue(0);

  const [phase, setPhase] = useState<BreathPhase>('idle');
  const [completedCycles, setCompletedCycles] = useState(0);
  const [isRunning, setIsRunning] = useState(false);

  const runningRef = useRef(false);
  const cyclesRef = useRef(0);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Pending timeouts for the rising inhale ramp, cleared on phase change / stop.
  const rampTimeouts = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearRamp = useCallback(() => {
    rampTimeouts.current.forEach(clearTimeout);
    rampTimeouts.current = [];
  }, []);

  /**
   * Fires Light taps across the first inhale, the gap shrinking as it goes so
   * the vibration reads as *rising* -- the body's cue to keep drawing breath in.
   * Runs on the JS thread (setTimeout); it only triggers haptics, never drives
   * the animation, so throttling would at worst drop a tap, never stutter the orb.
   */
  const startInhaleRamp = useCallback(() => {
    clearRamp();
    let t = 0;
    let gap = 360;
    // Leave a beat before the довдих so the two inhales stay distinct.
    while (t < TIMING.inhale1 - 120) {
      rampTimeouts.current.push(setTimeout(() => haptics.inhalePrimary(), t));
      t += gap;
      gap = Math.max(110, gap - 45);
    }
  }, [clearRamp]);

  const enterPhase = useCallback(
    (next: BreathPhase) => {
      setPhase(next);
      switch (next) {
        case 'inhale1':
          startInhaleRamp();
          break;
        case 'inhale2':
          clearRamp();
          haptics.inhaleSecondary();
          break;
        case 'hold':
          // Pulse the glow for the length of the hold. `withRepeat(..., true)`
          // reverses each iteration, so it breathes up and down rather than
          // snapping back to the trough.
          glow.value = withRepeat(
            withSequence(
              withTiming(1, { duration: 500, easing: Easing.inOut(Easing.quad) }),
              withTiming(0.35, { duration: 500, easing: Easing.inOut(Easing.quad) }),
            ),
            -1,
            true,
          );
          break;
        case 'exhale':
          cancelAnimation(glow);
          glow.value = withTiming(0, { duration: 400 });
          haptics.exhale();
          break;
        default:
          break;
      }
    },
    [clearRamp, glow, startInhaleRamp],
  );

  const runCycleRef = useRef<(() => void) | undefined>(undefined);

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

  const runCycle = useCallback(() => {
    if (!runningRef.current) return;

    enterPhase('inhale1');

    lungFullness.value = withSequence(
      // Inhale 1 -- smooth fill to 85% radius.
      withTiming(
        INHALE_1_PEAK,
        { duration: TIMING.inhale1, easing: Easing.inOut(Easing.quad) },
        (finished) => {
          'worklet';
          if (finished) runOnJS(enterPhase)('inhale2');
        },
      ),
      // Inhale 2 -- quick top-off to 100%.
      withTiming(1, { duration: TIMING.inhale2, easing: Easing.out(Easing.quad) }, (finished) => {
        'worklet';
        if (finished) runOnJS(enterPhase)('hold');
      }),
      // Hold -- stay at full; the glow does the moving.
      withTiming(1, { duration: TIMING.hold, easing: Easing.linear }, (finished) => {
        'worklet';
        if (finished) runOnJS(enterPhase)('exhale');
      }),
      // Exhale -- long, soft settle back to 40% radius.
      withTiming(0, { duration: TIMING.exhale, easing: Easing.out(Easing.cubic) }, (finished) => {
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
    glow.value = 0;
    runCycle();
  }, [glow, lungFullness, runCycle]);

  const stop = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
    setPhase('idle');
    clearRamp();
    cancelAnimation(glow);
    glow.value = withTiming(0, { duration: 300 });
    // Ease back to empty rather than snapping, so an abort still feels calm.
    lungFullness.value = withTiming(0, { duration: 600, easing: Easing.out(Easing.quad) });
  }, [clearRamp, glow, lungFullness]);

  // Leaving the screen mid-cycle must not leave timers firing or a sequence
  // calling back into an unmounted component.
  useEffect(() => {
    return () => {
      runningRef.current = false;
      clearRamp();
    };
  }, [clearRamp]);

  return { lungFullness, glow, phase, completedCycles, isRunning, start, stop };
}
