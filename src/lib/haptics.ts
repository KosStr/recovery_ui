import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Haptics that never throw.
 *
 * Every call site here is on a UI path (breath cues, timer transitions), and a
 * rejected promise from a device without a taptic engine must not surface as an
 * unhandled rejection mid-session. Web has no API at all.
 */
const supported = Platform.OS === 'ios' || Platform.OS === 'android';

function safe(run: () => Promise<void>): void {
  if (!supported) return;
  run().catch(() => {
    /* No haptic hardware, or the OS denied it. Silence is the correct outcome. */
  });
}

export const haptics = {
  /** First inhale of the physiological sigh — the lightest possible tap. */
  inhalePrimary: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),

  /** Second, shorter sniff that tops off the lungs. Distinctly sharper. */
  inhaleSecondary: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid)),

  /** Long exhale. Soft and diffuse so it reads as "release", not "act". */
  exhale: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft)),

  /** Discrete UI selection: energy dial, tab, checklist item. */
  select: () => safe(() => Haptics.selectionAsync()),

  /** A block of work or a ritual finished. */
  success: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),

  /** Caffeine cutoff passed, detox streak broken. */
  warn: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
};
