import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/theme/tokens';

/**
 * A minimal bottom sheet.
 *
 * Deliberately not `@gorhom/bottom-sheet`: this app needs one small sheet, and
 * pulling in a native-backed sheet library for it would add a dependency, a New
 * Architecture compatibility surface, and a chunk of bundle for no gain. This is
 * a plain RN `Modal` with a Reanimated slide and a drag-to-dismiss Pan gesture —
 * everything it uses is already in the project.
 *
 * The parent owns `visible`. Dragging down or tapping the backdrop calls
 * `onClose`, which flips `visible` false; the close animation then runs and the
 * Modal unmounts only once it finishes, so the sheet is never cut off mid-slide.
 *
 * Note the inner `GestureHandlerRootView`: gestures do not propagate into a RN
 * `Modal` from the app's root provider, so the sheet re-roots them itself.
 */
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Start well below the screen so the first slide-in has somewhere to come from,
// before onLayout has measured the real height.
const OFFSCREEN = 800;

export function BottomSheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const [rendered, setRendered] = useState(visible);

  const translateY = useSharedValue(OFFSCREEN);
  const backdrop = useSharedValue(0);

  // Mount as soon as we are asked to show.
  useEffect(() => {
    if (visible) setRendered(true);
  }, [visible]);

  // Slide in once mounted and visible.
  useEffect(() => {
    if (rendered && visible) {
      translateY.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.cubic) });
      backdrop.value = withTiming(1, { duration: 260 });
    }
  }, [rendered, visible, translateY, backdrop]);

  // Slide out when hidden, and only unmount after the slide completes.
  useEffect(() => {
    if (!visible && rendered) {
      backdrop.value = withTiming(0, { duration: 220 });
      translateY.value = withTiming(OFFSCREEN, { duration: 220, easing: Easing.in(Easing.cubic) }, (finished) => {
        'worklet';
        if (finished) runOnJS(setRendered)(false);
      });
    }
  }, [visible, rendered, translateY, backdrop]);

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      // Only downward drag moves the sheet; upward is clamped.
      translateY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      // Past a third of a typical sheet, or a decisive flick, dismiss.
      if (e.translationY > 120 || e.velocityY > 800) {
        runOnJS(onClose)();
      } else {
        translateY.value = withTiming(0, { duration: 180 });
      }
    });

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  if (!rendered) return null;

  return (
    <Modal transparent visible={rendered} onRequestClose={onClose} animationType="none" statusBarTranslucent>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <AnimatedPressable
          onPress={onClose}
          accessibilityLabel="Закрити"
          style={[
            { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#000000AA' },
            backdropStyle,
          ]}
        />

        <GestureDetector gesture={pan}>
          <Animated.View
            style={[
              {
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: palette.elevated,
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
                borderTopWidth: 1,
                borderColor: palette.hairline,
                paddingTop: 10,
                paddingBottom: insets.bottom + 20,
                paddingHorizontal: 20,
              },
              sheetStyle,
            ]}
          >
            {/* Grab handle. */}
            <View
              style={{
                alignSelf: 'center',
                width: 40,
                height: 4,
                borderRadius: 999,
                backgroundColor: palette.hairline,
                marginBottom: 16,
              }}
            />
            {children}
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}
