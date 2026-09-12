import '../global.css';

import { ThemeProvider } from '@react-navigation/native';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useCallback, useEffect, useState } from 'react';
import { AppState, type AppStateStatus, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';

import { queryClient } from '@/api/queryClient';
import { initializeDatabase } from '@/db/localDb';
import { setupAudioPlayer } from '@/services/audioPlayer';
import { ensureNotificationPermissions } from '@/services/notifications';
import { useEnergyStore } from '@/store/useEnergyStore';
import { navigationDarkTheme, palette } from '@/theme/tokens';

/**
 * Root layout.
 *
 * Holds the splash screen until the database schema exists and the store has
 * reconciled with it. Doing that here rather than per-screen is what lets every
 * dashboard card render its real value on first paint -- there is no skeleton
 * state anywhere in this app, by design.
 */

SplashScreen.preventAutoHideAsync().catch(() => {
  /* Already hidden, or the module reloaded. Not worth surfacing. */
});

// Fade rather than cut, so the transition into a black UI is seamless.
SplashScreen.setOptions({ duration: 400, fade: true });

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<Error | null>(null);
  const hydrateFromDb = useEnergyStore((s) => s.hydrateFromDb);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Paint the window black beneath the React tree, so an OS-level
        // rotation or overscroll never flashes white.
        await SystemUI.setBackgroundColorAsync(palette.void);

        // Blocking: nothing can render meaningfully without the schema.
        await initializeDatabase();
        await hydrateFromDb();

        if (!cancelled) setReady(true);

        // Non-blocking: permission prompts and the audio session would make
        // startup feel slow, and neither is needed for the first frame.
        void ensureNotificationPermissions();
        void setupAudioPlayer();
      } catch (error) {
        if (!cancelled) {
          setBootError(error instanceof Error ? error : new Error(String(error)));
          setReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hydrateFromDb]);

  // Returning from the background may cross midnight or land after a check-in
  // made elsewhere; re-reconcile rather than trusting the in-memory snapshot.
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state === 'active') void hydrateFromDb();
    };
    const subscription = AppState.addEventListener('change', onChange);
    return () => subscription.remove();
  }, [hydrateFromDb]);

  const onLayoutRootView = useCallback(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette.void }}>
      {/*
        `initialMetrics` is what stops the first-frame height jump. Without it
        the provider mounts with zero insets, measures natively, then re-renders
        with the real ones -- so the tab bar and every header visibly snap
        downward a frame after launch. `initialWindowMetrics` is read
        synchronously from the native side at startup, so the first paint is
        already correct on a Dynamic Island iPhone, a notched Android, and a
        gesture-navigation device alike.
      */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider value={navigationDarkTheme}>
            <View style={{ flex: 1, backgroundColor: palette.void }} onLayout={onLayoutRootView}>
              {bootError ? <BootErrorBanner error={bootError} /> : null}
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: palette.void },
                  animation: 'fade',
                }}
              >
                <Stack.Screen name="(tabs)" />
                <Stack.Screen
                  name="modal/breathing"
                  options={{
                    presentation: 'fullScreenModal',
                    // Rising into the breathing screen matches the inhale that
                    // follows it; a horizontal push would not.
                    animation: 'slide_from_bottom',
                    gestureEnabled: true,
                  }}
                />
              </Stack>
              <StatusBar style="light" />
            </View>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Startup failures are almost always a missing native module in Expo Go. Say so
 * in place rather than crashing to a red box, so the rest of the app stays
 * explorable.
 */
function BootErrorBanner({ error }: { error: Error }) {
  return (
    <View className="border-b border-amber-dim bg-elevated px-5 py-3">
      <Text className="text-[13px] font-semibold text-amber">Startup issue</Text>
      <Text className="mt-1 text-[12px] text-ink-soft">{error.message}</Text>
    </View>
  );
}
