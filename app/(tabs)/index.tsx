import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Text, View } from 'react-native';

import { useFocusMinutesToday, useSyncPendingMutations } from '@/api/hooks/useSessions';
import { EnergyCheckin } from '@/components/energy/EnergyCheckin';
import { Card, Screen, SectionLabel } from '@/components/ui/Screen';
import { ChevronRight, Circle } from '@/components/ui/icons';
import { PressableScale } from '@/components/ui/PressableScale';
import { formatDuration, useCountdown } from '@/services/timerEngine';
import { useBreathCycles, useTodayAverage } from '@/store/useEnergyStore';
import { accents, layout, palette } from '@/theme/tokens';

/**
 * Home / Energy tab.
 *
 * The check-in is the first thing on screen and takes one tap (FE-202). Any
 * friction here and the data stops arriving, which makes every downstream
 * insight worthless.
 */
export default function TodayScreen() {
  const router = useRouter();
  const breathCycles = useBreathCycles();
  const todayAverage = useTodayAverage();

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
      <SectionLabel>Скільки залишилось заряду?</SectionLabel>
      <EnergyCheckin />

      {/* --- Active block, only when there is one --- */}
      {isRunning && timer ? (
        <>
          <SectionLabel>Активна сесія</SectionLabel>
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
      <SectionLabel>Швидке відновлення</SectionLabel>
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
              <Text className="text-[17px] font-semibold text-ink">Фізіологічний подих</Text>
              <Text className="mt-0.5 text-[13px] text-ink-soft">
                Два вдихи, довгий видих. Близько 80 секунд.
              </Text>
            </View>
            <ChevronRight size={20} strokeWidth={layout.iconStroke} color={palette.inkMute} />
          </View>
        </Card>
      </PressableScale>

      {/* --- Day at a glance --- */}
      <SectionLabel>Сьогодні</SectionLabel>
      <View className="mx-5 flex-row gap-3">
        <Stat label="Фокус" value={`${focusMinutes}`} unit="хв" accent={accents.focus} />
        <Stat label="Дихання" value={`${breathCycles}`} unit="циклів" accent={palette.sage} />
        <Stat
          label="Енергія"
          value={todayAverage != null ? `${todayAverage}` : '—'}
          unit="середнє"
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
  if (hour < 5) return 'Ще не спите';
  if (hour < 12) return 'Доброго ранку';
  if (hour < 18) return 'Добрий день';
  return 'Добрий вечір';
}

function todaysDate(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}
