import { View } from 'react-native';

import { PressableScale } from '@/components/ui/PressableScale';
import type { EnergyScore } from '@/store/useEnergyStore';
import { ENERGY_SCALE, palette } from '@/theme/tokens';

/**
 * Horizontal 1–5 energy selector drawn as a battery (FE-202).
 *
 * Five cells inside a battery body with a terminal nub. Tapping a cell fills the
 * battery up to that level and paints the fill in that level's colour, which
 * runs muted terracotta (1, burnout) → sage (5, peak) via `ENERGY_SCALE`. One
 * tap logs — there is no separate confirm — so the whole control is the
 * "1 dotik" the story asks for.
 *
 * `value` is the resting position (the latest reading today), or null before any
 * check-in. It is a display hint only; every tap logs a fresh reading.
 */
const CELLS: EnergyScore[] = [1, 2, 3, 4, 5];

export function EnergyBattery({
  value,
  onSelect,
}: {
  value: EnergyScore | null;
  onSelect: (score: EnergyScore) => void;
}) {
  return (
    <View className="flex-row items-center justify-center">
      {/* Battery body */}
      <View
        className="flex-row items-center rounded-[14px] border p-1.5"
        style={{ borderColor: palette.hairline, backgroundColor: palette.void }}
      >
        {CELLS.map((level) => {
          const filled = value !== null && level <= value;
          const fill = ENERGY_SCALE[value ?? 0];
          return (
            <PressableScale
              key={level}
              onPress={() => onSelect(level)}
              scaleTo={0.88}
              haptic="select"
              accessibilityRole="radio"
              accessibilityState={{ selected: value === level }}
              accessibilityLabel={`Рівень ${level} з 5`}
            >
              <View
                className="mx-0.5 h-12 w-9 rounded-[7px]"
                style={{
                  backgroundColor: filled ? fill : 'transparent',
                  borderWidth: filled ? 0 : 1,
                  borderColor: palette.hairline,
                  // A faint tint on the empty cells so the untapped battery still
                  // reads as five slots, not an empty rectangle.
                  opacity: filled ? 1 : 0.6,
                }}
              />
            </PressableScale>
          );
        })}
      </View>

      {/* Terminal nub */}
      <View
        className="ml-1 h-5 w-1.5 rounded-r-[3px]"
        style={{ backgroundColor: palette.hairline }}
      />
    </View>
  );
}
