import { useKeepAwake } from 'expo-keep-awake';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCompleteSession, useStartSession } from '@/api/hooks/useSessions';
import { PhysiologicalSigh, isSkiaAvailable } from '@/components/breathing/PhysiologicalSigh';
import { CYCLE_MS, PHASE_COPY, useSighCycle } from '@/components/breathing/useSighCycle';
import { PressableScale } from '@/components/ui/PressableScale';
import { EyeOff, X } from '@/components/ui/icons';
import { useEnergyStore } from '@/store/useEnergyStore';
import { layout, palette } from '@/theme/tokens';

/**
 * Ten cycles is ~81 seconds of breathing (FE-201). Long enough to shift state,
 * and the round number the acceptance criteria count for the session record.
 */
const TARGET_CYCLES = 10;

/**
 * Fullscreen somatic-breathing session.
 *
 * The screen is intentionally almost empty: an orb, one line of instruction, a
 * dot counter. No progress bar, nothing to measure -- anything that invites the
 * eye to track progress pulls the user out of the exercise.
 *
 * "Заплющити очі" takes that to its conclusion: the screen goes fully black and
 * the exercise is driven by vibration alone, which is the point of a practice
 * meant to be done without looking at a phone.
 */
export default function BreathingModal() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // A cycle passes with no touch input, so the OS would otherwise dim the screen
  // mid-hold.
  useKeepAwake();

  const recordBreathCycle = useEnergyStore((s) => s.recordBreathCycle);
  const { mutateAsync: startSession } = useStartSession();
  const { mutate: completeSessionRow } = useCompleteSession();

  const sessionIdRef = useRef<string | null>(null);
  const [eyesClosed, setEyesClosed] = useState(false);
  const [showEyesHint, setShowEyesHint] = useState(false);

  const { lungFullness, glow, phase, completedCycles, isRunning, start, stop } = useSighCycle({
    targetCycles: TARGET_CYCLES,
    onCycleComplete: () => recordBreathCycle(),
    onFinished: () => {
      if (sessionIdRef.current) {
        completeSessionRow(sessionIdRef.current);
        sessionIdRef.current = null;
      }
      // Reveal the screen for the closing beat, then dismiss after the last
      // exhale has landed.
      setEyesClosed(false);
      setTimeout(() => router.back(), 1400);
    },
  });

  const begin = useCallback(async () => {
    // Open the local row first: a somatic_breathing session is recorded even if
    // anything downstream fails.
    sessionIdRef.current = await startSession({
      type: 'somatic_breathing',
      plannedDurationMs: CYCLE_MS * TARGET_CYCLES,
    });
    start();
  }, [start, startSession]);

  // Auto-start: the user tapped "quick reset" to breathe, not to read a button.
  useEffect(() => {
    void begin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = useCallback(() => {
    stop();
    router.back();
  }, [router, stop]);

  const closeEyes = useCallback(() => {
    setEyesClosed(true);
    setShowEyesHint(true);
    // The hint is for the half-second before the eyes actually close; fade it so
    // the screen reaches true black.
    setTimeout(() => setShowEyesHint(false), 2500);
  }, []);

  return (
    <View className="flex-1 items-center justify-center bg-void">
      {/* Close, low-contrast so it does not compete with the orb. */}
      <Pressable
        onPress={dismiss}
        hitSlop={16}
        accessibilityRole="button"
        accessibilityLabel="Завершити вправу"
        style={{ position: 'absolute', top: insets.top + 12, right: 20, zIndex: 10 }}
      >
        <X size={24} strokeWidth={layout.iconStroke} color={palette.inkGhost} />
      </Pressable>

      <PhysiologicalSigh lungFullness={lungFullness} glow={glow} phase={phase} accent={palette.sage} />

      {/* Instruction. Keyed so each phase cross-fades rather than snapping. */}
      <Animated.View key={phase} entering={FadeIn.duration(400)} exiting={FadeOut.duration(250)}>
        <Text className="mt-10 text-center text-[19px] font-light tracking-wide text-ink">
          {PHASE_COPY[phase]}
        </Text>
      </Animated.View>

      {/* Cycle dots: countable at a glance, unreadable as a percentage. */}
      <View className="mt-8 flex-row flex-wrap justify-center gap-2.5" style={{ maxWidth: 220 }}>
        {Array.from({ length: TARGET_CYCLES }).map((_, index) => (
          <View
            key={index}
            className="h-1.5 w-1.5 rounded-pill"
            style={{ backgroundColor: index < completedCycles ? palette.sage : palette.inkGhost }}
          />
        ))}
      </View>

      {/* Eyes-closed entry. Hidden once the session ends. */}
      {isRunning ? (
        <PressableScale onPress={closeEyes} haptic="none" className="mt-10">
          <View className="flex-row items-center rounded-pill border border-hairline px-6 py-3">
            <EyeOff size={16} strokeWidth={layout.iconStroke} color={palette.inkSoft} />
            <Text className="ml-2 text-[14px] font-medium text-ink-soft">Заплющити очі</Text>
          </View>
        </PressableScale>
      ) : null}

      {!isSkiaAvailable ? (
        <Text
          className="absolute px-10 text-center text-[11px] leading-[16px] text-ink-ghost"
          style={{ bottom: insets.bottom + 20 }}
        >
          Запасний рендер. Зберіть dev-клієнт для повного Skia-візуалу.
        </Text>
      ) : null}

      {/* Eyes-closed overlay: true black, vibration-only. A tap brings the visual
          back without stopping the exercise. */}
      {eyesClosed ? (
        <Animated.View
          entering={FadeIn.duration(600)}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 20 }}
        >
          <Pressable
            onPress={() => setEyesClosed(false)}
            accessibilityRole="button"
            accessibilityLabel="Торкніться, щоб показати екран"
            style={{ flex: 1, backgroundColor: palette.void, alignItems: 'center', justifyContent: 'center' }}
          >
            {showEyesHint ? (
              <Animated.Text
                exiting={FadeOut.duration(800)}
                style={{ color: palette.inkGhost, fontSize: 13 }}
              >
                Заплющте очі. Слідуйте за вібрацією.
              </Animated.Text>
            ) : null}
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}
