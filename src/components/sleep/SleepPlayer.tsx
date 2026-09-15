import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { PressableScale } from '@/components/ui/PressableScale';
import { Card, SectionLabel } from '@/components/ui/Screen';
import { MoonStar, Pause, Play, Timer, Volume2, X } from '@/components/ui/icons';
import {
  NSDR_TRACKS,
  SOUNDSCAPES,
  addPlaybackListener,
  getIsPlaying,
  isAudioAvailable,
  playNsdr,
  playSoundscape,
  stopPlayback,
  togglePlayback,
} from '@/services/audioPlayer';
import { useSleepTimer } from '@/services/sleepTimer';
import { formatDuration } from '@/services/timerEngine';
import type { Soundscape } from '@/store/useEnergyStore';
import { layout, palette } from '@/theme/tokens';

const ACCENT = palette.indigoGlow;

/** Ukrainian display names; the ids and files stay as they are on disk. */
const NSDR_UK = ['NSDR · 10 хв', 'NSDR · 20 хв', 'Йога-нідра · 30 хв'];
const SOUNDSCAPE_UK: Record<Exclude<Soundscape, 'none'>, string> = {
  'brown-noise': 'Коричневий шум',
  rain: 'Дощ',
  'deep-drone': 'Глибокий дрон',
  forest: 'Ліс',
};

const SLEEP_TIMER_OPTIONS = [15, 30, 60] as const;

/**
 * Background audio for sleep (FE-401): NSDR sessions and nature soundscapes that
 * keep playing with the screen locked, native lock-screen controls (title +
 * play/pause via the playback service), and a sleep timer that fades out.
 */
export function SleepPlayer() {
  const [nowPlaying, setNowPlaying] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(() => getIsPlaying());
  const sleepTimer = useSleepTimer();

  // Reflect play/pause even when it is changed from the lock screen.
  useEffect(() => addPlaybackListener(setIsPlaying), []);

  const startNsdr = (index: number) => {
    const track = NSDR_TRACKS[index];
    if (!track) return;
    setNowPlaying(NSDR_UK[index] ?? track.title);
    void playNsdr(track);
  };

  const startSoundscape = (key: Exclude<Soundscape, 'none'>) => {
    setNowPlaying(SOUNDSCAPE_UK[key]);
    void playSoundscape(key);
  };

  const stop = () => {
    setNowPlaying(null);
    sleepTimer.cancel();
    void stopPlayback();
  };

  return (
    <>
      {/* Now playing + transport + sleep timer */}
      {nowPlaying ? (
        <Card className="mb-4">
          <View className="flex-row items-center">
            <PressableScale onPress={() => void togglePlayback()} scaleTo={0.9} accessibilityLabel={isPlaying ? 'Пауза' : 'Грати'}>
              <View className="h-12 w-12 items-center justify-center rounded-pill" style={{ backgroundColor: `${ACCENT}1F` }}>
                {isPlaying ? (
                  <Pause size={20} strokeWidth={layout.iconStroke} color={ACCENT} />
                ) : (
                  <Play size={20} strokeWidth={layout.iconStroke} color={ACCENT} />
                )}
              </View>
            </PressableScale>
            <View className="ml-4 flex-1">
              <Text className="text-[15px] font-semibold text-ink">{nowPlaying}</Text>
              <Text className="mt-0.5 text-[12px] text-ink-mute">
                {sleepTimer.isActive
                  ? `Автовимкнення через ${formatDuration(sleepTimer.remainingMs)}`
                  : 'Грає у фоні · керування на екрані блокування'}
              </Text>
            </View>
            <PressableScale onPress={stop} hitSlop={10} accessibilityLabel="Зупинити">
              <X size={20} strokeWidth={layout.iconStroke} color={palette.inkMute} />
            </PressableScale>
          </View>

          {/* Sleep timer (FE-401 AC3) */}
          <View className="mt-4 flex-row items-center gap-2">
            <Timer size={15} strokeWidth={layout.iconStroke} color={palette.inkMute} />
            {SLEEP_TIMER_OPTIONS.map((min) => {
              const selected = sleepTimer.minutes === min;
              return (
                <PressableScale key={min} onPress={() => sleepTimer.start(min)} scaleTo={0.94}>
                  <View
                    className="rounded-pill border px-3.5 py-1.5"
                    style={{
                      borderColor: selected ? ACCENT : palette.hairline,
                      backgroundColor: selected ? `${ACCENT}1F` : 'transparent',
                    }}
                  >
                    <Text className="text-[13px] font-medium" style={{ color: selected ? ACCENT : palette.inkSoft }}>
                      {min} хв
                    </Text>
                  </View>
                </PressableScale>
              );
            })}
            {sleepTimer.isActive ? (
              <PressableScale onPress={() => sleepTimer.cancel()} scaleTo={0.94}>
                <View className="rounded-pill border px-3.5 py-1.5" style={{ borderColor: palette.hairline }}>
                  <Text className="text-[13px] font-medium text-ink-mute">Вимк</Text>
                </View>
              </PressableScale>
            ) : null}
          </View>
        </Card>
      ) : null}

      {/* NSDR */}
      <SectionLabel>Йога-нідра / NSDR</SectionLabel>
      <View className="mx-5 mb-6 gap-3">
        {NSDR_TRACKS.map((track, index) => (
          <PressableScale key={track.title} onPress={() => startNsdr(index)} scaleTo={0.98}>
            <View className="flex-row items-center rounded-card border border-hairline bg-surface p-4">
              <View className="h-11 w-11 items-center justify-center rounded-pill" style={{ backgroundColor: `${ACCENT}1F` }}>
                <MoonStar size={18} strokeWidth={layout.iconStroke} color={ACCENT} />
              </View>
              <Text className="ml-4 flex-1 text-[15px] font-medium text-ink">{NSDR_UK[index] ?? track.title}</Text>
              <Play size={17} strokeWidth={layout.iconStroke} color={palette.inkMute} />
            </View>
          </PressableScale>
        ))}
      </View>

      {/* Soundscapes */}
      <SectionLabel>Звуки для сну</SectionLabel>
      <View className="mx-5 flex-row flex-wrap gap-2">
        {(Object.keys(SOUNDSCAPES) as Exclude<Soundscape, 'none'>[]).map((key) => (
          <PressableScale key={key} onPress={() => startSoundscape(key)} scaleTo={0.94}>
            <View className="flex-row items-center rounded-pill border border-hairline px-4 py-2.5">
              <Volume2 size={15} strokeWidth={layout.iconStroke} color={palette.inkSoft} />
              <Text className="ml-2 text-[13px] font-medium text-ink-soft">{SOUNDSCAPE_UK[key]}</Text>
            </View>
          </PressableScale>
        ))}
      </View>

      <Text className="mx-5 mt-4 text-[12px] leading-[18px] text-ink-mute">
        {isAudioAvailable()
          ? 'Звук грає із заблокованим екраном і зʼявляється на екрані блокування. Таймер сну плавно зменшить гучність за 30 секунд до вимкнення.'
          : 'Аудіо недоступне у Expo Go — зберіть dev-клієнт, щоб почути звук і фонове відтворення.'}
      </Text>
    </>
  );
}
