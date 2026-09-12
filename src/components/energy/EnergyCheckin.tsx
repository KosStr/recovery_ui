import { useState } from 'react';
import { Text, View } from 'react-native';

import { EnergyBattery } from '@/components/energy/EnergyBattery';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { PressableScale } from '@/components/ui/PressableScale';
import { Card } from '@/components/ui/Screen';
import { haptics } from '@/lib/haptics';
import {
  ENERGY_LABELS,
  ENERGY_TAGS,
  useEnergyStore,
  type EnergyScore,
} from '@/store/useEnergyStore';
import { ENERGY_SCALE, palette } from '@/theme/tokens';

/**
 * The daily energy check-in (FE-202): battery selector + a tag bottom sheet.
 *
 * The flow is one tap to log, then optional tagging:
 *   tap a battery cell  → `logEnergy` writes the row immediately (optimistic in
 *                          the store, so the average moves this frame) and the
 *                          tag sheet opens
 *   toggle chips        → `setLastTags` writes through to that same row
 *   dismiss             → nothing to save; it already is
 *
 * Reads the store directly rather than through TanStack Query so the selected
 * level and the day's numbers update with zero latency.
 */
export function EnergyCheckin() {
  const latestScore = useEnergyStore((s) => s.latestScore);
  const lastTags = useEnergyStore((s) => s.lastTags);
  const logEnergy = useEnergyStore((s) => s.logEnergy);
  const setLastTags = useEnergyStore((s) => s.setLastTags);

  const [sheetOpen, setSheetOpen] = useState(false);

  const onSelect = async (score: EnergyScore) => {
    await logEnergy(score);
    setSheetOpen(true);
  };

  const toggleTag = (id: string) => {
    haptics.select();
    const next = lastTags.includes(id) ? lastTags.filter((t) => t !== id) : [...lastTags, id];
    void setLastTags(next);
  };

  return (
    <>
      <Card className="mb-6">
        <EnergyBattery value={latestScore} onSelect={onSelect} />

        <Text className="mt-4 text-center text-[13px] text-ink-soft">
          {latestScore
            ? ENERGY_LABELS[latestScore]
            : 'Торкніться батарейки, щоб зафіксувати рівень.'}
        </Text>
      </Card>

      <BottomSheet visible={sheetOpen} onClose={() => setSheetOpen(false)}>
        <Text className="mb-1 text-[17px] font-semibold text-ink">Що вплинуло?</Text>
        <Text className="mb-4 text-[13px] text-ink-soft">Необовʼязково. Можна кілька.</Text>

        <View className="flex-row flex-wrap gap-2">
          {ENERGY_TAGS.map((tag) => {
            const selected = lastTags.includes(tag.id);
            return (
              <PressableScale
                key={tag.id}
                onPress={() => toggleTag(tag.id)}
                haptic="none"
                scaleTo={0.94}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
              >
                <View
                  className="rounded-pill border px-4 py-2.5"
                  style={{
                    borderColor: selected ? palette.sage : palette.hairline,
                    backgroundColor: selected ? `${palette.sage}1F` : 'transparent',
                  }}
                >
                  <Text
                    className="text-[14px] font-medium"
                    style={{ color: selected ? palette.sageGlow : palette.inkSoft }}
                  >
                    {tag.label}
                  </Text>
                </View>
              </PressableScale>
            );
          })}
        </View>

        <PressableScale onPress={() => setSheetOpen(false)} haptic="none" className="mt-6">
          <View
            className="items-center rounded-card py-3.5"
            style={{ backgroundColor: latestScore ? `${ENERGY_SCALE[latestScore]}1F` : palette.surface }}
          >
            <Text
              className="text-[15px] font-semibold"
              style={{ color: latestScore ? ENERGY_SCALE[latestScore] : palette.ink }}
            >
              Готово
            </Text>
          </View>
        </PressableScale>
      </BottomSheet>
    </>
  );
}
