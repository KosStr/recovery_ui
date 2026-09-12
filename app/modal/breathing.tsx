import { useKeepAwake } from 'expo-keep-awake';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCompleteSession, useStartSession } from '@/api/hooks/useSessions';
import {
  PhysiologicalSigh,
  isSkiaAvailable,
} from '@/components/breathing/PhysiologicalSigh';
import { CYCLE_MS, PHASE_COPY, useSighCycle } from '@/components/breathing/useSighCycle';
import { PressableScale } from '@/components/ui/PressableScale';
import { X } from '@/components/ui/icons';
import { useEnergyStore } from '@/store/useEnergyStore';
import { layout, palette } from '@/theme/tokens';

/** Five cycles at 8.7s each is about 45 seconds -- long enough to shift state,
 *  short enough that nobody bails halfway. */
const TARGET_CYCLES = 5;

/**
 * Fullscreen breathing session.
 *
 * The screen is intentionally almost empty: an orb, one line of instruction,
 * and a dot counter. No timer, no progress bar, nothing to check. Anything that
 * invites the eye to measure progress pulls the user out of the exercise.
 */
export default function BreathingModal() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // A cycle is ~9 seconds with no touch input, which is well inside the default
  // auto-lock. Without this the screen dims mid-exhale.
  useKeepAwake();

  const recordBreathCycle = useEnergyStore((s) => s.recordBreathCycle);
  const { mutateAsync: startSession } = useStartSession();
  const { mutate: completeSessionRow } = useCompleteSession();

  const sessionIdRef = useRef<string | null>(null);

  const { lungFullness, phase, completedCycles, isRunning, start, stop } = useSighCycle({
    targetCycles: TARGET_CYCLES,
    onCycleComplete: () => recordBreathCycle(),
    onFinished: () => {
      if (sessionIdRef.current) {
        completeSessionRow(sessionIdRef.current);
        sessionIdRef.current = null;
      }
      // Let the final exhale land before dismissing.
      setTimeout(() => router.back(), 1400);
    },
  });

  const begin = useCallback(async () => {
    sessionIdRef.current = await startSession({
      type: 'breathing',
      plannedDurationMs: CYCLE_MS * TARGET_CYCLES,
    });
    start();
  }, [start, startSession]);

  // Auto-start: the user tapped "quick reset" to breathe, not to read a
  // start button. One less decision between intent and action.
  useEffect(() => {
    void begin();
    // Deliberately once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = useCallback(() => {
    stop();
    router.back();
  }, [router, stop]);

  return (
    <View className="flex-1 items-center justify-center bg-void">
      {/* Close, kept small and low-contrast so it does not compete with the orb. */}
      <Pressable
        onPress={dismiss}
        hitSlop={16}
        accessibilityRole="button"
        accessibilityLabel="End breathing session"
        style={{ position: 'absolute', top: insets.top + 12, right: 20, zIndex: 10 }}
      >
        <X size={24} strokeWidth={layout.iconStroke} color={palette.inkGhost} />
      </Pressable>

      <PhysiologicalSigh lungFullness={lungFullness} phase={phase} accent={palette.sage} />

      {/* Instruction. Keyed so each phase cross-fades rather than snapping. */}
      <Animated.View key={phase} entering={FadeIn.duration(400)} exiting={FadeOut.duration(250)}>
        <Text className="mt-10 text-center text-[19px] font-light tracking-wide text-ink">
          {PHASE_COPY[phase]}
        </Text>
      </Animated.View>

      {/* Cycle dots: countable at a glance, unreadable as a percentage. */}
      <View className="mt-8 flex-row gap-2.5">
        {Array.from({ length: TARGET_CYCLES }).map((_, index) => (
          <View
            key={index}
            className="h-1.5 w-1.5 rounded-pill"
            style={{
              backgroundColor: index < completedCycles ? palette.sage : palette.inkGhost,
            }}
          />
        ))}
      </View>

      {!isRunning && completedCycles === 0 ? (
        <PressableScale onPress={() => void begin()} className="mt-12">
          <View className="rounded-pill border border-hairline px-8 py-3.5">
            <Text className="text-[14px] font-medium text-ink-soft">Begin</Text>
          </View>
        </PressableScale>
      ) : null}

      {!isSkiaAvailable ? (
        <Text
          className="absolute px-10 text-center text-[11px] leading-[16px] text-ink-ghost"
          style={{ bottom: insets.bottom + 20 }}
        >
          Running the fallback renderer. Build a dev client for the full Skia visual.
        </Text>
      ) : null}
    </View>
  );
}
