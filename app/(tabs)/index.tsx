import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Text, View } from 'react-native';

import { useFocusMinutesToday, useSyncPendingMutations } from '@/api/hooks/useSessions';
import { PressableScale } from '@/components/ui/PressableScale';
import { Card, Screen, SectionLabel } from '@/components/ui/Screen';
import { ChevronRight, Circle } from '@/components/ui/icons';
import { formatDuration, useCountdown } from '@/services/timerEngine';
import {
  ENERGY_LABELS,
  useBreathCycles,
  useEnergyStore,
  type EnergyScore,
} from '@/store/useEnergyStore';
import { accents, layout, palette } from '@/theme/tokens';

const SCORES: EnergyScore[] = [1, 2, 3, 4, 5];

/**
 * Today: one honest number, then the shortest path to changing it.
 *
 * The check-in is deliberately the first thing on screen and takes one tap. Any
 * friction here and the data stops arriving, which makes every downstream
 * insight worthless.
 */
export default function TodayScreen() {
  const router = useRouter();
  const todayScore = useEnergyStore((s) => s.todayScore);
  const setEnergy = useEnergyStore((s) => s.setEnergy);
  const breathCycles = useBreathCycles();

  const { data: focusMinutes = 0 } = useFocusMinutesToday();
  const { timer, remaining, isRunning } = useCountdown();
  const { mutate: sync } = useSyncPendingMutations();

  // Drain anything written while offline once the dashboard is up. Deferred to
  // an effect so it never delays the first paint.
  useEffect(() => {
    sync();
  }, [sync]);

  return (
    <Screen title={greeting()} subtitle={todaysDate()}>
      {/* --- Energy check-in --- */}
      <SectionLabel>How much is in the tank?</SectionLabel>
      <Card className="mb-6">
        <View className="flex-row justify-between">
          {SCORES.map((score) => {
            const selected = todayScore === score;
            return (
              <PressableScale
                key={score}
                onPress={() => void setEnergy(score)}
                scaleTo={0.9}
                className="items-center"
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${ENERGY_LABELS[score]}, ${score} of 5`}
              >
                <View
                  className="h-14 w-14 items-center justify-center rounded-pill border"
                  style={{
                    borderColor: selected ? accents.today : palette.hairline,
                    // A filled swatch at 12% keeps the selection legible without
                    // lighting up a large area at night.
                    backgroundColor: selected ? `${accents.today}1F` : 'transparent',
                  }}
                >
                  <Text
                    className="text-[19px] font-semibold"
                    style={{ color: selected ? accents.today : palette.inkMute }}
                  >
                    {score}
                  </Text>
                </View>
              </PressableScale>
            );
          })}
        </View>

        <Text className="mt-4 text-center text-[13px] text-ink-soft">
          {todayScore
            ? ENERGY_LABELS[todayScore]
            : 'Tap a number. One reading a day is plenty.'}
        </Text>
      </Card>

      {/* --- Active block, only when there is one --- */}
      {isRunning && timer ? (
        <>
          <SectionLabel>In progress</SectionLabel>
          <PressableScale onPress={() => router.push('/(tabs)/focus')} haptic="none">
            <Card className="mb-6">
              <View className="flex-row items-center justify-between">
                <View>
                  <Text className="text-[13px] text-ink-soft">{timer.label}</Text>
                  <Text
                    className="mt-1 text-[34px] font-light tracking-tight"
                    style={{ color: accents.focus, fontVariant: ['tabular-nums'] }}
                  >
                    {formatDuration(remaining)}
                  </Text>
                </View>
                <ChevronRight size={20} strokeWidth={layout.iconStroke} color={palette.inkMute} />
              </View>
            </Card>
          </PressableScale>
        </>
      ) : null}

      {/* --- Quick reset --- */}
      <SectionLabel>Quick reset</SectionLabel>
      <PressableScale onPress={() => router.push('/modal/breathing')} haptic="none">
        <Card className="mb-6">
          <View className="flex-row items-center">
            <View
              className="h-12 w-12 items-center justify-center rounded-pill"
              style={{ backgroundColor: `${palette.sage}1F` }}
            >
              <Circle size={22} strokeWidth={layout.iconStroke} color={palette.sage} />
            </View>
            <View className="ml-4 flex-1">
              <Text className="text-[17px] font-semibold text-ink">Physiological sigh</Text>
              <Text className="mt-0.5 text-[13px] text-ink-soft">
                Two inhales, one long exhale. About 45 seconds.
              </Text>
            </View>
            <ChevronRight size={20} strokeWidth={layout.iconStroke} color={palette.inkMute} />
          </View>
        </Card>
      </PressableScale>

      {/* --- Day at a glance --- */}
      <SectionLabel>Today so far</SectionLabel>
      <View className="mx-5 flex-row gap-3">
        <Stat label="Focus" value={`${focusMinutes}`} unit="min" accent={accents.focus} />
        <Stat label="Breaths" value={`${breathCycles}`} unit="cycles" accent={palette.sage} />
        <Stat
          label="Energy"
          value={todayScore ? `${todayScore}` : '—'}
          unit="of 5"
          accent={accents.today}
        />
      </View>
    </Screen>
  );
}

function Stat({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string;
  unit: string;
  accent: string;
}) {
  return (
    <View className="flex-1 rounded-card border border-hairline bg-surface p-4">
      <Text className="text-[11px] uppercase tracking-[1.2px] text-ink-mute">{label}</Text>
      <Text
        className="mt-2 text-[26px] font-light"
        style={{ color: accent, fontVariant: ['tabular-nums'] }}
      >
        {value}
      </Text>
      <Text className="text-[11px] text-ink-mute">{unit}</Text>
    </View>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Morning';
  if (hour < 18) return 'Afternoon';
  return 'Evening';
}

function todaysDate(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}
