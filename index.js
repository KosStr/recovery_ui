/**
 * App entry.
 *
 * TrackPlayer's headless service must be registered before any React code
 * evaluates, otherwise the native side has nothing to route lock-screen events
 * to. `expo-router/entry` is therefore required *after* registration, using
 * require() so module hoisting cannot reorder them.
 */
try {
  const TrackPlayer = require('react-native-track-player').default;
  const { playbackService } = require('./src/services/playbackService');
  TrackPlayer.registerPlaybackService(() => playbackService);
} catch (error) {
  // Expo Go has no native TrackPlayer. The app still runs; audio no-ops.
  if (__DEV__) {
    console.warn('[entry] TrackPlayer not registered — build a dev client for audio.');
  }
}

require('expo-router/entry');
