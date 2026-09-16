import { useEffect, useState } from 'react';
import { Accelerometer } from 'expo-sensors';

/**
 * Detects "face down" — the phone resting screen-to-the-table (FE-501 AC2).
 *
 * The accelerometer reports gravity in g. Screen up, z ≈ +1; screen down,
 * z ≈ −1. A −0.8 threshold with a little hysteresis avoids flicker as the phone
 * is set down or picked up.
 *
 * Polls at 2 Hz — flip detection does not need more, and a slow interval keeps
 * the sensor's own battery cost negligible during a long detox window. Sampling
 * only runs while `enabled`, so the listener is torn down the moment the Zen
 * screen closes.
 *
 * `expo-sensors` is bundled in Expo Go, so no lazy-require guard is needed; the
 * `isAvailableAsync` check covers web and the rare device without the sensor,
 * where `available` stays false and flip-to-detox is simply skipped.
 */
export function useFaceDown(enabled: boolean): { isFaceDown: boolean; available: boolean } {
  const [isFaceDown, setIsFaceDown] = useState(false);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setIsFaceDown(false);
      return;
    }

    let mounted = true;
    let subscription: { remove: () => void } | null = null;

    Accelerometer.isAvailableAsync()
      .then((ok) => {
        if (!mounted) return;
        setAvailable(ok);
        if (!ok) return;

        Accelerometer.setUpdateInterval(500);
        subscription = Accelerometer.addListener(({ z }) => {
          // Hysteresis: enter face-down past −0.8, leave only above −0.6, so a
          // phone hovering near vertical does not strobe the screen on and off.
          setIsFaceDown((prev) => (prev ? z < -0.6 : z < -0.8));
        });
      })
      .catch(() => {
        /* Sensor unavailable; flip-to-detox is simply inactive. */
      });

    return () => {
      mounted = false;
      subscription?.remove();
    };
  }, [enabled]);

  return { isFaceDown, available };
}
