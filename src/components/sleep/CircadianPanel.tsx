import { Text, View } from 'react-native';

import { PressableScale } from '@/components/ui/PressableScale';
import { Card } from '@/components/ui/Screen';
import { Bed, Coffee, Sunset, type LucideIcon } from '@/components/ui/icons';
import {
  SLEEP_TARGET_MAX,
  SLEEP_TARGET_MIN,
  SLEEP_TARGET_STEP,
  formatClock,
  formatHm,
  useCircadian,
} from '@/services/circadian';
import { layout, palette } from '@/theme/tokens';

/**
 * The circadian widget (FE-402): a bedtime setter and two derived cards,
 * caffeine cutoff and digital sunset, each with a live status badge.
 */
export function CircadianPanel() {
  const { targetMinutes, info, adjustTarget } = useCircadian();

  const canEarlier = targetMinutes > SLEEP_TARGET_MIN;
  const canLater = targetMinutes < SLEEP_TARGET_MAX;

  return (
    <>
      {/* Bedtime setter */}
      <Card className="mb-4">
        <View className="flex-row items-center">
          <View
            className="h-11 w-11 items-center justify-center rounded-pill"
            style={{ backgroundColor: `${palette.indigoGlow}1F` }}
          >
            <Bed size={20} strokeWidth={layout.iconStroke} color={palette.indigoGlow} />
          </View>
          <View className="ml-4 flex-1">
            <Text className="text-[13px] text-ink-soft">Ціль сну</Text>
            <Text className="text-[22px] font-light tracking-tight text-ink" style={{ fontVariant: ['tabular-nums'] }}>
              {formatClock(targetMinutes)}
            </Text>
          </View>
          <Stepper label="–" enabled={canEarlier} onPress={() => adjustTarget(-SLEEP_TARGET_STEP)} />
          <Stepper label="+" enabled={canLater} onPress={() => adjustTarget(SLEEP_TARGET_STEP)} />
        </View>
      </Card>

      {/* Caffeine cutoff */}
      <CircadianCard
        icon={Coffee}
        title="Кава"
        time={formatClock(info.caffeineCutoff.getHours() * 60 + info.caffeineCutoff.getMinutes())}
        passed={info.caffeinePassed}
        activeText={`Кава дозволена ще ${formatHm(info.caffeineRemainingMs)}`}
        passedText="Caffeine Cutoff: пийте лише воду / трав'яний чай"
      />

      {/* Digital sunset */}
      <CircadianCard
        icon={Sunset}
        title="Digital Sunset"
        time={formatClock(info.digitalSunset.getHours() * 60 + info.digitalSunset.getMinutes())}
        passed={info.sunsetPassed}
        activeText={`Екрани вимкнути через ${formatHm(info.sunsetRemainingMs)}`}
        passedText="Digital Sunset: час без екранів"
        activeColor={palette.indigoGlow}
      />
    </>
  );
}

function Stepper({ label, enabled, onPress }: { label: string; enabled: boolean; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} disabled={!enabled} scaleTo={0.88} className="ml-2">
      <View
        className="h-10 w-10 items-center justify-center rounded-pill border"
        style={{ borderColor: palette.hairline, opacity: enabled ? 1 : 0.35 }}
      >
        <Text className="text-[20px] font-light text-ink">{label}</Text>
      </View>
    </PressableScale>
  );
}

function CircadianCard({
  icon: Icon,
  title,
  time,
  passed,
  activeText,
  passedText,
  activeColor = palette.sage,
}: {
  icon: LucideIcon;
  title: string;
  time: string;
  passed: boolean;
  activeText: string;
  passedText: string;
  activeColor?: string;
}) {
  // Green while there is still time; amber once the deadline has passed.
  const color = passed ? palette.amber : activeColor;
  return (
    <Card className="mb-4">
      <View className="flex-row items-start">
        <View
          className="h-11 w-11 items-center justify-center rounded-pill"
          style={{ backgroundColor: `${color}1F` }}
        >
          <Icon size={20} strokeWidth={layout.iconStroke} color={color} />
        </View>
        <View className="ml-4 flex-1">
          <View className="flex-row items-center justify-between">
            <Text className="text-[13px] text-ink-soft">{title}</Text>
            <Text className="text-[13px] text-ink-mute" style={{ fontVariant: ['tabular-nums'] }}>
              {time}
            </Text>
          </View>
          <View
            className="mt-2 self-start rounded-pill px-3 py-1.5"
            style={{ backgroundColor: `${color}1F` }}
          >
            <Text className="text-[13px] font-semibold" style={{ color }}>
              {passed ? passedText : activeText}
            </Text>
          </View>
        </View>
      </View>
    </Card>
  );
}
