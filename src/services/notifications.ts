import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { palette } from '@/theme/tokens';

export const TIMER_CHANNEL_ID = 'recovery-timers';

/**
 * Foreground presentation. Without this, a notification that fires while the
 * app is open is swallowed, and a user watching the timer screen would see the
 * countdown hit zero with no confirmation.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let permissionPromise: Promise<boolean> | null = null;

/**
 * Idempotent permission request. Several screens can ask at once on first
 * launch; caching the promise keeps that to a single OS prompt.
 */
export function ensureNotificationPermissions(): Promise<boolean> {
  permissionPromise ??= (async () => {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(TIMER_CHANNEL_ID, {
        name: 'Timers & rituals',
        importance: Notifications.AndroidImportance.HIGH,
        lightColor: palette.sage,
        // A short, soft pattern. This fires at the end of a rest block; it
        // should feel like a tap on the shoulder, not an alarm.
        vibrationPattern: [0, 180, 120, 180],
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    if (existing.granted) return true;
    // `canAskAgain === false` means the user has hard-denied; asking again is a
    // no-op that returns immediately, but skipping it avoids a pointless call.
    if (!existing.canAskAgain) return false;

    const requested = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    });
    return requested.granted;
  })();

  return permissionPromise;
}

/**
 * Schedules a one-shot notification at an absolute wall-clock instant.
 *
 * Returns the OS identifier, or null when we could not schedule (permission
 * denied, or the target is already in the past). Callers must treat null as
 * "the timer still works, it just cannot notify" — never as a fatal error.
 */
export async function scheduleAt(
  date: Date,
  content: { title: string; body: string; data?: Record<string, unknown> },
): Promise<string | null> {
  // expo-notifications rejects non-future dates; a sub-second block is also
  // not worth a notification.
  if (date.getTime() - Date.now() < 1_000) return null;

  const granted = await ensureNotificationPermissions();
  if (!granted) return null;

  try {
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: content.title,
        body: content.body,
        data: content.data ?? {},
        sound: true,
        ...(Platform.OS === 'android' ? { channelId: TIMER_CHANNEL_ID } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date,
        ...(Platform.OS === 'android' ? { channelId: TIMER_CHANNEL_ID } : {}),
      },
    });
  } catch (error) {
    if (__DEV__) console.warn('[notifications] schedule failed', error);
    return null;
  }
}

/** Safe to call with a stale or already-delivered id. */
export async function cancelScheduled(id: string | null | undefined): Promise<void> {
  if (!id) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    /* Already delivered or cancelled. */
  }
}

export async function cancelAllScheduled(): Promise<void> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    /* Nothing pending. */
  }
}
