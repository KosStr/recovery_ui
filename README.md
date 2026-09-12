# Recovery

Digital detox, focus, sleep and energy recovery. A local-first mobile app on
Expo SDK 54 with the New Architecture enabled, TypeScript, and NativeWind v4.

---

## Quick start

```bash
npm install
```

```bash
npx expo install --fix
```

```bash
npx expo start
```

Press `i` for the iOS simulator, `a` for Android, or scan the QR code with Expo
Go. That gets you the full UI with four features degraded — see
[Expo Go vs. a dev build](./docs/getting-started.md#4-choose-how-to-run-it).

For the real thing (Skia orb, persistence, background audio):

```bash
npx expo prebuild --clean && npx expo run:ios     # or run:android
```

Full setup, per-platform steps, and environment configuration:
**[docs/getting-started.md](./docs/getting-started.md)**

---

## Documentation

| Doc | Covers |
| --- | --- |
| **[getting-started.md](./docs/getting-started.md)** | Prerequisites, install, launching on every target, verification steps, scripts |
| **[architecture.md](./docs/architecture.md)** | Layers, where state lives, startup sequence, routing, threading model |
| **[features.md](./docs/features.md)** | What each screen does and the rules behind it |
| **[timers.md](./docs/timers.md)** | The delta-timestamp engine, pausing without drift, notifications |
| **[breathing.md](./docs/breathing.md)** | The sigh state machine, UI-thread animation, haptic sync, the Skia scene |
| **[data-and-sync.md](./docs/data-and-sync.md)** | SQLite schema, MMKV, Zustand, Query, the .NET sync contract |
| **[audio.md](./docs/audio.md)** | Background playback, lock-screen controls, the headless service |
| **[design-system.md](./docs/design-system.md)** | OLED palette, accents, typography, NativeWind conventions |
| **[troubleshooting.md](./docs/troubleshooting.md)** | Known failure modes and their causes |

---

## What it does

| Tab | Feature |
| --- | --- |
| **Енергія** (Today) | Energy check-in (1–5, one per day), active-block card, quick reset, day-at-a-glance stats |
| **Фокус** (Focus) | Ultradian 90/20 timer with live soundscape selection |
| **Сон** (Sleep) | Derived caffeine cutoff, five-step wind-down checklist, NSDR audio |
| **Детокс** (Detox) | Screen-free windows (20 min / 1 h / 3 h), analog micro-quests |
| **Breathing** | Fullscreen physiological sigh — Skia orb, haptic cues, 5 cycles ≈ 45 s |

---

## Stack

| Concern | Choice | Where |
| --- | --- | --- |
| Routing | Expo Router (file-based, typed routes) | `app/` |
| Styling | NativeWind v4 / Tailwind | `tailwind.config.js`, `global.css` |
| Icons | Lucide, deep-imported | `src/components/ui/icons.ts` |
| Ephemeral state | Zustand, persisted through MMKV | `src/store/` |
| Durable state | SQLite, local-first with per-row `sync_state` | `src/db/localDb.ts` |
| Server reads + sync | TanStack Query | `src/api/` |
| Animation | Reanimated 4 (UI thread) + Skia | `src/components/breathing/` |
| Audio | react-native-track-player | `src/services/audioPlayer.ts` |
| Timers | Absolute-timestamp engine + OS notifications | `src/services/timerEngine.ts` |

### Four decisions that shape everything

**Timers never count down.** One absolute `targetEndTimestamp` is persisted to
MMKV, and remaining time is subtracted on every render. Nothing accumulates, so
nothing drifts — and a scheduled OS notification covers completion while the
process is dead. → [timers.md](./docs/timers.md)

**SQLite is the source of truth, not the server.** Writes commit locally with a
client-generated UUID and `sync_state = 'pending'`; a batched push drains them
when the network happens to be there. No screen waits on a request, and there are
no loading skeletons anywhere. → [data-and-sync.md](./docs/data-and-sync.md)

**The breathing animation never touches React.** One `SharedValue` drives a Skia
scene graph on the UI thread; React renders the screen once and then does
nothing. That is what keeps it smooth while SQLite writes on the JS thread.
→ [breathing.md](./docs/breathing.md)

**Missing native modules degrade one feature, not the bundle.** Every native
dependency is behind a guarded `require` with a working fallback, which is why
the app is still explorable in Expo Go.
→ [architecture.md](./docs/architecture.md#cross-cutting-conventions)

---

## Project layout

```
app/                      Expo Router screens
├── _layout.tsx           Providers, splash lock, dark theme
├── (tabs)/               Енергія · Фокус · Сон · Детокс
└── modal/breathing.tsx   Fullscreen breathing session

src/
├── api/                  Typed client, Query config, hooks, .NET DTOs
├── components/
│   ├── breathing/        Sigh state machine + Skia canvas
│   └── ui/               Screen, Card, SectionLabel, PressableScale, icons
├── db/localDb.ts         Schema, migrations, all SQL
├── services/             timerEngine · storage · notifications · audio
├── store/                Zustand
├── theme/tokens.ts       Colour tokens for non-className consumers
└── lib/haptics.ts        Never-throwing semantic haptics

index.js                  Registers the TrackPlayer service, then the router
```

---

## Verified state

On Node 24.19.0 / npm 11.17.0:

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx expo export --platform android` | 5.29 MB Hermes bytecode |
| `npx expo export --platform ios` | 5.29 MB Hermes bytecode |
| `npx expo-doctor` | 18/18 checks pass |

**Not verified**, because it needs macOS or a connected device: the native build
itself (`expo run:ios` / `run:android`), real haptics, lock-screen audio, and
the safe-area behaviour on a Dynamic Island or gesture-navigation device.

---

## Before this is a real app

- **Soundscape URLs** in `src/services/audioPlayer.ts` point at
  `cdn.example.com`. Replace with your CDN; Opus/Ogg is the intended format.
  → [audio.md](./docs/audio.md#content)
- **API types** in `src/api/types.ts` are hand-written placeholders. Regenerate
  once the backend exposes OpenAPI:
  ```bash
  npx openapi-typescript http://localhost:5187/swagger/v1/swagger.json -o src/api/types.ts
  ```
- **API base URL** — copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_URL`.
  → [getting-started.md](./docs/getting-started.md#3-configure)
- **Auth** — `setAuthTokenProvider` in `src/api/client.ts` is wired but unused.
- **Sync is push-only.** Nothing reads server state back into SQLite yet.
- **The UI is bilingual, which is not a final state.** Story FE-101 specified
  Ukrainian tab labels, so the shell reads Енергія / Фокус / Сон / Детокс while
  every screen inside is still English. Strings are hardcoded at their use sites;
  wiring up `expo-localization` + `i18n-js` and extracting them is its own piece
  of work.
- **App icon and splash image** — `assets/` is empty; `app.json` ships a plain
  black splash.
- **Known risk:** `react-native-track-player` is listed as unsupported on the New
  Architecture. Exercise background audio early on real hardware.
  → [audio.md](./docs/audio.md#known-risk-the-new-architecture)

---

## Scripts

```bash
npm start          # Metro dev server
npm run ios        # build + install + run the iOS dev client
npm run android    # build + install + run the Android dev client
npm run prebuild   # regenerate ios/ and android/ from app.json
npm run typecheck  # tsc --noEmit
npm run lint       # expo lint
npm run doctor     # expo-doctor
```
