import type { ReactNode } from 'react';
import { Pressable, type PressableProps, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';

/**
 * Press target with a spring-driven scale and an optional haptic.
 *
 * The scale runs on the UI thread, so the feedback lands on the same frame as
 * the touch even when the JS thread is mid-SQLite-write. Springs rather than
 * timings because a press-in interrupted by a press-out has to retarget
 * mid-flight without a visible jump.
 *
 * Structure matters here: the `className` sits on a plain `Pressable` and the
 * transform on an inner `Animated.View`. NativeWind only interops the core
 * components it knows about, so a `createAnimatedComponent(Pressable)` wrapper
 * would silently drop every Tailwind class handed to it.
 */
export function PressableScale({
  children,
  onPress,
  haptic = 'select',
  scaleTo = 0.97,
  style,
  className,
  disabled,
  ...rest
}: {
  children: ReactNode;
  onPress?: () => void;
  /** Which cue to fire on press. `none` for repeated or low-stakes taps. */
  haptic?: 'select' | 'success' | 'none';
  scaleTo?: number;
  className?: string;
  style?: ViewStyle;
} & Omit<PressableProps, 'onPress' | 'style' | 'children'>) {
  const pressed = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: withSpring(1 - pressed.value * (1 - scaleTo), { damping: 18, stiffness: 320 }) },
    ],
    opacity: withSpring(1 - pressed.value * 0.15),
  }));

  return (
    <Pressable
      className={className}
      style={style}
      disabled={disabled}
      onPressIn={() => {
        pressed.value = 1;
      }}
      onPressOut={() => {
        pressed.value = 0;
      }}
      onPress={() => {
        if (haptic === 'select') haptics.select();
        else if (haptic === 'success') haptics.success();
        onPress?.();
      }}
      {...rest}
    >
      <Animated.View style={animatedStyle}>{children}</Animated.View>
    </Pressable>
  );
}
