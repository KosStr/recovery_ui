import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Moon, ShieldOff, Target, Zap } from '@/components/ui/icons';
import { haptics } from '@/lib/haptics';
import { layout, palette, tabBar } from '@/theme/tokens';

/**
 * Four tabs, one per recovery domain.
 *
 * Three things this file is responsible for, beyond routing:
 *
 * 1. **True black everywhere.** The bar, the scene beneath it, and the space
 *    behind the home indicator are all `#000000`, so an OLED panel switches
 *    those pixels off instead of lighting them dim grey.
 * 2. **A stable height across every device.** The bar is a fixed content height
 *    *plus* the bottom safe-area inset, never a hardcoded per-platform number.
 *    See the note on `insets` below.
 * 3. **A haptic on an actual switch**, not on every press.
 *
 * Icons are Lucide at stroke 1.5. Lucide has no filled variants, which suits
 * the design: colour alone marks the active tab, so nothing changes weight or
 * shape as you move between them.
 */
export default function TabsLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: tabBar.active,
        tabBarInactiveTintColor: tabBar.inactive,

        tabBarStyle: {
          backgroundColor: tabBar.background,
          // A hairline, not a full pixel: on a 3x screen `1` is a visible grey
          // band against true black.
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: tabBar.border,
          // Elevation and shadow both render as a grey wash on OLED.
          elevation: 0,
          shadowOpacity: 0,

          // Height is content + inset rather than a per-platform constant.
          // A hardcoded 88/68 is wrong on every device it was not measured on:
          // too tall on an iPhone SE, too short on a gesture-nav Android, and
          // it shifts the moment the inset resolves. Deriving it means the
          // glyphs sit the same distance above the home indicator everywhere.
          height: layout.tabBarContentHeight + insets.bottom,
          paddingBottom: insets.bottom,
          paddingTop: 8,
        },

        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          letterSpacing: 0.4,
          marginTop: 2,
        },
        tabBarItemStyle: { paddingVertical: 2 },

        // Without this the navigator paints its own default behind a screen
        // during the transition, which flashes grey between tabs.
        sceneStyle: { backgroundColor: palette.void },
      }}
      screenListeners={({ navigation }) => ({
        tabPress: () => {
          // `isFocused()` is evaluated before navigation happens, so it still
          // reports the *outgoing* state: false means this press is a real
          // switch. Re-tapping the active tab scrolls to top instead, and does
          // not deserve a cue.
          if (!navigation.isFocused()) haptics.select();
        },
      })}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Енергія',
          tabBarAccessibilityLabel: 'Енергія',
          tabBarIcon: ({ color }) => (
            <Zap color={color} size={layout.tabIconSize} strokeWidth={layout.iconStroke} />
          ),
        }}
      />
      <Tabs.Screen
        name="focus"
        options={{
          title: 'Фокус',
          tabBarAccessibilityLabel: 'Фокус',
          tabBarIcon: ({ color }) => (
            <Target color={color} size={layout.tabIconSize} strokeWidth={layout.iconStroke} />
          ),
        }}
      />
      <Tabs.Screen
        name="sleep"
        options={{
          title: 'Сон',
          tabBarAccessibilityLabel: 'Сон',
          tabBarIcon: ({ color }) => (
            <Moon color={color} size={layout.tabIconSize} strokeWidth={layout.iconStroke} />
          ),
        }}
      />
      <Tabs.Screen
        name="detox"
        options={{
          title: 'Детокс',
          tabBarAccessibilityLabel: 'Детокс',
          tabBarIcon: ({ color }) => (
            <ShieldOff color={color} size={layout.tabIconSize} strokeWidth={layout.iconStroke} />
          ),
        }}
      />
    </Tabs>
  );
}
