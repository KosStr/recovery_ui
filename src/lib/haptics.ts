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
  /**
   * A single light tap. Used both as the pulse of the rising inhale ramp and as
   * the soft marker at the start of the exhale (FE-201 phases 1 and 4).
   */
  inhalePrimary: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),

  /**
   * The second, sharper inhale — the "довдих" that tops off the lungs. FE-201
   * specifies a distinct Medium impact here, stronger than the ramp preceding
   * it so the two inhales feel like separate actions with the eyes closed.
   */
  inhaleSecondary: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),

  /** Long exhale. Soft and diffuse so it reads as "release", not "act". */
  exhale: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),

  /** Discrete UI selection: energy dial, tab, checklist item. */
  select: () => safe(() => Haptics.selectionAsync()),

  /** A block of work or a ritual finished. */
  success: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),

  /** Caffeine cutoff passed, detox streak broken. */
  warn: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
};
