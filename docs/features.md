# Features

What each screen does, the rules behind it, and what gets written where.

- [The shell](#the-shell)
- [Енергія / Today](#енергія-today--apptabsindextsx)
- [Фокус / Focus](#фокус-focus--apptabsfocustsx)
- [Сон / Sleep](#сон-sleep--apptabssleeptsx)
- [Детокс / Detox](#детокс-detox--apptabsdetoxtsx)
- [Фізіологічний подих / Breathing](#фізіологічний-подих-breathing--appmodalbreathingtsx)

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

### Energy check-in (1–5) — FE-202

A horizontal **battery** selector (`src/components/energy/EnergyBattery.tsx`).
Tapping a cell fills the battery to that level, coloured by `ENERGY_SCALE`
(muted terracotta at 1 → sage at 5). One tap logs — no separate confirm.

| Score | Label (uk) |
| --- | --- |
| 1 | Вигорання |
| 2 | Низька |
| 3 | Рівна |
| 4 | Добра |
| 5 | Піковий фокус |

**Rules:**

- **Many check-ins per day, not one.** The story tracks energy *dips through the
  day*, so every tap is its own row (`insertEnergyCheckin`) and the headline
  figure is the **daily average** (`getTodayEnergyStats`). This reverses the
  earlier one-per-day upsert — see [data-and-sync.md](./data-and-sync.md#energy_checkins).
- **Instant (AC 3).** `logEnergy` folds the new score into the running average in
  Zustand on the tap's own frame, then writes SQLite and reconciles — 0 ms
  perceived latency.
- **Tags in a bottom sheet (AC 2).** Logging opens a sheet with quick chips —
  Після кави, Втома від екрана, Сонливість, Після прогулянки. Toggling a chip
  writes through to the row just created (`updateCheckinTags`). Tags are stored
  by stable id, shown by Ukrainian label.
- **Expires at midnight.** `hydrateFromDb` rolls the figures over on a date change.

Written to: `energy_checkins` (SQLite, one row per tap, tags in `context` as a
JSON array) + the day's average/count/latest in Zustand → MMKV.

### In-progress card

Appears only when a timer is running. Shows the block label and live countdown,
and taps through to the Focus tab. Reads `useCountdown()` — the same hook and the
same MMKV row the Focus screen uses, so the two can never disagree.

### Quick reset

Opens the fullscreen somatic-breathing modal (FE-201). About 80 seconds.

### Today so far

Three stat tiles:

| Tile | Source |
| --- | --- |
| Focus (min) | `getFocusMinutesForDay()` — SUM of completed focus sessions for the local day |
| Breaths (cycles) | `breathCyclesToday` in Zustand, reset on date rollover |
| Енергія (середнє) | The day's average score (`getTodayEnergyStats`), or `—` |

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

The screen is Ukrainian, consistent with the FE-101 shell, and **nothing here
blocks**: the break is offered, never forced, and the rest hints are advice, not
a takeover.

### Starting a block

1. Insert a `sessions` row (`type: 'focus' | 'break'`, `sync_state: 'pending'`).
   **Local row first** — if the notification schedule fails because permission
   was denied, the session is still recorded.
2. `controls.start(kind, label, durationMs)` writes the active timer to MMKV and
   schedules an OS notification for `targetEndTimestamp`.
3. For a focus block only, start the selected soundscape. **Breaks play nothing** —
   a break is for rest, not more input.

### The ring (FE-301)

A minimalist **Skia ring** with the time in the middle (`FocusRing`), not the
old hairline bar. Derived, never counted — see [timers.md](./timers.md#the-focus-ring-fe-301)
for the arc, the smoothing, and the Expo Go fallback. Caption reads `ФОКУС`,
`ПЕРЕРВА`, or `ГОТОВІ`; the arc and time turn sage during a break.

### The rest phase (AC3)

When a focus block finishes, a **dismissible** card offers the 20-minute break —
one tap starts it, an X waves it off, and the normal start buttons stay put. It
is a nudge, not a modal.

During a break the screen shows an **analog rest hint** — «Подивіться у вікно на
обрій 2 хвилини» and two alternates, picked by the break's start minute — plus a
soft line that the screen can be switched off (we can't lock it for you; the OS
forbids that, and the completion notification will fire regardless). No
soundscape plays over a break.

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
fires a success haptic, marks the session row complete, stops audio, clears the
timer, and — when a *focus* block finished — raises the dismissible break offer
above.

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

**Accent:** sage green `#7C9A83`. EPIC 5 — «Глибокий офлайн», voluntary
phone-down time meant to break the check-the-phone reflex. Ukrainian throughout.

### Глибокий офлайн → Zen mode (FE-501)

Three durations — **20 / 30 / 60 хв**. Starting one inserts a `sessions` row
(`type: 'detox'`), stops any audio, arms detox mode in Zustand, starts the shared
delta-timestamp timer (one completion notification), and **pushes the full-screen
Zen modal** (`app/modal/detox-zen.tsx`).

Zen mode is deliberately bare: a random analog quest, a white timer on true
black, nothing to tap. It is **display-only** — the Detox tab, still mounted
behind it, owns completion (the success haptic, clearing the timer), so nothing
double-fires. Closing Zen (the small ✕) leaves the timer running; the tab shows
its status and can reopen Zen or end early. Ending early fires a **warning**
haptic, not a success.

### Flip-to-Detox (FE-501 AC2)

`src/services/useFaceDown.ts` reads the accelerometer (`expo-sensors`): screen-up
`z ≈ +1`, screen-down `z ≈ −1`, with hysteresis (enter past −0.8, leave above
−0.6) so setting the phone down does not strobe. When **face down**, Zen mode
renders a pure-black void and **releases keep-awake**, so the display sleeps and
the OLED draws no power. The block still finishes on time — the timer is a
persisted timestamp and the **OS notification carries the completion buzz even
with the app asleep** (the "light vibration" of AC2). Flip up and the timer
returns. The sensor is polled at 2 Hz and only while Zen mode is open; where it
is unavailable (web, no sensor) flip-to-detox is simply skipped.

### Analog micro-quests (FE-501 AC1)

`src/components/detox/quests.ts`. A random quest is drawn at the start of each
detox (`pickRandomQuest`); the first three are the ones the criteria name:

| Quest | Point |
| --- | --- |
| Зроби 10 повільних ковтків холодної води | Без телефону в руках |
| Правило 20-20-20 | Точка за 6 м, 20 секунд |
| Розтягни трапецію та шию | Повільно, плечі вниз |
| …plus walk / write / horizon / fix-one-thing | Variety |

**Every quest is deliberately unrecordable** — no photo, no log, nothing to post.
A quest that produces a shareable artefact just feeds the loop it breaks.

---

## Фізіологічний подих (Breathing) — `app/modal/breathing.tsx`

**Accent:** sage green `#7C9A83`. Fullscreen modal sliding up from the bottom.
Story **FE-201**. Full mechanics in [breathing.md](./breathing.md).

Four phases — two inhales, a hold, a long exhale:

| Phase | Duration | Radius | Haptic | Caption |
| --- | --- | --- | --- | --- |
| Вдих носом | 1500 ms | 40→85% | Rising Light ramp | "Вдих носом" |
| Ще трохи повітря | 600 ms | 85→100% | Medium (довдих) | "Ще трохи повітря" |
| Затримайте | 1000 ms | 100% | — (glow pulses) | "Затримайте" |
| Повільний видих | 5000 ms | 100→40% | Light at start | "Повільний видих" |

One cycle is **8.1 s**; the session is **10 cycles ≈ 81 s**, then a success
haptic and an auto-dismiss 1.4 s later (letting the final exhale land).

**Design rules:**

- **Auto-starts on mount.** The user tapped "quick reset" to breathe, not to
  read a start button.
- **Заплющити очі (close eyes).** A full-black overlay drops over the running
  session; the exercise is then driven by vibration alone (AC 2). A tap brings
  the visual back without stopping it.
- **Almost nothing on screen** — an orb, one line, ten dots. No timer, no
  progress bar.
- **Dots, not a percentage.** Countable at a glance, unreadable as a ratio.
- `useKeepAwake()` prevents the screen dimming mid-hold.

Written to: a `sessions` row (`type: 'somatic_breathing'`, AC 3), completed only
if all ten cycles finish; plus `breathCyclesToday` in Zustand, incremented per
cycle.

Full implementation detail in [breathing.md](./breathing.md).
