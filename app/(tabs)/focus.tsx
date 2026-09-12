import { useCallback, useRef } from 'react';
import { Text, View } from 'react-native';

import { useCompleteSession, useStartSession } from '@/api/hooks/useSessions';
import { PressableScale } from '@/components/ui/PressableScale';
import { Card, Screen, SectionLabel } from '@/components/ui/Screen';
import { Coffee, Pause, Play, X, type LucideIcon } from '@/components/ui/icons';
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
import {
  SOUNDSCAPE_LABELS,
  useEnergyStore,
  type Soundscape,
} from '@/store/useEnergyStore';
import { accents, layout, palette } from '@/theme/tokens';

const SOUNDSCAPES = Object.keys(SOUNDSCAPE_LABELS) as Soundscape[];

/**
 * Ultradian focus: a 90-minute block, then 20 minutes of genuine rest.
 *
 * The countdown is read from `targetEndTimestamp`, so backgrounding the app,
 * locking the phone, or having the OS kill the process entirely does not change
 * when the block ends. The number on screen is always derived, never counted.
 */
export default function FocusScreen() {
  const { timer, remaining, progress, isRunning, isPaused } = useCountdown(handleComplete);
  const controls = useTimerControls();

  const soundscape = useEnergyStore((s) => s.soundscape);
  const setSoundscape = useEnergyStore((s) => s.setSoundscape);

  const { mutateAsync: startSession } = useStartSession();
  const { mutate: completeSessionRow } = useCompleteSession();

  // The SQLite row id for the block currently running, so completion can close
  // the same row the start opened.
  const sessionIdRef = useRef<string | null>(null);

  function handleComplete(finished: ActiveTimer) {
    haptics.success();
    if (sessionIdRef.current) {
      completeSessionRow(sessionIdRef.current);
      sessionIdRef.current = null;
    }
    void stopPlayback();
    clearCompletedTimer();
    void finished;
  }

  const begin = useCallback(
    async (kind: 'focus' | 'break') => {
      const durationMs = kind === 'focus' ? ULTRADIAN.focusMs : ULTRADIAN.breakMs;
      const label = kind === 'focus' ? 'Deep work block' : 'Recovery break';

      // Open the local row first: if the notification schedule fails (denied
      // permission), the session is still recorded.
      sessionIdRef.current = await startSession({
        type: kind,
        plannedDurationMs: durationMs,
        soundscape: soundscape === 'none' ? undefined : soundscape,
      });

      await controls.start(kind, label, durationMs);

      // A break is for rest, not for more input; no bed plays over it.
      if (kind === 'focus') void playSoundscape(soundscape);
    },
    [controls, soundscape, startSession],
  );

  const onCancel = useCallback(async () => {
    await controls.cancel();
    await stopPlayback();
    sessionIdRef.current = null;
  }, [controls]);

  const accent = timer?.kind === 'break' ? palette.sage : accents.focus;

  return (
    <Screen title="Focus" subtitle="Ninety minutes on, twenty minutes off.">
      {/* --- Countdown --- */}
      <Card className="mb-6 items-center py-8">
        <Text className="text-[11px] uppercase tracking-[1.6px] text-ink-mute">
          {timer ? timer.label : 'No block running'}
        </Text>

        <Text
          className="mt-3 text-[64px] font-extralight tracking-tighter"
          style={{ color: timer ? accent : palette.inkGhost, fontVariant: ['tabular-nums'] }}
        >
          {formatDuration(timer ? remaining : ULTRADIAN.focusMs)}
        </Text>

        {/* Progress as a single hairline rule rather than a ring: less to look
            at, and it reads correctly at a glance from across a desk. */}
        <View className="mt-5 h-[3px] w-full overflow-hidden rounded-pill bg-hairline">
          <View
            className="h-full rounded-pill"
            style={{ width: `${Math.round(progress * 100)}%`, backgroundColor: accent }}
          />
        </View>

        {isPaused ? (
          <Text className="mt-4 text-[13px] text-amber">Paused</Text>
        ) : null}
      </Card>

      {/* --- Transport --- */}
      {timer ? (
        <View className="mx-5 mb-6 flex-row gap-3">
          <ControlButton
            icon={isPaused ? Play : Pause}
            label={isPaused ? 'Resume' : 'Pause'}
            accent={accent}
            onPress={async () => {
              if (isPaused) {
                await controls.resume();
                if (timer.kind === 'focus') void playSoundscape(soundscape);
              } else {
                await controls.pause();
                await pausePlayback();
              }
            }}
          />
          <ControlButton icon={X} label="End" accent={palette.inkMute} onPress={onCancel} />
        </View>
      ) : (
        <View className="mx-5 mb-6 flex-row gap-3">
          <ControlButton
            icon={Play}
            label="90 min focus"
            accent={accents.focus}
            onPress={() => void begin('focus')}
          />
          <ControlButton
            icon={Coffee}
            label="20 min break"
            accent={palette.sage}
            onPress={() => void begin('break')}
          />
        </View>
      )}

      {/* --- Soundscape --- */}
      <SectionLabel>Soundscape</SectionLabel>
      <View className="mx-5 flex-row flex-wrap gap-2">
        {SOUNDSCAPES.map((option) => {
          const selected = soundscape === option;
          return (
            <PressableScale
              key={option}
              onPress={() => {
                setSoundscape(option);
                // Swap the bed live so the choice is audible immediately, but
                // only while a focus block is actually running.
                if (isRunning && timer?.kind === 'focus') void playSoundscape(option);
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
                <Text
                  className="text-[13px] font-medium"
                  style={{ color: selected ? accents.focus : palette.inkSoft }}
                >
                  {SOUNDSCAPE_LABELS[option]}
                </Text>
              </View>
            </PressableScale>
          );
        })}
      </View>

      <Text className="mx-5 mt-4 text-[12px] leading-[18px] text-ink-mute">
        Audio keeps playing with the screen off and appears on the lock screen. The block finishes
        on time even if you close the app.
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
