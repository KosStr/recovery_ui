import type { ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Standard screen chrome.
 *
 * The background is `#000000` rather than a near-black, deliberately: on an
 * OLED panel those pixels are switched off entirely, which both saves power and
 * removes the faint grey cast that makes a dark UI feel cheap at night.
 *
 * Top padding comes from the safe-area inset, which is what clears a Dynamic
 * Island or a notch. The bottom does *not* add the inset: the tab bar is laid
 * out as a sibling below the scene and already absorbs it, so adding it here
 * again would leave a stripe of dead space under every screen.
 */
export function Screen({
  title,
  subtitle,
  children,
  scroll = true,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  scroll?: boolean;
}) {
  const insets = useSafeAreaInsets();

  const header = title ? (
    <View className="mb-6 px-5">
      <Text className="text-[32px] font-semibold tracking-tight text-ink">{title}</Text>
      {subtitle ? <Text className="mt-1 text-[15px] text-ink-soft">{subtitle}</Text> : null}
    </View>
  ) : null;

  if (!scroll) {
    return (
      <View className="flex-1 bg-void" style={{ paddingTop: insets.top + 12 }}>
        {header}
        {children}
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-void"
      contentContainerStyle={{
        paddingTop: insets.top + 12,
        // Breathing room at the end of a scroll, nothing more.
        paddingBottom: 40,
      }}
      showsVerticalScrollIndicator={false}
    >
      {header}
      {children}
    </ScrollView>
  );
}

/** Quiet uppercase label that separates groups without drawing a rule. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Text className="mb-3 px-5 text-[11px] font-semibold uppercase tracking-[1.6px] text-ink-mute">
      {children}
    </Text>
  );
}

/**
 * Elevated surface. One hairline border and a barely-lifted fill is the entire
 * elevation system -- no shadows, which read as grey smears on OLED.
 */
export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <View className={`mx-5 rounded-card border border-hairline bg-surface p-5 ${className}`}>
      {children}
    </View>
  );
}
