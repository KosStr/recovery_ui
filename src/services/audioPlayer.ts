import type { Soundscape } from '@/store/useEnergyStore';

/**
 * Background audio for soundscapes and NSDR.
 *
 * react-native-track-player is a native module with no Expo Go support, and the
 * player must be set up exactly once per process -- calling `setupPlayer` twice
 * throws. Both facts are handled here so screens can call `playSoundscape`
 * freely without guarding.
 *
 * Everything is loaded through `require` at call time rather than a top-level
 * import: a static import would crash Expo Go at bundle-eval, before any of our
 * fallback logic could run.
 */

type TrackPlayerModule = typeof import('react-native-track-player');

let moduleRef: TrackPlayerModule | null | undefined;

function loadModule(): TrackPlayerModule | null {
  if (moduleRef !== undefined) return moduleRef;
  try {
    moduleRef = require('react-native-track-player') as TrackPlayerModule;
  } catch {
    if (__DEV__) {
      console.warn(
        '[audio] react-native-track-player unavailable (Expo Go?). Audio controls will no-op.',
      );
    }
    moduleRef = null;
  }
  return moduleRef;
}

export function isAudioAvailable(): boolean {
  return loadModule() !== null;
}

export interface SoundscapeTrack {
  id: Soundscape;
  title: string;
  /**
   * Opus in an Ogg/WebM container: roughly a third the bytes of AAC at the same
   * perceptual quality for noise beds, which matters for a loop the user may
   * stream for ninety minutes. Both platforms decode it natively via ExoPlayer
   * and AVFoundation on the versions we target.
   */
  url: string;
  artist: string;
  isLiveStream?: boolean;
}

/**
 * Replace these URLs with your CDN. Keep the ids aligned with `Soundscape`
 * so the store's selection maps to a track with no lookup table.
 */
export const SOUNDSCAPES: Record<Exclude<Soundscape, 'none'>, SoundscapeTrack> = {
  'brown-noise': {
    id: 'brown-noise',
    title: 'Brown noise',
    artist: 'Recovery',
    url: 'https://cdn.example.com/soundscapes/brown-noise.opus',
  },
  rain: {
    id: 'rain',
    title: 'Rain on glass',
    artist: 'Recovery',
    url: 'https://cdn.example.com/soundscapes/rain.opus',
  },
  'deep-drone': {
    id: 'deep-drone',
    title: 'Deep drone',
    artist: 'Recovery',
    url: 'https://cdn.example.com/soundscapes/deep-drone.opus',
  },
  forest: {
    id: 'forest',
    title: 'Forest floor',
    artist: 'Recovery',
    url: 'https://cdn.example.com/soundscapes/forest.opus',
  },
};

export const NSDR_TRACKS: SoundscapeTrack[] = [
  {
    id: 'deep-drone',
    title: 'NSDR / 10 minutes',
    artist: 'Non-sleep deep rest',
    url: 'https://cdn.example.com/nsdr/nsdr-10.opus',
  },
  {
    id: 'deep-drone',
    title: 'NSDR / 20 minutes',
    artist: 'Non-sleep deep rest',
    url: 'https://cdn.example.com/nsdr/nsdr-20.opus',
  },
  {
    id: 'deep-drone',
    title: 'Yoga nidra / 30 minutes',
    artist: 'Non-sleep deep rest',
    url: 'https://cdn.example.com/nsdr/nidra-30.opus',
  },
];

let setupPromise: Promise<boolean> | null = null;

/**
 * Idempotent player initialisation. Resolves false when audio is unavailable,
 * which every caller treats as "skip audio", never as an error.
 */
export function setupAudioPlayer(): Promise<boolean> {
  setupPromise ??= (async () => {
    const mod = loadModule();
    if (!mod) return false;

    const TrackPlayer = mod.default;
    const { AppKilledPlaybackBehavior, Capability, IOSCategory, IOSCategoryMode } = mod;

    try {
      await TrackPlayer.setupPlayer({
        // Lets the native side handle phone calls and other apps taking focus,
        // rather than us reimplementing ducking in JS.
        autoHandleInterruptions: true,
        iosCategory: IOSCategory.Playback,
        iosCategoryMode: IOSCategoryMode.Default,
      });
    } catch (error) {
      // The only expected failure is a duplicate setup after a Fast Refresh,
      // where the native player survived the JS reload. Anything else is real.
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('already been initialized')) {
        if (__DEV__) console.warn('[audio] setupPlayer failed', error);
        return false;
      }
    }

    await TrackPlayer.updateOptions({
      android: {
        // A soundscape must not die when the user swipes the app away mid-block.
        appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
      },
      capabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.Stop,
        Capability.JumpForward,
        Capability.JumpBackward,
      ],
      // Lock screen stays minimal, matching the app's restraint.
      compactCapabilities: [Capability.Play, Capability.Pause],
      progressUpdateEventInterval: 2,
    });

    return true;
  })();

  return setupPromise;
}

