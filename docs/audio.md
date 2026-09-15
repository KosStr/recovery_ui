# Audio

`src/services/audioPlayer.ts` and `src/services/playbackService.ts`.

- [What it has to do](#what-it-has-to-do)
- [Registration order](#registration-order)
- [Setup](#setup)
- [Playback API](#playback-api)
- [The headless service](#the-headless-service)
- [Content](#content)
- [Platform configuration](#platform-configuration)
- [The sleep timer (FE-401)](#the-sleep-timer-fe-401)
- [Known risk: the New Architecture](#known-risk-the-new-architecture)
- [Testing](#testing)

---

## What it has to do

Three requirements shape this subsystem:

1. **Play with the screen off**, for up to 90 minutes. A soundscape that stops
   when the phone locks is useless.
2. **Appear on the lock screen**, with working transport controls.
3. **Survive the app being swiped away** on Android, mid-block.

`expo-audio` covers (1) but not (2) or (3), which is why this uses
`react-native-track-player`. That choice carries a real risk — see
[below](#known-risk-the-new-architecture).

---

## Registration order

TrackPlayer's headless service must be registered **before any React code
evaluates**, otherwise the native side has nothing to route lock-screen events
to. That is what `index.js` is for:

```js
try {
  const TrackPlayer = require('react-native-track-player').default;
  const { playbackService } = require('./src/services/playbackService');
  TrackPlayer.registerPlaybackService(() => playbackService);
} catch (error) {
  // Expo Go has no native TrackPlayer. The app still runs; audio no-ops.
}

require('expo-router/entry');
```

Both are `require()` calls, not `import` statements. **ES module imports are
hoisted**, so writing them as imports would let `expo-router/entry` evaluate
first and silently break registration.

`package.json` therefore has `"main": "index.js"`, not `"expo-router/entry"`.

---

## Setup

`setupAudioPlayer()` is idempotent — it caches its promise, because
`TrackPlayer.setupPlayer()` throws if called twice. It resolves `false` when
audio is unavailable, and **every caller treats that as "skip audio", never as an
error**.

```ts
await TrackPlayer.setupPlayer({
  autoHandleInterruptions: true,        // native handles calls / other apps
  iosCategory: IOSCategory.Playback,
  iosCategoryMode: IOSCategoryMode.Default,
});

await TrackPlayer.updateOptions({
  android: {
    appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
  },
  capabilities: [Play, Pause, Stop, JumpForward, JumpBackward],
  compactCapabilities: [Play, Pause],
  progressUpdateEventInterval: 2,
});
```

`autoHandleInterruptions` lets the native layer deal with phone calls and other
apps taking focus, rather than reimplementing ducking in JS.

`ContinuePlayback` means a soundscape does not die when the user swipes the app
away mid-block — the point of the feature.

`compactCapabilities` is just play/pause, matching the app's restraint. The
expanded notification offers the 30-second jumps.

### The double-init guard

```ts
catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes('already been initialized')) {
    if (__DEV__) console.warn('[audio] setupPlayer failed', error);
    return false;
  }
}
```

The only *expected* failure is a duplicate setup after a Fast Refresh, where the
native player survived the JS reload. Anything else is a real failure and is
logged. Swallowing all errors here would hide genuine configuration problems.

### Guarded loading

Like every native module in this project, TrackPlayer is `require`d lazily inside
`try/catch` and the result cached in `moduleRef`. A static import would crash Expo
Go at bundle evaluation, before any fallback could run.

`isAudioAvailable()` exposes the result.

---

## Playback API

| Function | Behaviour |
| --- | --- |
| `playSoundscape(soundscape)` | Loops one ambient bed. `'none'` stops playback |
| `playNsdr(track)` | Plays a fixed-length guided track once, no loop |
| `pausePlayback()` | |
| `resumePlayback()` | |
| `stopPlayback()` | `reset()` — clears the queue *and* the notification |
| `fadeOutAndStop(ms)` | 20-step volume ramp, then reset |
| `togglePlayback()` | Play if paused, pause if playing — mirrors the lock-screen toggle |
| `addPlaybackListener(fn)` | Subscribe to play/pause changes (incl. lock-screen); returns unsubscribe |
| `getIsPlaying()` | Best-effort current state; `false` when audio is unavailable |

Two details worth knowing:

**`playSoundscape` is idempotent per track.** If the requested bed is already
active it calls `play()` rather than reloading, which avoids an audible seam:

```ts
const activeTrack = await TrackPlayer.getActiveTrack();
if (activeTrack?.id === track.id) { await TrackPlayer.play(); return; }
```

**`stopPlayback` uses `reset()`, not `stop()`.** `stop()` alone leaves a paused
item sitting on the lock screen, which looks broken.

`fadeOutAndStop` exists for the end of a wind-down or NSDR block, where a hard
cut would undo the whole session. It restores the original volume afterwards so
the next session does not start silent.

---

## The headless service

`playbackService.ts` runs in a **JS context that outlives the UI**. When the app
is backgrounded or the activity is destroyed, the OS still routes lock-screen,
notification, Bluetooth and CarPlay controls here.

**It must not touch React state or navigation** — only the player.

| Event | Handling |
| --- | --- |
| `RemotePlay` / `RemotePause` / `RemoteStop` | Direct passthrough |
| `RemoteJumpForward` / `RemoteJumpBackward` | Seeks ±30 s. Soundscapes are ambient beds with no structure, so track-skipping would be meaningless |
| `RemoteDuck` (permanent) | Pause. Headphones unplugged mid-session should not blast the room speaker — this app gets used in offices and bedrooms |
| `RemoteDuck` (transient) | Drop volume to 0.2 rather than stopping, so the ambience returns on its own |

---

## Content

### Soundscapes

Five options, keyed to match the `Soundscape` union in the store so a selection
maps to a track with no lookup table:

`none` · `brown-noise` · `rain` · `deep-drone` · `forest`

### NSDR

Three guided tracks: 10 min, 20 min, 30 min (yoga nidra).

### Format

URLs currently point at `cdn.example.com` — **replace them with your CDN.**

Opus in an Ogg container is the intended format: roughly a third the bytes of AAC
at the same perceptual quality for noise beds, which matters for a loop the user
may stream for ninety minutes. Both platforms decode it natively — ExoPlayer on
Android, AVFoundation on the iOS versions targeted here.

For a looping bed, encode so the file loops seamlessly (no silence at either
end); `RepeatMode.Track` restarts at the file boundary and any padding will be
audible.

---

## Platform configuration

Set in `app.json`. Changing any of these requires a rebuild
(`npx expo prebuild --clean`).

**iOS:**

```json
"infoPlist": { "UIBackgroundModes": ["audio", "processing"] }
```

Without the `audio` mode, iOS suspends playback the moment the app backgrounds.

**Android:**

```
android.permission.FOREGROUND_SERVICE
android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK
android.permission.WAKE_LOCK
```

`FOREGROUND_SERVICE_MEDIA_PLAYBACK` is required from Android 14 (API 34) onward;
without it the service fails to start and playback dies on background.

---

## The sleep timer (FE-401)

`src/services/sleepTimer.ts`. Auto-stops playback after 15 / 30 / 60 minutes,
fading the volume out over the final 30 s so the room does not cut to silence.

Same discipline as the focus engine: the source of truth is one absolute instant,
`endAt` in MMKV, and the remaining time is `endAt − Date.now()`, so a reload shows
the right value immediately. `reconcileSleepTimer()` re-arms the internal timeout
on mount and on every foreground.

The fade needs JS to run — it ramps the volume in steps — which it can while
audio plays, because the OS keeps a background-audio app alive. If the app is
suspended past `endAt` (audio paused *and* backgrounded), the next foreground
reconciles and stops cleanly; there is nothing to fade in that case.

**Lock-screen limitation.** The native lock screen shows the title and play/pause
(FE-401 AC2), but a **sleep-timer countdown on the lock screen** is not something
`react-native-track-player` exposes without a custom notification; the countdown
lives in-app. The title + play/pause half of AC2 is fully native.

---

## Known risk: the New Architecture

React Native Directory lists `react-native-track-player` as **unsupported on the
New Architecture**, and `app.json` sets `newArchEnabled: true`.

v4.1.x does run under the bridgeless interop layer, but **that combination is
unverified in this project** — audio has never been exercised against a native
build here.

`expo-doctor` is configured to skip this one check:

```json
"expo": {
  "doctor": {
    "reactNativeDirectoryCheck": {
      "exclude": ["react-native-track-player"],
      "listUnknownPackages": false
    }
  }
}
```

**That is a suppression, not a fix.** It exists so the other 17 checks stay
meaningful rather than being ignored wholesale.

**Exercise background audio early on a real device.** If it misbehaves under
bridgeless, the fallback is `expo-audio`: you lose lock-screen transport controls
and app-killed continuation, but it is maintained in lockstep with the SDK. Every
consumer goes through `audioPlayer.ts`, so swapping the implementation touches
one file.

---

## Testing

Requires a **development build** and **real URLs**. In Expo Go every function
here no-ops after logging one `[audio]` warning.

**Background playback.** Focus tab → pick a soundscape → start a block → lock the
phone. Audio should continue.

**Lock-screen controls.** With audio playing, wake the lock screen. Title, artist
and play/pause should appear, and the buttons should work.

**App-killed continuation (Android).** With audio playing, swipe the app away from
the recents list. Playback should continue and the notification should remain.

**Interruption.** Play a soundscape, then take a phone call or play something in
another app. Audio should duck or pause, then behave sensibly afterwards.

**Headphone removal.** Unplug or disconnect Bluetooth mid-playback. It should
pause, not switch to the speaker.

**Seam-free looping.** Let a bed loop at least twice and listen at the boundary.
Any click or gap is an encoding problem, not a code one.
