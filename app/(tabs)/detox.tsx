import { useCallback, useMemo } from 'react';
import { Text, View } from 'react-native';

import { useStartSession } from '@/api/hooks/useSessions';
import { PressableScale } from '@/components/ui/PressableScale';
import { Card, Screen, SectionLabel } from '@/components/ui/Screen';
import { CupSoda, Eye, Footprints, Leaf, PenLine, Smartphone, Wrench } from '@/components/ui/icons';
import { haptics } from '@/lib/haptics';
import { stopPlayback } from '@/services/audioPlayer';
import {
  clearCompletedTimer,
  formatDuration,
  useCountdown,
  useTimerControls,
} from '@/services/timerEngine';
import { useEnergyStore } from '@/store/useEnergyStore';
import { accents, layout, palette } from '@/theme/tokens';

const DURATIONS = [
  { label: '20 min', ms: 20 * 60 * 1000 },
  { label: '1 hour', ms: 60 * 60 * 1000 },
  { label: '3 hours', ms: 3 * 60 * 60 * 1000 },
] as const;

/**
 * Analog quests: something to do with the hands while the phone is away.
 *
 * Every one is deliberately unrecordable -- no photo, no log, nothing to post.
 * A quest that produces a shareable artefact defeats the purpose.
 */
const MICRO_QUESTS = [
  { icon: Footprints, title: 'Walk one block without headphones', detail: 'Notice five sounds you cannot normally hear.' },
  { icon: PenLine, title: 'Write half a page by hand', detail: 'Anything. Legibility optional.' },
  { icon: Eye, title: 'Look at something 20 metres away', detail: 'Two minutes. Let the ciliary muscle unclench.' },
  { icon: CupSoda, title: 'Make a drink slowly', detail: 'No podcast, no second screen. Just the kettle.' },
  { icon: Leaf, title: 'Step outside and find the horizon', detail: 'Panoramic vision lowers arousal within a minute.' },
  { icon: Wrench, title: 'Fix one small broken thing', detail: 'The drawer, the button, the wobbly leg.' },
] as const;

export default function DetoxScreen() {
  const { timer, remaining, progress, isRunning } = useCountdown(handleComplete);
  const controls = useTimerControls();

  const detoxArmed = useEnergyStore((s) => s.detoxArmed);
  const armDetox = useEnergyStore((s) => s.armDetox);
  const releaseDetox = useEnergyStore((s) => s.releaseDetox);
  const { mutateAsync: startSession } = useStartSession();

  const isDetoxRunning = isRunning && timer?.kind === 'detox';

  function handleComplete() {
    releaseDetox();
    haptics.success();
    clearCompletedTimer();
  }

  const begin = useCallback(
    async (durationMs: number, label: string) => {
      await startSession({ type: 'detox', plannedDurationMs: durationMs });
      // Silence first: a detox window with a soundscape still running is not one.
      await stopPlayback();
      armDetox();
      await controls.start('detox', `Screen-free · ${label}`, durationMs);
    },
    [armDetox, controls, startSession],
  );

  const endEarly = useCallback(async () => {
    await controls.cancel();
    releaseDetox();
    haptics.warn();
  }, [controls, releaseDetox]);

  // One quest per window, chosen by the hour so it is stable across re-renders
  // but different each time the user comes back.
  const quest = useMemo(() => {
    const index = new Date().getHours() % MICRO_QUESTS.length;
    return MICRO_QUESTS[index] ?? MICRO_QUESTS[0];
  }, []);

  // Lucide icons are components, so the binding has to be capitalised before
  // it can be used as a JSX tag.
  const QuestIcon = quest.icon;

  return (
    <Screen title="Detox" subtitle="Put it down. Nothing here needs you.">
      {isDetoxRunning && timer ? (
        <>
          <Card className="mb-6 items-center py-8">
            <Text className="text-[11px] uppercase tracking-[1.6px] text-ink-mute">
              Screen-free
            </Text>
            <Text
              className="mt-3 text-[64px] font-extralight tracking-tighter"
              style={{ color: accents.detox, fontVariant: ['tabular-nums'] }}
            >
              {formatDuration(remaining)}
            </Text>
            <View className="mt-5 h-[3px] w-full overflow-hidden rounded-pill bg-hairline">
              <View
                className="h-full rounded-pill"
                style={{
                  width: `${Math.round(progress * 100)}%`,
                  backgroundColor: accents.detox,
                }}
              />
            </View>
            <Text className="mt-5 text-center text-[13px] leading-[19px] text-ink-soft">
              We will send one notification when the window closes. Until then there is nothing to
              check.
            </Text>
          </Card>

          <PressableScale onPress={() => void endEarly()} className="mx-5 mb-6">
            <View className="items-center rounded-card border border-hairline py-4">
              <Text className="text-[14px] font-medium text-ink-mute">End early</Text>
            </View>
          </PressableScale>
        </>
      ) : (
        <>
          <SectionLabel>Go screen-free</SectionLabel>
          <View className="mx-5 mb-6 flex-row gap-3">
            {DURATIONS.map((option) => (
              <PressableScale
                key={option.label}
                className="flex-1"
                onPress={() => void begin(option.ms, option.label)}
                scaleTo={0.95}
              >
                <View
                  className="items-center rounded-card border py-5"
                  style={{
                    borderColor: `${accents.detox}55`,
                    backgroundColor: `${accents.detox}14`,
                  }}
                >
                  <Smartphone size={19} strokeWidth={layout.iconStroke} color={accents.detox} />
                  <Text
                    className="mt-2 text-[14px] font-semibold"
                    style={{ color: accents.detox }}
                  >
                    {option.label}
                  </Text>
                </View>
              </PressableScale>
            ))}
          </View>
        </>
      )}

      {/* --- Micro-quest --- */}
      <SectionLabel>Analog micro-quest</SectionLabel>
      <Card className="mb-6">
        <View className="flex-row items-start">
          <View
            className="h-12 w-12 items-center justify-center rounded-pill"
            style={{ backgroundColor: `${accents.detox}1F` }}
          >
            <QuestIcon size={22} strokeWidth={layout.iconStroke} color={accents.detox} />
          </View>
          <View className="ml-4 flex-1">
            <Text className="text-[16px] font-semibold leading-[22px] text-ink">
              {quest.title}
            </Text>
            <Text className="mt-1 text-[13px] leading-[19px] text-ink-soft">{quest.detail}</Text>
          </View>
        </View>
      </Card>

      <SectionLabel>Other things to do with your hands</SectionLabel>
      <View className="mx-5 gap-2">
        {MICRO_QUESTS.filter((q) => q.title !== quest.title).map((item) => {
          const ItemIcon = item.icon;
          return (
            <View
              key={item.title}
              className="flex-row items-center rounded-card border border-hairline bg-surface px-4 py-3.5"
            >
              <ItemIcon size={17} strokeWidth={layout.iconStroke} color={palette.inkMute} />
              <Text className="ml-3 flex-1 text-[14px] text-ink-soft">{item.title}</Text>
            </View>
          );
        })}
      </View>

      {detoxArmed && !isDetoxRunning ? (
        <Text className="mx-5 mt-4 text-[12px] text-amber">
          Detox mode is armed but no timer is running. Pick a duration above.
        </Text>
      ) : null}
    </Screen>
  );
}
