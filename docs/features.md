# Features

What each screen does, the rules behind it, and what gets written where.

- [The shell](#the-shell)
- [Енергія / Today](#енергія-today--apptabsindextsx)
- [Фокус / Focus](#фокус-focus--apptabsfocustsx)
- [Сон / Sleep](#сон-sleep--apptabssleeptsx)
- [Детокс / Detox](#детокс-detox--apptabsdetoxtsx)
- [Breathing](#breathing--appmodalbreathingtsx)

---

## The shell

`app/(tabs)/_layout.tsx`. Four bottom tabs, in this order:

| Tab | Icon (Lucide) | Route |
| --- | --- | --- |
| **Енергія** | `Zap` | `app/(tabs)/index.tsx` |
| **Фокус** | `Target` | `app/(tabs)/focus.tsx` |
| **Сон** | `Moon` | `app/(tabs)/sleep.tsx` |
| **Детокс** | `ShieldOff` | `app/(tabs)/detox.tsx` |

**Colour.** Inactive glyphs are `neutral-600` (`#525252`); the active tab lifts
to `amber-200` (`#FDE68A`) — one colour for all four, not a per-tab accent. The
bar, the scene behind it, and the strip behind the home indicator are all
`#000000`. Elevation and shadow are both zeroed and the top edge is a
`StyleSheet.hairlineWidth` rule, because a full pixel reads as a grey band
against true black. Rationale in
[design-system.md](./design-system.md#the-tab-bar-is-the-exception).

**Icons** are Lucide at stroke 1.5, size 22. There are no filled variants, so
nothing changes weight or shape as you navigate — colour alone marks the active
tab.

**Haptics.** Switching tabs fires `Haptics.selectionAsync()` via
`haptics.select()`, wired once through `screenListeners` rather than per screen.
It fires only on an actual switch:

```tsx
tabPress: () => {
  if (!navigation.isFocused()) haptics.select();
}
```

`isFocused()` is evaluated before navigation happens, so it still reports the
outgoing state. Re-tapping the active tab scrolls to top instead of navigating,
and does not get a cue.

**Safe area.** The bar height is `layout.tabBarContentHeight + insets.bottom`
with matching `paddingBottom`, never a hardcoded per-platform number, and
`SafeAreaProvider` is seeded with `initialWindowMetrics` so the first frame is
already correct. Together those are what stop the launch-time height jump on a
Dynamic Island iPhone or a gesture-navigation Android. Detail in
[architecture.md](./architecture.md#safe-area).

---

## Енергія (Today) — `app/(tabs)/index.tsx`

**Accent:** warm amber `#D9A05B`

The dashboard. One honest number, then the shortest path to changing it.

### Energy check-in (1–5)

Five circular targets. One tap records the day.

| Score | Label |
| --- | --- |
| 1 | Depleted |
| 2 | Low |
| 3 | Steady |
| 4 | Good |
| 5 | Charged |

**Rules:**

- **One check-in per day.** A second tap on the same local date *overwrites*
  rather than appending — the user is correcting themselves, not logging a
  second reading. Enforced by `upsertEnergyCheckin`, which looks up by
  `local_date` first.
- **The write is optimistic.** `setEnergy` updates Zustand synchronously so the
  dial responds on the same frame as the tap, then awaits the SQLite write.
- **The score expires at midnight.** `hydrateFromDb` compares the stored
  `scoreDate` against today's `localDateKey()` and clears it on rollover.
- The scale is deliberately coarse. A finer one invites fiddling and produces
  worse data.

Written to: `energy_checkins` (SQLite) + `todayScore`/`scoreDate` (Zustand → MMKV).

### In-progress card

Appears only when a timer is running. Shows the block label and live countdown,
and taps through to the Focus tab. Reads `useCountdown()` — the same hook and the
same MMKV row the Focus screen uses, so the two can never disagree.

### Quick reset

Opens the fullscreen breathing modal. About 45 seconds.

### Today so far

Three stat tiles:

| Tile | Source |
| --- | --- |
| Focus (min) | `getFocusMinutesForDay()` — SUM of completed focus sessions for the local day |
| Breaths (cycles) | `breathCyclesToday` in Zustand, reset on date rollover |
| Energy (of 5) | Today's score, or `—` |

### On mount

Fires `useSyncPendingMutations()` once, in an effect, to drain anything written
while offline. Deferred to an effect so it never delays first paint, and its
failure is silent.

---

## Фокус (Focus) — `app/(tabs)/focus.tsx`

**Accent:** deep indigo `#5A63A8` (break blocks switch to sage `#7C9A83`)

Ultradian rhythm: a 90-minute block of work, then 20 minutes of genuine rest.

```ts
ULTRADIAN = { focusMs: 90 * 60 * 1000, breakMs: 20 * 60 * 1000 }
```

### Starting a block

1. Insert a `sessions` row (`type: 'focus' | 'break'`, `sync_state: 'pending'`).
   **Local row first** — if the notification schedule fails because permission
   was denied, the session is still recorded.
2. `controls.start(kind, label, durationMs)` writes the active timer to MMKV and
   schedules an OS notification for `targetEndTimestamp`.
3. For a focus block only, start the selected soundscape. **Breaks play nothing** —
   a break is for rest, not more input.

### The countdown

Derived, never counted. See [timers.md](./timers.md). Progress is a single
3px hairline rule rather than a ring: less to look at, and readable at a glance
from across a desk.

### Transport

| Control | Behaviour |
| --- | --- |
| **Pause** | Stamps `pausedAt`, **cancels** the pending notification (its fire time is now wrong), pauses audio |
| **Resume** | Rebases `targetEndTimestamp` by the elapsed pause, reschedules the notification, resumes audio |
| **End** | Cancels the timer and its notification, stops audio, drops the session row reference |

Ending early leaves the `sessions` row open (`completed = 0`), which is accurate:
the block was started and abandoned.

### Completion

`useCountdown(handleComplete)` fires once per timer id on the first tick that
observes zero — including the tick forced by returning to the foreground. It
fires a success haptic, marks the session row complete, stops audio, and clears
the timer.

### Soundscape selection

Five options: Silence, Brown noise, Rain, Deep drone, Forest. Selecting one
while a focus block is running **swaps the bed live**, so the choice is audible
immediately. The selection persists in Zustand. See [audio.md](./audio.md).

---

## Сон (Sleep) — `app/(tabs)/sleep.tsx`

**Accent:** light indigo `#8790D6`

The circadian sleep hub (EPIC 4). Three stacked concerns, each its own
component: `CircadianPanel`, `SleepPlayer`, `WindDownChecklist`.

### Circadian widget — caffeine cutoff & digital sunset (FE-402)

Everything derives from one number, the **target bedtime**, set with a −/+ 30-min
stepper (clamped 20:00–23:30, default 23:00, stored in `StorageKeys.sleepTarget`):

```
caffeineCutoff = targetSleep − 9h   (adenosine can rebuild before bed)
digitalSunset  = targetSleep − 1h   (melatonin is not suppressed by light)
```

`computeCircadian` in `src/services/circadian.ts` rolls both to the next night
once tonight's bedtime has passed. Each card carries a **live status badge**:

| Card | Before the deadline (green / indigo) | After (amber) |
| --- | --- | --- |
| Кава | `Кава дозволена ще 2г 15хв` | `Caffeine Cutoff: пийте лише воду / трав'яний чай` |
| Digital Sunset | `Екрани вимкнути через 1г 40хв` | `Digital Sunset: час без екранів` |

Recomputed every 30 s and on foreground, so "time remaining" stays honest.

### Sleep player + sleep timer (FE-401)

`SleepPlayer` starts NSDR sessions or nature soundscapes through the shared audio
engine (`react-native-track-player`). Playback continues with the screen locked
and shows native lock-screen controls (title + play/pause); the now-playing bar
mirrors play/pause even when it is toggled from the lock screen, via
`addPlaybackListener`. See [audio.md](./audio.md).

The **sleep timer** (15 / 30 / 60 min) auto-stops playback, fading the volume out
over the final 30 seconds. It is a delta-timestamp timer like the focus engine —
`endAt` in MMKV, remaining derived — so it survives a reload; `src/services/sleepTimer.ts`.

### Wind-down checklist (FE-402 AC2)

Four keyed toggles, backed by the shared `ritual_completions` table (one tick per
key per local day) via the existing ritual hooks — optimistic, with rollback:

| Key | Toggle |
| --- | --- |
| `air` | Провітрити кімнату |
| `dim-lights` | Приглушити верхнє світло |
| `water` | Випити води |
| `phone-away` | Телефон на зарядку далеко від ліжка |

---

## Детокс (Detox) — `app/(tabs)/detox.tsx`

**Accent:** sage green `#7C9A83`

### Screen-free windows

Three durations: **20 min**, **1 hour**, **3 hours**.

Starting one:

1. Inserts a `sessions` row (`type: 'detox'`).
2. **Stops all audio** — a detox window with a soundscape still running is not
   one.
3. Arms detox mode in Zustand (`detoxArmed`, `detoxStartedAt`).
4. Starts the timer, which schedules the single completion notification.

While running, the screen shows only the countdown and a promise: *"We will send
one notification when the window closes. Until then there is nothing to check."*

Ending early fires a **warning** haptic rather than a success one, and releases
detox mode.

### Analog micro-quests

Six quests. One is featured, chosen by `new Date().getHours() % 6` — stable
across re-renders, different each time the user comes back. The rest are listed
below it.

| Quest | Point |
| --- | --- |
| Walk one block without headphones | Notice five sounds you cannot normally hear |
| Write half a page by hand | Anything. Legibility optional |
| Look at something 20 metres away | Let the ciliary muscle unclench |
| Make a drink slowly | No podcast, no second screen |
| Step outside and find the horizon | Panoramic vision lowers arousal |
| Fix one small broken thing | The drawer, the button, the wobbly leg |

**Every quest is deliberately unrecordable** — no photo, no log, nothing to post.
A quest that produces a shareable artefact defeats the purpose.

---

## Breathing — `app/modal/breathing.tsx`

**Accent:** sage green `#7C9A83`. Presented as a fullscreen modal sliding up
from the bottom.

The physiological sigh: two inhales through the nose, then a long exhale.

| Phase | Duration | Target fullness | Haptic | Caption |
| --- | --- | --- | --- | --- |
| Inhale 1 | 1600 ms | 0.68 | Light | "Inhale through your nose" |
| Inhale 2 | 700 ms | 1.0 | Rigid | "Sip a little more" |
| Exhale | 5500 ms | 0.0 | Soft | "Long, slow exhale" |
| Rest | 900 ms | 0.0 | — | "Rest" |

One cycle is **8.7 s**; the session is **5 cycles ≈ 45 s**, then a success
haptic and an auto-dismiss 1.4 s later (letting the final exhale land).

**Design rules:**

- **Auto-starts on mount.** The user tapped "quick reset" to breathe, not to
  read a start button.
- **Almost nothing on screen** — an orb, one line, five dots. No timer, no
  progress bar. Anything that invites the eye to measure progress pulls the user
  out of the exercise.
- **Dots, not a percentage.** Countable at a glance, unreadable as a ratio.
- `useKeepAwake()` prevents the screen dimming mid-exhale — a cycle passes with
  no touch input.
- The close button is small and low-contrast so it does not compete with the orb.

Written to: a `sessions` row (`type: 'breathing'`), completed only if all five
cycles finish; plus `breathCyclesToday` in Zustand, incremented per cycle.

Full implementation detail in [breathing.md](./breathing.md).
