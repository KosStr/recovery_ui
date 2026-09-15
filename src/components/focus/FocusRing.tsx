import { useEffect, useMemo } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { Easing, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';

import { palette } from '@/theme/tokens';

/**
 * Minimalist focus ring (FE-301 UI).
 *
 * A Skia progress ring with MM:SS in the middle. The ring is the whole visual —
 * no bar, no chrome — so it reads at a glance from across a desk.
 *
 * `progress` arrives from `useCountdown` as a value that steps once a second.
 * Rather than let the ring jump each second, an internal SharedValue eases
 * toward it with a linear `withTiming` just short of a second, so the arc glides
 * smoothly on the UI thread while the JS thread does nothing between ticks.
 *
 * Skia is a native module absent from Expo Go, so it is required lazily and a
 * plain-View fallback (centred time + a hairline bar) stands in — the same
 * pattern the breathing orb uses.
 */
type SkiaModule = typeof import('@shopify/react-native-skia');

let Skia: SkiaModule | null;
try {
  Skia = require('@shopify/react-native-skia') as SkiaModule;
} catch {
  Skia = null;
}

export const isSkiaAvailable = Skia !== null;

export interface FocusRingProps {
  /** 0..1 completion. */
  progress: number;
  /** Formatted time in the centre, e.g. "1:29:59". */
  label: string;
  /** Small caption above the time, e.g. "ФОКУС". */
  caption?: string;
  accent: string;
  /** Dims the ring slightly and shows a paused note. */
  paused?: boolean;
  /** Overrides the diameter derived from the viewport. */
  size?: number;
}

export function FocusRing({ progress, label, caption, accent, paused, size }: FocusRingProps) {
  const { width } = useWindowDimensions();
  const diameter = size ?? Math.min(width * 0.72, 300);

  // Eased mirror of `progress`. Jumps immediately to 0 on a reset (a shrinking
  // target), otherwise glides forward.
  const ringEnd = useSharedValue(progress);
  useEffect(() => {
    if (progress < ringEnd.value - 0.05) {
      ringEnd.value = progress; // reset / new block — snap, don't unwind
    } else {
      ringEnd.value = withTiming(progress, { duration: 950, easing: Easing.linear });
    }
  }, [progress, ringEnd]);

  // Geometry + Skia path are computed unconditionally, above the availability
  // branch, so hook order never changes between a Skia and a fallback render.
  const strokeWidth = 10;
  const radius = diameter / 2 - strokeWidth;
  const cx = diameter / 2;
  const cy = diameter / 2;

  const end = useDerivedValue(() => ringEnd.value);
  const circle = useMemo(() => {
    if (!Skia) return null;
    const p = Skia.Skia.Path.Make();
    p.addCircle(cx, cy, radius);
    return p;
  }, [cx, cy, radius]);

  const centre = (
    <View
      style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' }}
      pointerEvents="none"
    >
      {caption ? (
        <Text className="mb-2 text-[11px] uppercase tracking-[1.6px] text-ink-mute">{caption}</Text>
      ) : null}
      <Text
        className="text-[56px] font-extralight tracking-tighter"
        style={{ color: accent, fontVariant: ['tabular-nums'], opacity: paused ? 0.55 : 1 }}
      >
        {label}
      </Text>
      {paused ? <Text className="mt-1 text-[13px] text-amber">Пауза</Text> : null}
    </View>
  );

  if (!Skia || !circle) {
    return (
      <FallbackRing diameter={diameter} accent={accent} progress={progress}>
        {centre}
      </FallbackRing>
    );
  }

  // The <Path> `end` prop trims the circle 0..1 to draw the arc; a −90° rotation
  // moves the start from 3 o'clock to the top.
  const { Canvas, Group, Path, vec } = Skia;

  return (
    <View style={{ width: diameter, height: diameter }} accessibilityRole="progressbar" accessibilityLabel={`${caption ?? ''} ${label}`.trim()}>
      <Canvas style={{ flex: 1 }}>
        <Group transform={[{ rotate: -Math.PI / 2 }]} origin={vec(cx, cy)}>
          {/* Track */}
          <Path
            path={circle}
            style="stroke"
            strokeWidth={strokeWidth}
            strokeCap="round"
            color={palette.hairline}
          />
          {/* Progress */}
          <Path
            path={circle}
            style="stroke"
            strokeWidth={strokeWidth}
            strokeCap="round"
            color={accent}
            start={0}
            end={end}
            opacity={paused ? 0.6 : 1}
          />
        </Group>
      </Canvas>
      {centre}
    </View>
  );
}

/**
 * Expo Go stand-in: the centred time plus a hairline progress bar beneath. No
 * arc, but the same information, and it keeps the screen testable without a dev
 * build.
 */
function FallbackRing({
  diameter,
  accent,
  progress,
  children,
}: {
  diameter: number;
  accent: string;
  progress: number;
  children: React.ReactNode;
}) {
  return (
    <View style={{ width: diameter, height: diameter, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          borderWidth: 10,
          borderColor: palette.hairline,
        }}
      />
      {children}
      <View
        style={{
          position: 'absolute',
          bottom: diameter * 0.16,
          height: 3,
          width: diameter * 0.5,
          borderRadius: 999,
          overflow: 'hidden',
          backgroundColor: palette.hairline,
        }}
      >
        <View
          style={{ height: '100%', width: `${Math.round(progress * 100)}%`, backgroundColor: accent }}
        />
      </View>
    </View>
  );
}
