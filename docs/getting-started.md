# Getting started

Everything needed to go from a fresh clone to the app running on a device.

- [1. Prerequisites](#1-prerequisites)
- [2. Install](#2-install)
- [3. Configure](#3-configure)
- [4. Choose how to run it](#4-choose-how-to-run-it)
- [5. Expo Go](#5-expo-go-fastest-partial-features)
- [6. Development build](#6-development-build-full-features)
- [7. Daily workflow](#7-daily-workflow)
- [8. Verifying it actually works](#8-verifying-it-actually-works)
- [9. Scripts reference](#9-scripts-reference)

---

## 1. Prerequisites

| Requirement | Notes |
| --- | --- |
| **Node.js 20 LTS+** | Verified on 24.19.0 with npm 11.17.0 |
| **Git** | — |
| **Watchman** (macOS/Linux) | Optional, but Metro is noticeably faster with it |
| **Xcode 16+** | iOS only. macOS only. Install Command Line Tools too |
| **Android Studio** | Android only. Needs an AVD and `ANDROID_HOME` set |

Node on Windows, if missing:

```bash
winget install OpenJS.NodeJS.LTS
```

Reopen the terminal afterwards so `PATH` picks up `node` and `npm`. Verify:

```bash
node -v && npm -v
```

**You do not need a Mac to develop this app.** Metro bundling, TypeScript,
`expo start`, and the Android build all work on Windows and Linux. Only the iOS
native build (`expo run:ios`) requires macOS.

---

## 2. Install

```bash
npm install
```

Then reconcile every Expo-managed package against the installed SDK version:

```bash
npx expo install --fix
```

Confirm the toolchain is coherent:

```bash
npx expo-doctor
```

Expect **18/18 checks passed**. If a check fails, see
[troubleshooting.md](./troubleshooting.md) before going further — a failing
doctor check almost always turns into a confusing runtime error later.

> ### The one rule that matters
>
> **Use `npx expo install`, never bare `npm install`, for anything Expo-managed.**
>
> `npm install <pkg>` resolves to `latest`, which is frequently a *different
> SDK's* version. `npx expo install <pkg>` asks Expo's registry which version
> pairs with your installed SDK. Getting this wrong produces errors that point
> nowhere near the actual cause — see the `babel-preset-expo` case in
> [troubleshooting.md](./troubleshooting.md#hermes-private-properties-are-not-supported).

---

## 3. Configure

Copy the example environment file:

```bash
cp .env.example .env
```

Set `EXPO_PUBLIC_API_URL` to wherever the .NET backend is listening. The correct
value depends on where the *app* runs, not where the server runs:

| App runs on | Use |
| --- | --- |
| iOS simulator | `http://localhost:5187` |
| Android emulator | `http://10.0.2.2:5187` |
| Physical device | `http://<your-machine-LAN-IP>:5187` |

A physical device cannot reach `localhost` — that resolves to the phone itself.
Find your LAN IP with `ipconfig` (Windows) or `ifconfig | grep inet` (macOS).

The `EXPO_PUBLIC_` prefix is required: it is what tells Expo to inline the value
into the client bundle. **Anything with that prefix ships to the client and is
readable by anyone with the app** — never put a secret behind it.

If `.env` is absent the app falls back to `http://localhost:5187`. Nothing
breaks without a backend; every screen reads from local SQLite, and sync failures
are swallowed by design. See [data-and-sync.md](./data-and-sync.md).

---

## 4. Choose how to run it

This app depends on four native modules that **are not present in Expo Go**:

| Module | Used for |
| --- | --- |
| `@shopify/react-native-skia` | The breathing orb |
| `react-native-mmkv` | Synchronous persistence (timers, store) |
| `react-native-track-player` | Background audio and lock-screen controls |
| `react-native-worklets` | Reanimated 4 on the New Architecture |

Each is loaded through a **guarded `require`**, so a missing binary degrades one
feature instead of failing the bundle. That makes Expo Go usable for UI work,
but you need a development build to see the app as designed.

| | Expo Go | Development build |
| --- | --- | --- |
| Setup time | ~1 minute | 10–20 minutes first time |
| Needs Xcode / Android Studio | No | Yes |
| Skia breathing orb | Fallback renderer | Full |
| Persistence across reloads | No (in-memory) | Yes |
| Background audio | No (no-op) | Yes |
| Tabs, screens, SQLite, timers, notifications | Yes | Yes |

---

## 5. Expo Go (fastest, partial features)

```bash
npx expo start
```

Then:

- press `i` — iOS simulator
- press `a` — Android emulator
- or scan the QR code with the **Expo Go** app on a physical device

What is degraded, and what you will see:

| Feature | Behaviour in Expo Go |
| --- | --- |
| Breathing orb | Falls back to a plain Reanimated circle. No gradient, no blur halo. A note at the bottom of the screen says so. |
| MMKV | Falls back to an in-memory `Map`. Timers and the energy store work for the session but reset on reload. A `[storage]` warning is logged once. |
| Soundscapes / NSDR | Silently no-op. An `[audio]` warning is logged once. |
| Everything else | Works normally |

The breathing **timing and haptics are identical** in the fallback — it is driven
by the same `SharedValue` — so it remains a valid way to tune the cycle.

---

## 6. Development build (full features)

A development build is your own app binary with the native modules compiled in,
plus the Expo dev client for fast refresh. You build it once and then use
`npx expo start` normally.

### Generate the native projects

```bash
npx expo prebuild --clean
```

This reads `app.json` and writes `ios/` and `android/` directories. Both are
**gitignored on purpose** — they are build output, regenerated from `app.json`.
Never hand-edit them; edit `app.json` and re-run prebuild, or write a config
plugin.

### Build and install

iOS (macOS only):

```bash
npx expo run:ios
```

Android:

```bash
npx expo run:android
```

Each compiles the native project, installs it on the booted simulator/emulator
or connected device, and starts Metro. First run takes 10–20 minutes; later runs
are cached.

### Physical device notes

- **iOS** — you need a free Apple Developer account. Open `ios/Recovery.xcworkspace`
  in Xcode, select your team under *Signing & Capabilities*, then
  `npx expo run:ios --device`.
- **Android** — enable Developer Options and USB debugging, then
  `npx expo run:android --device`.

Test haptics and lock-screen audio on a **physical device**. Simulators have no
taptic engine and no lock screen worth the name.

### When you need to rebuild

| Change | Action |
| --- | --- |
| JS/TS, styles, components | Nothing — fast refresh handles it |
| Added a JS-only dependency | Restart Metro |
| Added a **native** dependency | `npx expo prebuild --clean` then `run:ios` / `run:android` |
| Changed `app.json` (permissions, plugins, background modes) | Same as above |

---

## 7. Daily workflow

Once a dev build is installed:

```bash
npx expo start
```

Useful keys in the Metro terminal:

| Key | Does |
| --- | --- |
| `r` | Reload the app |
| `j` | Open React Native DevTools |
| `m` | Toggle the dev menu on device |
| `shift+i` / `shift+a` | Pick a specific simulator/emulator |
| `c` | Clear the terminal |

Clear the Metro cache when something is stale in a way that makes no sense
(usually after a dependency change):

```bash
npx expo start --clear
```

Before committing:

```bash
npm run typecheck
```

---

## 8. Verifying it actually works

### Bundle health

```bash
npm run typecheck
```

```bash
npx expo export --platform android --output-dir dist-check
```

`export` runs the same Metro pipeline as a production build *and* compiles to
Hermes bytecode, which catches a class of error `expo start` does not. Delete
`dist-check/` afterwards.

### Tab navigation and the shell

Tap through **Енергія → Фокус → Сон → Детокс**. Check each of these:

| Check | Expected |
| --- | --- |
| Inactive tabs | `neutral-600` grey glyphs, Lucide at stroke 1.5 |
| Active tab | Lifts to `amber-200`; the other three stay grey |
| Background | Strictly `#000000` — bar, screen, and the strip behind the home indicator |
| Top edge of the bar | A hairline, not a visible grey band |
| Haptic | A light selection tick on each **switch**; re-tapping the active tab gives none |

**Safe area**, the part most worth watching for: launch the app cold and watch
the tab bar on the **first frame**. It should already be at its final height. If
it snaps downward a frame after launch, `initialWindowMetrics` is not reaching
`SafeAreaProvider`.

Then rotate, and on Android switch between gesture navigation and three-button
navigation in system settings. The glyphs should stay the same distance above
the bottom edge in every case, and no screen content should end up under the
bar. See [architecture.md](./architecture.md#safe-area).

### The breathing orb and its haptics

Енергія → **Physiological sigh**. On a physical device you should feel, in order:

| Cue | When | Feel |
| --- | --- | --- |
| `impactAsync(Light)` | Orb starts expanding | Light tap |
| `impactAsync(Rigid)` | ~1.6 s in, orb tops out | Sharper, distinct tap |
| `impactAsync(Soft)` | Orb starts shrinking | Soft, diffuse |
| `notificationAsync(Success)` | After the 5th cycle | Success pattern |

To confirm the animation is really on the UI thread: open the dev menu →
*Performance Monitor* and watch the JS thread stay near-idle while the orb
animates. Full detail in [breathing.md](./breathing.md).

### Timers surviving an app kill

This is the behaviour most worth testing properly:

1. Focus tab → **90 min focus**.
2. Note the countdown. Background the app, lock the phone.
3. Force-quit from the app switcher.
4. Reopen a minute later — the countdown reflects **real elapsed time**, not the
   moment you left.

To watch the notification fire with the process dead, temporarily set
`ULTRADIAN.focusMs` to `30 * 1000` in `src/services/timerEngine.ts`, start a
block, force-quit, and wait 30 seconds. Full detail in
[timers.md](./timers.md#testing-that-it-survives).

### Background audio

Requires a dev build **and** real soundscape URLs (the defaults point at
`cdn.example.com`). Focus tab → pick a soundscape → start a block → lock the
phone. Playback continues and transport controls appear on the lock screen. See
[audio.md](./audio.md).

---

## 9. Scripts reference

```bash
npm start          # Metro dev server
npm run ios        # build + install + run the iOS dev client
npm run android    # build + install + run the Android dev client
npm run prebuild   # regenerate ios/ and android/ from app.json
npm run typecheck  # tsc --noEmit
npm run lint       # expo lint
npm run doctor     # expo-doctor
```
