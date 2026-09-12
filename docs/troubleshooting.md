# Troubleshooting

- [First moves](#first-moves)
- [Hermes: "private properties are not supported"](#hermes-private-properties-are-not-supported)
- [Cannot find module 'babel-preset-expo'](#cannot-find-module-babel-preset-expo)
- [Styles do nothing](#styles-do-nothing)
- ["Cannot find native module" / red screen on launch](#cannot-find-native-module--red-screen-on-launch)
- [Nothing persists across reloads](#nothing-persists-across-reloads)
- [Audio does nothing](#audio-does-nothing)
- [Notifications never arrive](#notifications-never-arrive)
- [The countdown is wrong after backgrounding](#the-countdown-is-wrong-after-backgrounding)
- [Reanimated / worklet errors](#reanimated--worklet-errors)
- [expo-doctor failures](#expo-doctor-failures)
- [Network requests fail on device](#network-requests-fail-on-device)
- [Windows-specific](#windows-specific)

---

## First moves

In order of how often they help:

```bash
npx expo start --clear
```

```bash
npx expo-doctor
```

```bash
rm -rf node_modules package-lock.json && npm install && npx expo install --fix
```

If you changed `app.json`, added a native dependency, or changed permissions:

```bash
npx expo prebuild --clean
```

---

## Hermes: "private properties are not supported"

**Symptom.** Metro reports bundling *succeeded* — a few thousand modules — and
then the build dies:

```
error: private properties are not supported
      this.#length = elements.length;
           ^~~~~~~
Error: … hermesc.exe … exited with non-zero code: 2
```

The file it points at is React Native's own source
(`react-native/src/private/webapis/…`), which makes it look like an RN bug. It
is not.

**Cause.** A version mismatch in `babel-preset-expo`. Installing it with bare
`npm install babel-preset-expo` resolves to `latest` — which may be several major
versions ahead of your SDK. A newer preset targets a newer Hermes that *does*
support `#private` class fields, so it stops transpiling them. The Hermes shipped
with your SDK does not support them, and fails at bytecode compilation.

This happened during this project's setup: `babel-preset-expo@57` against
`expo@54`.

**Fix.** Install the SDK-matching version:

```bash
npx expo install --save-dev babel-preset-expo
```

Or check what your SDK wants and pin it explicitly:

```bash
node -e "console.log(require('./node_modules/expo/package.json').devDependencies['babel-preset-expo'])"
```

**Prevention.** Use `npx expo install` for anything Expo-managed. Always.

**The general lesson:** when Metro bundles fine but Hermes fails, suspect the
Babel toolchain, not your code. Bundling and bytecode compilation are separate
stages with separate inputs.

---

## Cannot find module 'babel-preset-expo'

```
SyntaxError: index.js: Cannot find module 'babel-preset-expo'
```

`babel.config.js` names it, so it must be a direct devDependency — being a
transitive dependency of `expo` is not enough.

```bash
npx expo install --save-dev babel-preset-expo
```

---

## Styles do nothing

Elements render but every Tailwind class is ignored.

**Check, in order:**

1. **`global.css` is imported** at the very top of `app/_layout.tsx`:
   ```ts
   import '../global.css';
   ```
2. **`metro.config.js` has `isCSSEnabled: true`** in `getDefaultConfig`, and
   exports `withNativeWind(config, { input: './global.css' })`.
3. **`babel.config.js`** has both `['babel-preset-expo', { jsxImportSource: 'nativewind' }]`
   and `'nativewind/babel'` in `presets`.
4. **The file is in `content`** in `tailwind.config.js` — currently
   `./app/**/*` and `./src/**/*`. A component elsewhere gets no classes.
5. **Restart Metro with `--clear`.** Tailwind config changes are not hot-reloaded.

### One class works, another does not

Almost always a **dynamically constructed class name**:

```tsx
// Never works — Tailwind scans source text and never sees this string
<View className={`border-${color}`} />
```

Tailwind generates CSS by scanning for literal class names. Use `style` for
runtime-computed values. See
[design-system.md](./design-system.md#conventions).

### Styles ignored on one specific component

If it is wrapped in `Animated.createAnimatedComponent(...)`, NativeWind does not
interop it and silently drops `className`. Put the class on a plain core
component and the animation on an inner `Animated.View` — see how
`PressableScale` is structured.

---

## "Cannot find native module" / red screen on launch

You are in Expo Go with a module that needs a dev build, **or** you added a
native dependency without rebuilding.

| If | Then |
| --- | --- |
| Running in Expo Go | Expected for Skia/MMKV/TrackPlayer. Build a dev client — see [getting-started.md](./getting-started.md#6-development-build-full-features) |
| You just installed a native package | `npx expo prebuild --clean` then `npx expo run:ios` / `run:android` |
| You changed `app.json` | Same as above |

This app degrades rather than crashing for its four known native modules. A red
screen means either a *fifth* module was added without a guard, or the failure is
elsewhere. The root layout catches startup errors and shows a banner instead of a
black screen — read the banner text.

---

## Nothing persists across reloads

Timers reset, the energy score disappears, the wind-down checklist clears.

**In Expo Go this is expected.** MMKV is a JSI module and is absent, so
`src/services/storage.ts` falls back to an in-memory `Map`. You will see this
once in the console:

```
[storage] react-native-mmkv unavailable (Expo Go?). Falling back to in-memory
storage — nothing will persist across reloads.
```

`storageIsPersistent` exports `false` in this state.

**In a dev build,** this indicates a real problem. Check that
`react-native-mmkv` is in `dependencies` and that you rebuilt after adding it.

Note that SQLite (`expo-sqlite`) **does** work in Expo Go, so session history
persists even when the timer does not.

---

## Audio does nothing

**In Expo Go**, expected — one warning, then silent no-ops:

```
[audio] react-native-track-player unavailable (Expo Go?). Audio controls will no-op.
```

**In a dev build,** work through:

1. **URLs.** The defaults point at `cdn.example.com` and do not resolve. Replace
   them in `src/services/audioPlayer.ts`.
2. **iOS background mode.** `app.json` → `ios.infoPlist.UIBackgroundModes` must
   include `"audio"`. Rebuild after changing.
3. **Android permissions.** `FOREGROUND_SERVICE` and
   `FOREGROUND_SERVICE_MEDIA_PLAYBACK` (required from API 34). Rebuild.
4. **Registration order.** `index.js` must register the playback service *before*
   `require('expo-router/entry')`, and `package.json` `main` must be `index.js`.
5. **New Architecture.** See the [known risk](./audio.md#known-risk-the-new-architecture).

### "The player has already been initialized"

Harmless after a Fast Refresh — the native player survived the JS reload.
`setupAudioPlayer` detects this message specifically and continues. If you see it
in a *fresh* launch, something is calling `setupPlayer` outside the cached
promise.

---

## Notifications never arrive

1. **Permission.** `ensureNotificationPermissions()` returns `false` if denied.
   Check OS settings; if the user hard-denied, `canAskAgain` is false and no
   further prompt will appear.
2. **Android channel.** Notifications sent to an unknown channel are dropped
   silently. The channel is `recovery-timers` and is created inside
   `ensureNotificationPermissions`.
3. **Under a second away.** `scheduleAt` returns `null` for targets less than
   1000 ms out. Not a bug.
4. **Android battery optimisation.** Aggressive OEM battery savers (Xiaomi,
   Huawei, OnePlus especially) suppress scheduled notifications. Exempt the app
   in system settings when testing.
5. **They fire but you do not see them in-app.** Check the
   `setNotificationHandler` block at the top of `src/services/notifications.ts` —
   without `shouldShowBanner`, a notification firing while the app is foregrounded
   is swallowed.

**Not a bug:** pausing a timer cancels its notification by design. It is
rescheduled against the rebased target on resume.

---

## The countdown is wrong after backgrounding

It should never be. If it is, check in this order:

1. **Is `remainingMs` being called with a fresh `now`?** The value must be
   derived from `Date.now()`, never from a stored counter.
2. **Is the `AppState` listener still in `useCountdown`?** Without the forced
   tick on `'active'`, the display can show a stale value for up to a second
   after return.
3. **Was the timer paused?** `remainingMs` uses `pausedAt` as its reference when
   set, which freezes the value on purpose.
4. **Expo Go?** MMKV falls back to memory, so the timer does not survive a
   reload at all there.

Full model in [timers.md](./timers.md).

---

## Reanimated / worklet errors

### "Tried to synchronously call a non-worklet function on the UI thread"

A callback passed into a Reanimated animation is calling JS-thread code directly.
Wrap it:

```ts
runOnJS(myJsFunction)(arg);
```

### The Babel plugin

`babel.config.js` must end with:

```js
plugins: ['react-native-worklets/plugin']
```

It must be **last**. On Reanimated 4 the plugin lives in
`react-native-worklets`, not `react-native-reanimated/plugin` — using the old
name will fail to resolve.

### Animations run but stutter

Something is doing per-frame work on the JS thread. Open the dev menu →
Performance Monitor. If the JS thread is busy during an animation, find what is
re-rendering — usually a component subscribed to a whole Zustand store instead of
one field.

---

## expo-doctor failures

### "Missing peer dependency"

Install it with `npx expo install <name>`, not `npm install`.

### "Duplicate native module dependencies"

Two versions of one native module, usually because something pulled a newer copy
to the top level. `npx expo install <name>` normally resolves it by installing
the SDK-correct version and letting npm dedupe.

### "Unsupported on New Architecture: react-native-track-player"

Known and deliberately excluded via `expo.doctor.reactNativeDirectoryCheck.exclude`
in `package.json`. It is a suppression, not a fix — read
[audio.md](./audio.md#known-risk-the-new-architecture) before relying on audio.

---

## Network requests fail on device

`localhost` on a phone means *the phone*. Set `EXPO_PUBLIC_API_URL` correctly:

| App runs on | URL |
| --- | --- |
| iOS simulator | `http://localhost:5187` |
| Android emulator | `http://10.0.2.2:5187` |
| Physical device | `http://<machine-LAN-IP>:5187` |

Also check:

- The .NET server binds to `0.0.0.0`, not just `localhost`, or it is unreachable
  from another device.
- Your firewall allows inbound connections on that port.
- **Android 9+ blocks cleartext HTTP by default.** Use HTTPS, or add a network
  security config via a config plugin for local development.
- Restart Metro after changing `.env` — `EXPO_PUBLIC_*` values are inlined at
  bundle time.

**Remember sync failures are silent by design.** `useSyncPendingMutations` has an
empty `onError` because offline is the expected state. To debug, add a
`console.log` there temporarily, or watch the network tab in React Native
DevTools (`j` in the Metro terminal).

---

## Windows-specific

**`node` / `npm` not recognised after installing.** `PATH` is read at shell
start. Open a new terminal. To refresh in the current PowerShell session:

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
```

**`EPERM: operation not permitted, rmdir` during `npm install`.** A file lock,
usually antivirus, OneDrive sync, or a running Metro process. Stop Metro, pause
OneDrive if the project is inside a synced folder, and retry.

**`ECONNRESET` during `npm install`.** Transient. Retry with longer timeouts:

```bash
npm install --fetch-retries=6 --fetch-retry-maxtimeout=120000 --fetch-timeout=600000
```

**Long path errors.** Enable long paths:

```powershell
git config --system core.longpaths true
```

**No iOS builds.** `expo run:ios` requires macOS. Everything else — Metro,
TypeScript, `expo start`, `expo export --platform ios`, and the whole Android
toolchain — works on Windows.
