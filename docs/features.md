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

The hour before bed, treated as the actual intervention.

### Caffeine cutoff

Derived rather than asked for. Working backwards from target bedtime:

```
cutoff = bedtime − 10 hours
```

With the default bedtime of 23:00, the cutoff is **13:00**. Caffeine's half-life
runs roughly six hours, so ten hours leaves a small enough fraction circulating
to matter. Asking the user to pick a cutoff time directly would only get a guess.

The card shows the cutoff time and either the remaining window (`Xh Ym left`) or
a passed state. Bedtime is read from MMKV (`StorageKeys.caffeineCutoff`,
default `23`); no UI writes it yet.

`computeCaffeineWindow` rolls the cutoff forward a day when it would otherwise
land more than 18 hours in the past, so late/after-midnight bedtimes never
produce a negative window.

### Wind-down ritual

Five steps, tickable, reset daily:

| Key | Step |
| --- | --- |
| `screens-off` | Screens down |
| `lights-low` | Lights below eye level |
| `temperature` | Room cooled |
| `tomorrow` | Tomorrow written down |
| `nsdr` | NSDR or breathing |

**Rules:**

- Steps are identified by **key, not index**, so reordering the list never
  orphans history.
- One tick per step per local day, enforced by a unique index on
  `(ritual_key, local_date)`.
- Toggling is **optimistic** via TanStack Query's `onMutate`, with rollback on
  error — a checklist tap must not wait on disk.

Written to: `ritual_completions` (SQLite).

### NSDR

Three guided tracks (10 / 20 / 30 minutes). Plays once, no looping, continues
with the screen off. Requires a dev build and real URLs.

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
