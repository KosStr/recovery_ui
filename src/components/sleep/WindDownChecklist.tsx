import { Text, View } from 'react-native';

import { useCompletedRituals, useToggleRitual } from '@/api/hooks/useSessions';
import { PressableScale } from '@/components/ui/PressableScale';
import { SectionLabel } from '@/components/ui/Screen';
import { Check, Droplet, Lightbulb, Smartphone, Wind, type LucideIcon } from '@/components/ui/icons';
import { layout, palette } from '@/theme/tokens';

const ACCENT = palette.indigoGlow;

/**
 * The four wind-down toggles (FE-402 AC2). Keyed, not indexed, so reordering the
 * list never orphans a day's history; backed by the shared `ritual_completions`
 * table (one tick per key per local day) via the existing ritual hooks.
 */
const STEPS: { key: string; label: string; icon: LucideIcon }[] = [
  { key: 'air', label: 'Провітрити кімнату', icon: Wind },
  { key: 'dim-lights', label: 'Приглушити верхнє світло', icon: Lightbulb },
  { key: 'water', label: 'Випити води', icon: Droplet },
  { key: 'phone-away', label: 'Телефон на зарядку далеко від ліжка', icon: Smartphone },
];

export function WindDownChecklist() {
  const { data: completed = [] } = useCompletedRituals();
  const { mutate: toggle } = useToggleRitual();

  const done = completed.length;

  return (
    <>
      <SectionLabel>{`Вечірня рутина · ${done} з ${STEPS.length}`}</SectionLabel>
      <View className="mx-5 overflow-hidden rounded-card border border-hairline bg-surface">
        {STEPS.map((step, index) => {
          const checked = completed.includes(step.key);
          const Icon = step.icon;
          return (
            <PressableScale
              key={step.key}
              onPress={() => toggle(step.key)}
              scaleTo={0.99}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
            >
              <View className={`flex-row items-center px-5 py-4 ${index > 0 ? 'border-t border-hairline' : ''}`}>
                <Icon
                  size={18}
                  strokeWidth={layout.iconStroke}
                  color={checked ? ACCENT : palette.inkMute}
                />
                <Text
                  className="ml-4 flex-1 text-[15px] font-medium"
                  style={{ color: checked ? palette.inkMute : palette.ink }}
                >
                  {step.label}
                </Text>
                <View
                  className="h-6 w-6 items-center justify-center rounded-pill border"
                  style={{
                    borderColor: checked ? ACCENT : palette.inkGhost,
                    backgroundColor: checked ? ACCENT : 'transparent',
                  }}
                >
                  {checked ? <Check size={14} strokeWidth={2.5} color={palette.void} /> : null}
                </View>
              </View>
            </PressableScale>
          );
        })}
      </View>
    </>
  );
}
