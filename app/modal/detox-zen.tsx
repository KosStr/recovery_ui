import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { pickRandomQuest } from '@/components/detox/quests';
import { X } from '@/components/ui/icons';
import { formatDuration, useCountdown } from '@/services/timerEngine';
import { useFaceDown } from '@/services/useFaceDown';
import { palette } from '@/theme/tokens';

const KEEP_AWAKE_TAG = 'detox-zen';

/**
 * "Глибокий офлайн" — the full-screen Zen mode (FE-501).
 *
 * Deliberately almost empty: a random analog quest, a white timer on true black,
 * nothing to tap. The detox timer itself lives in the shared timer engine and is
 * started before this screen opens; here it is display-only (the Detox tab, still
 * mounted behind, owns completion — the success haptic and clearing the timer),
 * so nothing double-fires.
 *
 * Flip-to-detox (AC2): when the phone is face down the screen goes fully black
 * and keep-awake is released, so the display can sleep and the OLED draws no
 * power. The block still finishes on time — the timer is a persisted timestamp
 * and the OS notification carries the completion buzz even with the app asleep.
 * Flip back up and the timer reappears.
 */
export default function DetoxZenModal() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { timer, remaining, hasCompleted } = useCountdown();
  const { isFaceDown, available: sensorAvailable } = useFaceDown(true);

  // One quest for the whole session, chosen on mount.
  const questRef = useRef(pickRandomQuest());
  const quest = questRef.current;
  const QuestIcon = quest.icon;

  const [dismissed, setDismissed] = useState(false);

  // Keep the screen awake while face up; release it face down so the device can
  // sleep and the panel goes truly dark.
  useEffect(() => {
    if (isFaceDown) {
      deactivateKeepAwake(KEEP_AWAKE_TAG);
    } else {
      void activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    }
  }, [isFaceDown]);

  useEffect(() => {
    return () => {
      void deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
  }, []);

  // Close a beat after completion so the "done" state lands, unless the user
  // already left.
  useEffect(() => {
    if (hasCompleted && !dismissed) {
      const t = setTimeout(() => router.back(), 2200);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [hasCompleted, dismissed, router]);

  const close = () => {
    setDismissed(true);
    router.back();
  };

  // Face down: a black void. The Pressable lets a tap wake the visual back even
  // before the phone is lifted.
  if (isFaceDown) {
    return (
      <Pressable
        onPress={() => {}}
        accessibilityLabel="Екран у режимі економії. Переверніть телефон, щоб показати таймер."
        style={{ flex: 1, backgroundColor: palette.void }}
      />
    );
  }

  return (
    <View className="flex-1 items-center justify-center bg-void">
      <Pressable
        onPress={close}
        hitSlop={16}
        accessibilityRole="button"
        accessibilityLabel="Вийти з режиму детоксу"
        style={{ position: 'absolute', top: insets.top + 12, right: 20, zIndex: 10 }}
      >
        <X size={24} strokeWidth={1.5} color={palette.inkGhost} />
      </Pressable>

      {hasCompleted ? (
        <Animated.Text entering={FadeIn.duration(500)} className="text-[22px] font-light text-ink">
          Детокс завершено
        </Animated.Text>
      ) : (
        <>
          {/* Quest */}
          <Animated.View entering={FadeIn.duration(500)} className="mb-16 px-10">
            <View className="items-center">
              <QuestIcon size={30} strokeWidth={1.25} color={palette.inkSoft} />
              <Text className="mt-4 text-center text-[19px] font-light leading-[26px] text-ink">
                {quest.title}
              </Text>
              <Text className="mt-2 text-center text-[14px] leading-[20px] text-ink-mute">
                {quest.detail}
              </Text>
            </View>
          </Animated.View>

          {/* Timer */}
          <Text
            className="text-[72px] font-thin tracking-tighter text-ink"
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {formatDuration(timer ? remaining : 0)}
          </Text>

          {/* Flip hint */}
          <Animated.Text
            entering={FadeIn.duration(500)}
            exiting={FadeOut.duration(200)}
            className="absolute text-center text-[12px] leading-[18px] text-ink-ghost"
            style={{ bottom: insets.bottom + 28, paddingHorizontal: 48 }}
          >
            {sensorAvailable
              ? 'Покладіть телефон екраном донизу — він згасне до завершення.'
              : 'Покладіть телефон і не торкайтеся його до сигналу.'}
          </Animated.Text>
        </>
      )}
    </View>
  );
}
