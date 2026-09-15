import { useMemo } from 'react';
import { View, useWindowDimensions } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import type { BreathPhase } from '@/components/breathing/useSighCycle';
import { palette } from '@/theme/tokens';

/**
 * The breathing orb.
 *
 * Every visual property is a `useDerivedValue` off a single SharedValue, so the
 * whole animation is computed and painted on the UI thread. React never
 * re-renders during a breath cycle -- the tree below mounts once and then the
 * Skia scene graph is mutated directly. That is what holds 120fps on a
 * ProMotion display while SQLite writes are happening on the JS thread.
 *
 * Skia is a native module with no Expo Go support, so it is required lazily and
 * a Reanimated-only orb stands in when it is missing. The fallback is visually
 * simpler (no gradient, no blur halo) but breathes on exactly the same values.
 */

type SkiaModule = typeof import('@shopify/react-native-skia');

let Skia: SkiaModule | null;
try {
  Skia = require('@shopify/react-native-skia') as SkiaModule;
} catch {
  Skia = null;
}

export const isSkiaAvailable = Skia !== null;

export interface PhysiologicalSighProps {
  /** 0 (40% radius) to 1 (100% radius). Owned by `useSighCycle`. */
  lungFullness: SharedValue<number>;
  /** 0..1 hold-phase pulse. Optional; brightens and swells the halo when set. */
  glow?: SharedValue<number>;
  phase: BreathPhase;
  /** Accent the orb is painted in. Defaults to sage. */
  accent?: string;
  /** Overrides the diameter derived from the viewport. */
  size?: number;
}

export function PhysiologicalSigh({
  lungFullness,
  glow,
  phase,
  accent = palette.sage,
  size,
}: PhysiologicalSighProps) {
  const { width } = useWindowDimensions();

  // Always create a shared value so hook order is stable; fall back to it when
  // the caller does not drive the glow.
  const internalGlow = useSharedValue(0);
  const glowValue = glow ?? internalGlow;

  // The canvas is square and sized off the narrower viewport axis so the orb
  // never clips on a small phone or stretch on a tablet.
  const canvasSize = size ?? Math.min(width * 0.86, 380);
  const center = canvasSize / 2;

  const geometry = useMemo(() => {
    const maxRadius = canvasSize * 0.34;
    return {
      maxRadius,
      // FE-201: the orb never shrinks below 40% radius. An empty orb reads as
      // "stopped"; 40% reads as "exhaled, still alive".
      minRadius: maxRadius * 0.4,
      ringRadius: canvasSize * 0.44,
    };
  }, [canvasSize]);

  const { maxRadius, minRadius, ringRadius } = geometry;

  // --- Derived visuals (UI thread) ---
  const orbRadius = useDerivedValue(
    () => minRadius + lungFullness.value * (maxRadius - minRadius),
  );

  // The halo leads the orb slightly and fades as the lungs empty, so an exhale
  // reads as heat leaving the body rather than a shape merely shrinking. During
  // the hold, `glow` swells and brightens it -- the visual stand-in for the
  // phase that has no haptic.
  const haloRadius = useDerivedValue(() => orbRadius.value * (1.42 + glowValue.value * 0.12));
  const haloOpacity = useDerivedValue(
    () => 0.12 + lungFullness.value * 0.34 + glowValue.value * 0.22,
  );

  // Guide ring holds a faint constant presence and brightens at full inhale, so
  // the peak of the sniff is legible without looking at the caption.
  const ringOpacity = useDerivedValue(() => 0.1 + lungFullness.value * 0.28);

  const coreOpacity = useDerivedValue(() => 0.55 + lungFullness.value * 0.45);

  // Specular highlight. Declared here rather than inline in the JSX below so
  // that every hook runs before the Skia-availability branch returns.
  const highlightRadius = useDerivedValue(() => orbRadius.value * 0.18);
  const highlightOpacity = useDerivedValue(() => lungFullness.value * 0.22);

  if (!Skia) {
    return (
      <FallbackOrb
        lungFullness={lungFullness}
        glow={glowValue}
        accent={accent}
        canvasSize={canvasSize}
        maxRadius={maxRadius}
        minRadius={minRadius}
      />
    );
  }

  const { Canvas, Circle, Group, BlurMask, RadialGradient, vec } = Skia;

  return (
    <View
      style={{ width: canvasSize, height: canvasSize }}
      accessibilityRole="image"
      // The orb is the instruction, so it must announce the phase for anyone
      // running a screen reader or with the display dimmed to black.
      accessibilityLabel={`Breathing guide, ${phase}`}
    >
      <Canvas style={{ flex: 1 }}>
        <Group>
          {/* Diffuse halo. Blurred separately so the core stays crisp. */}
          <Circle cx={center} cy={center} r={haloRadius} color={accent} opacity={haloOpacity}>
            <BlurMask blur={38} style="normal" />
          </Circle>

          {/* Faint guide ring at the outer limit of the breath. */}
          <Circle
            cx={center}
            cy={center}
            r={ringRadius}
            style="stroke"
            strokeWidth={1}
            color={accent}
            opacity={ringOpacity}
          />

          {/* The orb itself: bright core falling off to transparent at the rim. */}
          <Circle cx={center} cy={center} r={orbRadius} opacity={coreOpacity}>
            <RadialGradient
              c={vec(center, center)}
              r={maxRadius}
              colors={[accent, accent, `${accent}00`]}
              positions={[0, 0.55, 1]}
            />
          </Circle>

          {/* Specular highlight, offset up-left, to give the orb a light source. */}
          <Circle
            cx={center - maxRadius * 0.22}
            cy={center - maxRadius * 0.24}
            r={highlightRadius}
            color="#FFFFFF"
            opacity={highlightOpacity}
          >
            <BlurMask blur={12} style="normal" />
          </Circle>
        </Group>
      </Canvas>
    </View>
  );
}

/**
 * Expo Go stand-in. A scaled View cannot do the gradient or the blur, but it is
 * driven by the same SharedValue, so timing and haptic sync are identical and
 * the screen remains testable without a dev build.
 */
function FallbackOrb({
  lungFullness,
  glow,
  accent,
  canvasSize,
  maxRadius,
  minRadius,
}: {
  lungFullness: SharedValue<number>;
  glow: SharedValue<number>;
  accent: string;
  canvasSize: number;
  maxRadius: number;
  minRadius: number;
}) {
  const diameter = maxRadius * 2;

  const orbStyle = useAnimatedStyle(() => {
    const radius = minRadius + lungFullness.value * (maxRadius - minRadius);
    return {
      transform: [{ scale: radius / maxRadius }],
      opacity: 0.55 + lungFullness.value * 0.45,
    };
  });

  const haloStyle = useAnimatedStyle(() => {
    const radius = minRadius + lungFullness.value * (maxRadius - minRadius);
    return {
      transform: [{ scale: (radius * (1.42 + glow.value * 0.12)) / maxRadius }],
      opacity: 0.1 + lungFullness.value * 0.2 + glow.value * 0.2,
    };
  });

  return (
    <View
      style={{
        width: canvasSize,
        height: canvasSize,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: diameter,
            height: diameter,
            borderRadius: maxRadius,
            backgroundColor: accent,
          },
          haloStyle,
        ]}
      />
      <Animated.View
        style={[
          {
            width: diameter,
            height: diameter,
            borderRadius: maxRadius,
            backgroundColor: accent,
          },
          orbStyle,
        ]}
      />
    </View>
  );
}
