import { useMemo } from 'react';
import { Text, View } from 'react-native';

import { useCompletedRituals, useToggleRitual } from '@/api/hooks/useSessions';
import { PressableScale } from '@/components/ui/PressableScale';
import { Card, Screen, SectionLabel } from '@/components/ui/Screen';
import { Check, CircleX, Coffee, Play } from '@/components/ui/icons';
import { NSDR_TRACKS, playNsdr } from '@/services/audioPlayer';
import { StorageKeys, storage } from '@/services/storage';
import { accents, layout, palette } from '@/theme/tokens';

/** Steps are keyed, not indexed, so reordering the list never orphans history. */
const WIND_DOWN_RITUAL = [
  { key: 'screens-off', label: 'Screens down', detail: 'Phone out of the bedroom, or face down and charging.' },
  { key: 'lights-low', label: 'Lights below eye level', detail: 'Overheads off. Lamps only.' },
  { key: 'temperature', label: 'Room cooled', detail: 'Core temperature has to drop for sleep onset.' },
  { key: 'tomorrow', label: 'Tomorrow written down', detail: 'Get the open loops out of your head and onto paper.' },
  { key: 'nsdr', label: 'NSDR or breathing', detail: 'Ten minutes is enough to shift state.' },
] as const;

/**
 * Sleep: the hour before bed, treated as the actual intervention.
 *
 * Caffeine's half-life runs six-ish hours, so the cutoff is derived by working
 * backwards from target bedtime rather than asking the user to pick a time they
 * would only guess at.
 */
const CAFFEINE_CLEARANCE_HOURS = 10;
const DEFAULT_BEDTIME_HOUR = 23;

export default function SleepScreen() {
  const { data: completed = [] } = useCompletedRituals();
  const { mutate: toggle } = useToggleRitual();

  const bedtimeHour =
    storage.getJSON<number>(StorageKeys.caffeineCutoff, DEFAULT_BEDTIME_HOUR) ??
    DEFAULT_BEDTIME_HOUR;

  const caffeine = useMemo(() => computeCaffeineWindow(bedtimeHour), [bedtimeHour]);

  const done = completed.length;
  const total = WIND_DOWN_RITUAL.length;

  return (
    <Screen title="Sleep" subtitle="The wind-down matters more than the bedtime.">
      {/* --- Caffeine cutoff --- */}
      <SectionLabel>Caffeine</SectionLabel>
      <Card className="mb-6">
        <View className="flex-row items-center justify-between">
          <View className="flex-1">
            <Text className="text-[13px] text-ink-soft">
              {caffeine.passed ? 'Cutoff passed' : 'Last coffee by'}
            </Text>
            <Text
              className="mt-1 text-[34px] font-light tracking-tight"
              style={{
                color: caffeine.passed ? palette.inkMute : accents.today,
                fontVariant: ['tabular-nums'],
              }}
            >
              {caffeine.cutoffLabel}
            </Text>
            <Text className="mt-1 text-[12px] text-ink-mute">
              {caffeine.passed
                ? `Anything now is still ~${CAFFEINE_CLEARANCE_HOURS}h clearing at bedtime.`
                : `${caffeine.hoursLeft}h ${caffeine.minutesLeft}m left in the window.`}
            </Text>
          </View>
          {caffeine.passed ? (
            <CircleX size={30} strokeWidth={layout.iconStroke} color={palette.inkGhost} />
          ) : (
            <Coffee size={30} strokeWidth={layout.iconStroke} color={accents.today} />
          )}
        </View>
      </Card>

      {/* --- Wind-down ritual --- */}
      <SectionLabel>{`Wind-down · ${done} of ${total}`}</SectionLabel>
      <View className="mx-5 mb-6 overflow-hidden rounded-card border border-hairline bg-surface">
        {WIND_DOWN_RITUAL.map((step, index) => {
          const checked = completed.includes(step.key);
          return (
            <PressableScale
              key={step.key}
              onPress={() => toggle(step.key)}
              scaleTo={0.99}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
            >
              <View
                className={`flex-row items-center px-5 py-4 ${
                  index > 0 ? 'border-t border-hairline' : ''
                }`}
              >
                <View
                  className="h-6 w-6 items-center justify-center rounded-pill border"
                  style={{
                    borderColor: checked ? accents.sleep : palette.inkGhost,
                    backgroundColor: checked ? accents.sleep : 'transparent',
                  }}
                >
                  {checked ? <Check size={14} strokeWidth={2.5} color={palette.void} /> : null}
                </View>
                <View className="ml-4 flex-1">
                  <Text
                    className="text-[15px] font-medium"
                    style={{ color: checked ? palette.inkMute : palette.ink }}
                  >
                    {step.label}
                  </Text>
                  <Text className="mt-0.5 text-[12px] text-ink-mute">{step.detail}</Text>
                </View>
              </View>
            </PressableScale>
          );
        })}
      </View>

      {/* --- NSDR --- */}
      <SectionLabel>Non-sleep deep rest</SectionLabel>
      <View className="mx-5 gap-3">
        {NSDR_TRACKS.map((track) => (
          <PressableScale key={track.title} onPress={() => void playNsdr(track)} scaleTo={0.98}>
            <View className="flex-row items-center rounded-card border border-hairline bg-surface p-4">
              <View
                className="h-11 w-11 items-center justify-center rounded-pill"
                style={{ backgroundColor: `${accents.sleep}1F` }}
              >
                <Play size={17} strokeWidth={layout.iconStroke} color={accents.sleep} />
              </View>
              <View className="ml-4 flex-1">
                <Text className="text-[15px] font-medium text-ink">{track.title}</Text>
                <Text className="mt-0.5 text-[12px] text-ink-mute">{track.artist}</Text>
              </View>
            </View>
          </PressableScale>
        ))}
      </View>

      <Text className="mx-5 mt-4 text-[12px] leading-[18px] text-ink-mute">
        NSDR continues with the screen off. Lock the phone once it starts.
      </Text>
    </Screen>
  );
}

function computeCaffeineWindow(bedtimeHour: number) {
  const now = new Date();

  const cutoff = new Date(now);
  cutoff.setHours(bedtimeHour - CAFFEINE_CLEARANCE_HOURS, 0, 0, 0);

  // Before the cutoff hour on a given day the window is still today's; after
  // midnight-adjacent bedtimes it can land yesterday, so roll forward a day
  // rather than reporting a negative window.
  if (cutoff.getTime() < now.getTime() - 18 * 60 * 60 * 1000) {
    cutoff.setDate(cutoff.getDate() + 1);
  }

  const deltaMs = cutoff.getTime() - now.getTime();
  const passed = deltaMs <= 0;

  return {
    passed,
    cutoffLabel: cutoff.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
    hoursLeft: Math.max(0, Math.floor(deltaMs / 3_600_000)),
    minutesLeft: Math.max(0, Math.floor((deltaMs % 3_600_000) / 60_000)),
  };
}
