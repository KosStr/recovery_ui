/**
 * Remote-control handler for react-native-track-player.
 *
 * This runs in a headless JS context that outlives the UI: when the app is
 * backgrounded or the activity is destroyed, the OS still routes lock-screen,
 * notification, Bluetooth and CarPlay controls here. It must therefore avoid
 * touching React state or navigation -- only the player.
 *
 * Registered from `index.js` before the router entry, which is the only point
 * early enough for the native module to bind its service.
 */
export async function playbackService(): Promise<void> {
  const TrackPlayerModule = require('react-native-track-player');
  const TrackPlayer = TrackPlayerModule.default;
  const { Event } = TrackPlayerModule;

  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteStop, () => TrackPlayer.stop());

  // Soundscapes are ambient beds, not tracks with structure. Seeking backwards
  // or forwards is meaningless, so the transport buttons nudge by 30s rather
  // than jumping between items.
  TrackPlayer.addEventListener(Event.RemoteJumpForward, async ({ interval }: { interval: number }) => {
    const position = await TrackPlayer.getPosition();
    await TrackPlayer.seekTo(position + (interval ?? 30));
  });

  TrackPlayer.addEventListener(Event.RemoteJumpBackward, async ({ interval }: { interval: number }) => {
    const position = await TrackPlayer.getPosition();
    await TrackPlayer.seekTo(Math.max(0, position - (interval ?? 30)));
  });

  // Headphones unplugged mid-session: pause rather than blasting the speaker,
  // which is the whole point of this app's context (offices, bedrooms).
  TrackPlayer.addEventListener(Event.RemoteDuck, async ({ paused, permanent }: { paused: boolean; permanent: boolean }) => {
    if (permanent) {
      await TrackPlayer.pause();
      return;
    }
    // A transient duck (a navigation prompt, a notification) -- drop the volume
    // rather than stopping, so the ambience returns on its own.
    await (paused ? TrackPlayer.pause() : TrackPlayer.setVolume(0.2));
  });
}