/** Loops a single ambient bed. Passing 'none' stops playback. */
export async function playSoundscape(soundscape: Soundscape): Promise<void> {
  if (soundscape === 'none') return stopPlayback();

  const ready = await setupAudioPlayer();
  const mod = loadModule();
  if (!ready || !mod) return;

  const TrackPlayer = mod.default;
  const { RepeatMode } = mod;
  const track = SOUNDSCAPES[soundscape];

  // Already playing this bed: leave it alone rather than restarting the loop
  // and producing an audible seam.
  const activeTrack = await TrackPlayer.getActiveTrack();
  if (activeTrack?.id === track.id) {
    await TrackPlayer.play();
    return;
  }

  await TrackPlayer.reset();
  await TrackPlayer.add({
    id: track.id,
    url: track.url,
    title: track.title,
    artist: track.artist,
  });
  await TrackPlayer.setRepeatMode(RepeatMode.Track);
  await TrackPlayer.setVolume(1);
  await TrackPlayer.play();
}

/** Plays a fixed-length guided track once, without looping. */
export async function playNsdr(track: SoundscapeTrack): Promise<void> {
  const ready = await setupAudioPlayer();
  const mod = loadModule();
  if (!ready || !mod) return;

  const TrackPlayer = mod.default;
  const { RepeatMode } = mod;

  await TrackPlayer.reset();
  await TrackPlayer.add({
    id: track.title,
    url: track.url,
    title: track.title,
    artist: track.artist,
  });
  await TrackPlayer.setRepeatMode(RepeatMode.Off);
  await TrackPlayer.play();
}

export async function pausePlayback(): Promise<void> {
  const mod = loadModule();
  if (!mod || !setupPromise) return;
  await mod.default.pause();
}

export async function resumePlayback(): Promise<void> {
  const mod = loadModule();
  if (!mod || !setupPromise) return;
  await mod.default.play();
}

export async function stopPlayback(): Promise<void> {
  const mod = loadModule();
  if (!mod || !setupPromise) return;
  // `reset` clears the queue and tears down the notification; `stop` alone
  // leaves a paused item on the lock screen.
  await mod.default.reset();
}

/**
 * Fades out over `durationMs` before stopping. Used at the end of a wind-down
 * or NSDR block, where a hard cut would undo the whole session.
 */
export async function fadeOutAndStop(durationMs = 4000): Promise<void> {
  const mod = loadModule();
  if (!mod || !setupPromise) return;

  const TrackPlayer = mod.default;
  const steps = 20;
  const stepMs = durationMs / steps;
  const startVolume = await TrackPlayer.getVolume();

  for (let i = steps - 1; i >= 0; i--) {
    await TrackPlayer.setVolume((startVolume * i) / steps);
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }

  await TrackPlayer.reset();
  await TrackPlayer.setVolume(startVolume);
}

// --- Playback state --------------------------------------------------------
//
// The Sleep player needs to reflect play/pause *including changes made from the
// lock screen*, so it subscribes to the player's own state rather than trusting
// its last in-app action. All of this no-ops when the native module is absent.

type PlaybackListener = (isPlaying: boolean) => void;
const playbackListeners = new Set<PlaybackListener>();
let isPlaying = false;
let stateSubscribed = false;

function emitPlayback(next: boolean): void {
  isPlaying = next;
  playbackListeners.forEach((fn) => fn(next));
}

/** Best-effort current state; false when audio is unavailable. */
export function getIsPlaying(): boolean {
  return isPlaying;
}

/**
 * Subscribes to play/pause changes. Wires the underlying TrackPlayer state event
 * on first use. Returns an unsubscribe. On a platform without the native module
 * the listener simply never fires.
 */
export function addPlaybackListener(listener: PlaybackListener): () => void {
  playbackListeners.add(listener);

  const mod = loadModule();
  if (mod && !stateSubscribed) {
    stateSubscribed = true;
    const { State, Event } = mod;
    mod.default.addEventListener(Event.PlaybackState, ({ state }: { state: unknown }) => {
      emitPlayback(state === State.Playing || state === State.Buffering);
    });
  }

  return () => {
    playbackListeners.delete(listener);
  };
}

/** Play if paused, pause if playing. Mirrors the lock-screen toggle in-app. */
export async function togglePlayback(): Promise<void> {
  const mod = loadModule();
  if (!mod || !setupPromise) return;
  if (isPlaying) await mod.default.pause();
  else await mod.default.play();
}
