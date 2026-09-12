# Architecture

How the pieces fit, and why they were chosen that way.

- [The shape of the app](#the-shape-of-the-app)
- [Layers](#layers)
- [Where state lives](#where-state-lives)
- [Startup sequence](#startup-sequence)
- [Routing](#routing)
- [Module map](#module-map)
- [Threading model](#threading-model)
- [Cross-cutting conventions](#cross-cutting-conventions)

---

## The shape of the app

Four ideas drive every structural decision:

1. **The device is the source of truth.** SQLite holds the record; the server is
   a replica that may or may not be reachable. There is no loading skeleton
   anywhere in this app because no screen ever waits on a network request.
2. **Time is absolute, never counted.** Timers store an end *instant*, and the
   remaining time is subtracted on every render. Nothing accumulates, so nothing
   drifts.
3. **Animation belongs on the UI thread.** The breathing cycle runs entirely in
   Reanimated worklets and a Skia scene graph. React does not re-render during a
   breath.
4. **Missing native modules degrade one feature, not the bundle.** Every native
   dependency is behind a guarded `require` with a working fallback.

---

## Layers

```
┌──────────────────────────────────────────────────────────────┐
│  app/            Expo Router screens — layout and composition │
│                  No business logic, no direct SQLite access   │
└───────────────────────────┬──────────────────────────────────┘
                            │ hooks
┌───────────────────────────▼──────────────────────────────────┐
│  src/api/hooks   TanStack Query — the only thing screens call │
│                  Reads hit SQLite. Only sync/insights hit HTTP│
└───────┬───────────────────────────────────┬──────────────────┘
        │                                   │
┌───────▼─────────────────┐   ┌─────────────▼──────────────────┐
│ src/db/localDb.ts       │   │ src/api/client.ts              │
│ SQLite. Durable record. │   │ Typed fetch → .NET backend     │
│ Every row has sync_state│   │ Timeout, auth, ProblemDetails  │
└─────────────────────────┘   └────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  src/services/   Stateful subsystems, framework-agnostic      │
│    timerEngine   storage(MMKV)   notifications   audioPlayer  │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  src/store/      Zustand — what the UI needs *right now*      │
│  src/theme/      Colour tokens, shared with Tailwind by hand  │
│  src/lib/        Thin, never-throwing wrappers (haptics)      │
└──────────────────────────────────────────────────────────────┘
```

**The rule:** screens import from `src/api/hooks/`, `src/store/`, and
`src/services/`. Screens never import `localDb` directly. That keeps query-cache
invalidation in one place instead of scattered across the UI.

---

## Where state lives

Four stores, each with a distinct job. Putting a value in the wrong one is the
easiest way to make this app confusing.

| Store | Holds | Survives | Use when |
| --- | --- | --- | --- |
| **SQLite** (`src/db/localDb.ts`) | Every session, check-in, ritual tick — forever | Reinstall? No. Restart? Yes | The value is history, or the server needs it |
| **MMKV** (`src/services/storage.ts`) | Active timer, persisted Zustand snapshot | Restart, force-quit | You need it **synchronously**, on the first frame |
| **Zustand** (`src/store/useEnergyStore.ts`) | Today's score, chosen soundscape, detox armed | Restart (via MMKV persist) | Several screens read it and it changes often |
| **TanStack Query** (`src/api/queryClient.ts`) | Cached results of SQLite reads and server calls | Process lifetime | You are reading, and want caching + invalidation |

### Why MMKV and not AsyncStorage

`timerEngine` must read `targetEndTimestamp` **during the first render pass**,
before any effect runs. AsyncStorage is promise-based, so it would force a
loading state onto the one screen that must never have one — you would see
`--:--` flash before the real countdown appeared. MMKV is memory-mapped and
synchronous, so `getActiveTimer()` returns a value inline in `useState`'s
initialiser.

### Why SQLite *and* Zustand for the energy score

They answer different questions. SQLite answers *"what did the user report on
the 3rd?"*; Zustand answers *"what number should this dial show right now?"*.
`hydrateFromDb()` reconciles the two on launch and on every foreground, with
SQLite winning, and rolls the value over when the local date changes.

---

## Startup sequence

`app/_layout.tsx` holds the splash screen until the app can render real data.

```
index.js
  ├─ register TrackPlayer playback service   (guarded; before React)
  └─ require('expo-router/entry')
       │
       └─ app/_layout.tsx
            ├─ SplashScreen.preventAutoHideAsync()
            │
            ├─ await SystemUI.setBackgroundColorAsync('#000000')
            ├─ await initializeDatabase()      ← blocking: schema must exist
            ├─ await hydrateFromDb()           ← blocking: store must be true
            ├─ setReady(true) ─────────────────→ splash fades out
            │
            ├─ void ensureNotificationPermissions()   ← non-blocking
            └─ void setupAudioPlayer()                ← non-blocking
```

Only two things block the splash: the schema and the store reconcile. Both are
fast and local. Permission prompts and the audio session are deliberately fired
*after* first paint — neither is needed to render, and prompting during launch
makes the app feel slow and pushy.

If either blocking step throws, `bootError` is set, `ready` flips to `true`
anyway, and a banner explains the problem above a fully-usable app. A missing
native module should never be a black screen.

The registration in `index.js` must happen **before** `expo-router/entry`
evaluates, which is why both are `require()` calls rather than `import`
statements — ES module imports are hoisted and would reorder them.

---

## Routing

File-based, via Expo Router. `experiments.typedRoutes` is on, so `router.push()`
is typechecked against the actual file tree.

```
app/
├── _layout.tsx              Root Stack. Providers, splash lock, theme.
├── +not-found.tsx           404
├── (tabs)/
│   ├── _layout.tsx          Bottom tab bar (4 tabs)
│   ├── index.tsx            Today   — energy check-in, quick reset
│   ├── focus.tsx            Focus   — ultradian timer, soundscapes
│   ├── sleep.tsx            Sleep   — caffeine, wind-down, NSDR
│   └── detox.tsx            Detox   — screen-free timer, micro-quests
└── modal/
    └── breathing.tsx        Fullscreen breathing session
```

`(tabs)` is a **route group**: the parentheses mean it organises files without
appearing in the URL. `/index.tsx` inside it is reachable as `/`, not `/(tabs)/`.

The breathing screen is a `fullScreenModal` presented with
`animation: 'slide_from_bottom'` — rising into the screen matches the inhale
that follows it, where a horizontal push would not.

Provider order in the root layout is not arbitrary:

```
GestureHandlerRootView      ← must be outermost, wraps native gesture handling
  SafeAreaProvider          ← insets must exist before any screen measures
    QueryClientProvider     ← hooks below need the client
      ThemeProvider         ← React Navigation dark theme
        Stack
```

### Safe area

Two decisions keep the chrome stable across a Dynamic Island iPhone, a notched
Android, and a device with hardware keys.

**`SafeAreaProvider` is given `initialMetrics`:**

```tsx
<SafeAreaProvider initialMetrics={initialWindowMetrics}>
```

Without it the provider mounts with **zero** insets, measures natively, then
re-renders with the real ones — so the tab bar and every screen header visibly
snap downward one frame after launch. `initialWindowMetrics` is read
synchronously from the native side at startup, so the first paint is already
correct.

**The tab bar height is derived, never hardcoded:**

```ts
height: layout.tabBarContentHeight + insets.bottom,
paddingBottom: insets.bottom,
```

A fixed `Platform.OS === 'ios' ? 88 : 68` is wrong on every device it was not
measured on — too tall on an iPhone SE, too short on a gesture-navigation
Android — and it shifts the moment the inset resolves. Deriving it means the
glyphs sit the same distance above the home indicator everywhere.

The scroll container in `Screen` adds the **top** inset (clearing the Dynamic
Island) but not the bottom: the tab bar is laid out as a sibling below the
scene and already absorbs `insets.bottom`, so adding it again would leave a
stripe of dead space under every screen.

---

## Module map

| File | Responsibility |
| --- | --- |
| `src/services/timerEngine.ts` | Absolute-timestamp timers, pub/sub, `useCountdown`. See [timers.md](./timers.md) |
| `src/services/storage.ts` | MMKV wrapper + in-memory fallback, `StorageKeys`, Zustand adapter |
| `src/services/notifications.ts` | Permissions, Android channel, `scheduleAt`, cancellation |
| `src/services/audioPlayer.ts` | Player setup, soundscapes, NSDR, fade-out. See [audio.md](./audio.md) |
| `src/services/playbackService.ts` | Headless remote-control handler (lock screen, Bluetooth) |
| `src/db/localDb.ts` | Schema, migrations, all SQL. See [data-and-sync.md](./data-and-sync.md) |
| `src/store/useEnergyStore.ts` | Zustand store + selector hooks |
| `src/api/client.ts` | `apiFetch`, `ApiError`, base URL resolution, auth hook-in |
| `src/api/queryClient.ts` | Query defaults and the `queryKeys` registry |
| `src/api/types.ts` | .NET DTOs — replace wholesale with generated output |
| `src/api/hooks/useSessions.ts` | Every hook a screen is allowed to call |
| `src/components/breathing/useSighCycle.ts` | The breath state machine. See [breathing.md](./breathing.md) |
| `src/components/breathing/PhysiologicalSigh.tsx` | Skia canvas + Reanimated fallback |
| `src/components/ui/Screen.tsx` | `Screen`, `SectionLabel`, `Card` |
| `src/components/ui/icons.ts` | Every Lucide icon the app uses, deep-imported. See [design-system.md](./design-system.md#icons) |
| `src/components/ui/PressableScale.tsx` | Spring press feedback + haptic |
| `src/theme/tokens.ts` | `palette`, `accents`, navigation theme |
| `src/lib/haptics.ts` | Never-throwing haptic wrappers with semantic names |

---

## Threading model

Three execution contexts, and it matters which one code runs in.

| Context | What runs there | Rules |
| --- | --- | --- |
| **JS thread** | React, SQLite calls, network, most app logic | Can block. Never put per-frame work here |
| **UI thread** | Reanimated worklets, Skia scene graph | Must stay under the frame budget. Reach JS only via `runOnJS` |
| **Headless JS** | `playbackService.ts` | Outlives the UI. No React state, no navigation |

The breathing animation is the clearest example. `lungFullness` is a
`SharedValue` mutated by a single `withSequence` on the UI thread; every visual
property derives from it via `useDerivedValue`. React renders the screen once and
then does nothing for the rest of the session. The only JS-thread work per phase
is one haptic call and one caption update, hopped across with `runOnJS` from each
segment's completion callback.

This is what lets the orb stay smooth while SQLite writes a session row.

---

## Cross-cutting conventions

**Guarded native imports.** Any module absent from Expo Go is loaded with
`require` inside `try/catch` at module scope, with the result cached:

```ts
let moduleRef: Module | null | undefined;
function loadModule() {
  if (moduleRef !== undefined) return moduleRef;
  try { moduleRef = require('some-native-module'); }
  catch { moduleRef = null; }
  return moduleRef;
}
```

A static `import` would throw at bundle-evaluation time, before any fallback
could run. The `undefined` vs `null` distinction is load-bearing: `undefined`
means "not tried yet", `null` means "tried, unavailable".

**Path alias.** `@/*` maps to `src/*` (`tsconfig.json`, honoured by Metro).
Use `@/services/timerEngine`, never `../../services/timerEngine`.

**Colour lives in two places, by necessity.** `tailwind.config.js` serves
`className`; `src/theme/tokens.ts` serves everything that cannot take one —
Skia paints, React Navigation, notification accents, `StatusBar`. **They must be
edited together.** See [design-system.md](./design-system.md).

**Errors that are not errors.** Offline sync failures, denied haptics, and a
missing audio module are all expected states, swallowed deliberately. Genuine
faults surface: a failed `setupPlayer` that is *not* a double-init is logged, and
a failed DB init reaches the boot banner.
