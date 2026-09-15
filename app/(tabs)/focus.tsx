import { useCallback, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { useCompleteSession, useStartSession } from '@/api/hooks/useSessions';
import { FocusRing } from '@/components/focus/FocusRing';
import { PressableScale } from '@/components/ui/PressableScale';
import { Card, Screen, SectionLabel } from '@/components/ui/Screen';
import { Coffee, Eye, Moon, Pause, Play, X, type LucideIcon } from '@/components/ui/icons';
import { haptics } from '@/lib/haptics';
import { pausePlayback, playSoundscape, stopPlayback } from '@/services/audioPlayer';
import {
  ULTRADIAN,
  clearCompletedTimer,
  formatDuration,
  useCountdown,
  useTimerControls,
  type ActiveTimer,
} from '@/services/timerEngine';
import { SOUNDSCAPE_LABELS, useEnergyStore, type Soundscape } from '@/store/useEnergyStore';
import { accents, layout, palette } from '@/theme/tokens';

const SOUNDSCAPES = Object.keys(SOUNDSCAPE_LABELS) as Soundscape[];

/**
 * Analog rest prompts for the break phase (FE-301 AC3). All screen-free, all
 * optional — the horizon gaze is the one the spec names. One is picked per break
 * by its start minute, so it is stable while a break runs but varies over time.
 */
const REST_HINTS: { icon: LucideIcon; text: string }[] = [
  { icon: Eye, text: 'Подивіться у вікно на обрій 2 хвилини' },
  { icon: Coffee, text: 'Налийте води й повільно випийте' },
  { icon: Moon, text: 'Заплющте очі на хвилину' },
];

/**
 * Ultradian focus: a 90-minute block, then 20 minutes of genuine rest.
 *
 * The countdown is read from `targetEndTimestamp` (FE-301 AC1/AC2), so
 * backgrounding, locking, or an OS kill never changes when the block ends — the
 * number is always derived, never counted, and returning after 40 minutes shows
 * the right time on the first frame with no catch-up ticks.
 *
 * Nothing here blocks: the break is *offered* after a focus block, never forced;
 * the rest hints are informational; the screen is free to dim during a break.
 */
export default function FocusScreen() {
  const { timer, remaining, progress, isRunning, isPaused } = useCountdown(handleComplete);
  const controls = useTimerControls();

  const soundscape = useEnergyStore((s) => s.soundscape);
  const setSoundscape = useEnergyStore((s) => s.setSoundscape);

  const { mutateAsync: startSession } = useStartSession();
  const { mutate: completeSessionRow } = useCompleteSession();

  const sessionIdRef = useRef<string | null>(null);
  // A gentle, dismissible nudge shown after a focus block finishes.
  const [suggestBreak, setSuggestBreak] = useState(false);

  function handleComplete(finished: ActiveTimer) {
    haptics.success();
    if (sessionIdRef.current) {
      completeSessionRow(sessionIdRef.current);
      sessionIdRef.current = null;
    }
    void stopPlayback();
    clearCompletedTimer();
    // Offer the recovery break after focus; clear the offer after a break.
    setSuggestBreak(finished.kind === 'focus');
  }

  const begin = useCallback(
    async (kind: 'focus' | 'break') => {
      setSuggestBreak(false);
      const durationMs = kind === 'focus' ? ULTRADIAN.focusMs : ULTRADIAN.breakMs;
      const label = kind === 'focus' ? 'Блок фокусу' : 'Відпочинок';

      // Open the local row first: if the notification schedule fails (denied
      // permission), the session is still recorded.
      sessionIdRef.current = await startSession({
        type: kind,
        plannedDurationMs: durationMs,
        soundscape: soundscape === 'none' ? undefined : soundscape,
      });

      await controls.start(kind, label, durationMs);

      // A break is for rest, not more input; no bed plays over it.
      if (kind === 'focus') void playSoundscape(soundscape);
    },
    [controls, soundscape, startSession],
  );

  const onCancel = useCallback(async () => {
    await controls.cancel();
    await stopPlayback();
    sessionIdRef.current = null;
    setSuggestBreak(false);
  }, [controls]);

  const isBreak = timer?.kind === 'break';
  const isFocusRunning = isRunning && timer?.kind === 'focus';
  const accent = isBreak ? palette.sage : accents.focus;

  const restHint = useMemo(() => {
    const index = timer ? Math.floor(timer.startedAt / 60000) % REST_HINTS.length : 0;
    // Non-null: REST_HINTS is a statically non-empty array.
    return (REST_HINTS[index] ?? REST_HINTS[0])!;
  }, [timer]);
  const RestIcon = restHint.icon;

  return (
    <Screen title="Фокус" subtitle="90 хвилин праці, 20 хвилин відпочинку.">
      {/* --- Ring --- */}
      <View className="mb-6 items-center">
        <FocusRing
          progress={timer ? progress : 0}
          label={formatDuration(timer ? remaining : ULTRADIAN.focusMs)}
          caption={isBreak ? 'ПЕРЕРВА' : isFocusRunning ? 'ФОКУС' : 'ГОТОВІ'}
          accent={timer ? accent : palette.inkGhost}
          paused={isPaused}
        />
      </View>

      {/* --- Transport --- */}
      {timer ? (
        <View className="mx-5 mb-6 flex-row gap-3">
          {!isBreak ? (
            <ControlButton
              icon={isPaused ? Play : Pause}
              label={isPaused ? 'Продовжити' : 'Пауза'}
              accent={accent}
              onPress={async () => {
                if (isPaused) {
                  await controls.resume();
                  void playSoundscape(soundscape);
                } else {
                  await controls.pause();
                  await pausePlayback();
                }
              }}
            />
          ) : null}
          <ControlButton icon={X} label="Завершити" accent={palette.inkMute} onPress={onCancel} />
        </View>
      ) : (
        <View className="mx-5 mb-6 flex-row gap-3">
          <ControlButton icon={Play} label="90 хв фокусу" accent={accents.focus} onPress={() => void begin('focus')} />
          <ControlButton icon={Coffee} label="20 хв перерва" accent={palette.sage} onPress={() => void begin('break')} />
        </View>
      )}

      {/* --- Break suggestion after a focus block. Dismissible, never forced. --- */}
      {suggestBreak && !timer ? (
        <PressableScale onPress={() => void begin('break')} haptic="none">
          <Card className="mb-6">
            <View className="flex-row items-center">
              <View
                className="h-11 w-11 items-center justify-center rounded-pill"
                style={{ backgroundColor: `${palette.sage}1F` }}
              >
                <Coffee size={20} strokeWidth={layout.iconStroke} color={palette.sage} />
              </View>
              <View className="ml-4 flex-1">
                <Text className="text-[15px] font-semibold text-ink">Блок завершено — час на перерву?</Text>
                <Text className="mt-0.5 text-[13px] text-ink-soft">20 хвилин, щоб відновитися.</Text>
              </View>
              <PressableScale onPress={() => setSuggestBreak(false)} hitSlop={12}>
                <X size={18} strokeWidth={layout.iconStroke} color={palette.inkMute} />
              </PressableScale>
            </View>
          </Card>
        </PressableScale>
      ) : null}

      {/* --- Rest phase: analog hint + a soft screen-off suggestion (AC3). --- */}
      {isBreak ? (
        <>
          <SectionLabel>Відпочинок</SectionLabel>
          <Card className="mb-4">
            <View className="flex-row items-start">
              <View
                className="h-11 w-11 items-center justify-center rounded-pill"
                style={{ backgroundColor: `${palette.sage}1F` }}
              >
                <RestIcon size={20} strokeWidth={layout.iconStroke} color={palette.sage} />
              </View>
              <View className="ml-4 flex-1">
                <Text className="text-[16px] font-semibold leading-[22px] text-ink">{restHint.text}</Text>
                <Text className="mt-1.5 text-[13px] leading-[19px] text-ink-mute">
                  Можна вимкнути екран — ми сповістимо, коли перерва завершиться.
                </Text>
              </View>
            </View>
          </Card>
        </>
      ) : null}

      {/* --- Soundscape: focus and idle only; a break stays quiet. --- */}
      {!isBreak ? (
        <>
          <SectionLabel>Звук</SectionLabel>
          <View className="mx-5 flex-row flex-wrap gap-2">
            {SOUNDSCAPES.map((option) => {
              const selected = soundscape === option;
              return (
                <PressableScale
                  key={option}
                  onPress={() => {
                    setSoundscape(option);
                    if (isFocusRunning) void playSoundscape(option);
                  }}
                  scaleTo={0.94}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <View
                    className="rounded-pill border px-4 py-2.5"
                    style={{
                      borderColor: selected ? accents.focus : palette.hairline,
                      backgroundColor: selected ? `${accents.focus}1F` : 'transparent',
                    }}
                  >
                    <Text className="text-[13px] font-medium" style={{ color: selected ? accents.focus : palette.inkSoft }}>
                      {SOUNDSCAPE_LABELS[option]}
                    </Text>
                  </View>
                </PressableScale>
              );
            })}
          </View>
        </>
      ) : null}

      <Text className="mx-5 mt-4 text-[12px] leading-[18px] text-ink-mute">
        Таймер завершиться вчасно, навіть якщо згорнути додаток або вимкнути екран — ми надішлемо
        сповіщення.
      </Text>
    </Screen>
  );
}

function ControlButton({
  icon: Icon,
  label,
  accent,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  accent: string;
  onPress: () => void | Promise<void>;
}) {
  return (
    <PressableScale className="flex-1" onPress={() => void onPress()} scaleTo={0.96}>
      <View
        className="flex-row items-center justify-center rounded-card border py-4"
        style={{ borderColor: `${accent}55`, backgroundColor: `${accent}14` }}
      >
        <Icon size={17} strokeWidth={layout.iconStroke} color={accent} />
        <Text className="ml-2 text-[14px] font-semibold" style={{ color: accent }}>
          {label}
        </Text>
      </View>
    </PressableScale>
  );
}
