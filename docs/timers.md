# Timers and notifications

`src/services/timerEngine.ts` and `src/services/notifications.ts`.

- [The problem](#the-problem)
- [The approach](#the-approach)
- [Data model](#data-model)
- [Lifecycle](#lifecycle)
- [Pausing without drift](#pausing-without-drift)
- [The React binding](#the-react-binding)
- [Notifications](#notifications)
- [The focus ring (FE-301)](#the-focus-ring-fe-301)
- [Testing that it survives](#testing-that-it-survives)
- [Extending it](#extending-it)

---

> **FE-301 mapping.** The Ultradian 90/20 timer is this engine, unchanged.
> AC1 (persist `targetEndTime` in MMKV + schedule an OS notification) is
> [Lifecycle](#lifecycle) and [Notifications](#notifications); the notification
> copy is the Ukrainian in the table below. **AC2 (return after 40 minutes with
> no catch-up ticks) needs no new code** — it is exactly what
> [The approach](#the-approach) already guarantees. AC3 (the rest phase) and the
> Skia ring UI live on the screen, in [features.md](./features.md#фокус-focus--apptabsfocustsx)
> and [the ring section below](#the-focus-ring-fe-301).

---

## The problem

A 90-minute focus block has to end 90 minutes after it started. Obvious, and
surprisingly easy to get wrong.

The naive implementation — `setInterval` decrementing a counter — fails in four
separate ways on a phone:

| Situation | What happens to a decrementing counter |
| --- | --- |
| App backgrounded | Timers are throttled. The counter falls behind |
| Screen locked | Timers suspend entirely. The counter freezes |
| OS reclaims memory | Process dies. The counter is gone |
| Long JS-thread work | Ticks are delayed. Small errors accumulate |

Every one of these produces a block that ends late, or never.

---

## The approach

**Never count down. Always subtract.**

One absolute instant is persisted — `targetEndTimestamp` — and every render
derives:

```ts
remaining = targetEndTimestamp - Date.now()
```

The interval in `useCountdown` exists **only to trigger repaints**. It is not
the source of truth. If it fires late, early, or not at all, the displayed value
is still correct the next time anything renders.

Three properties follow:

1. **No drift.** Nothing accumulates, so nothing can accumulate error.
2. **Survives a kill.** The instant is in MMKV. Reopen the app and the countdown
   picks up at the correct value.
3. **Survives with the app dead.** A local notification is scheduled with the OS
   for the same instant, so completion is announced even with no process
   running.

---

## Data model

```ts
interface ActiveTimer {
  id: string;                    // `${kind}-${startedAt}` — identity for completion
  kind: 'focus' | 'break' | 'detox' | 'winddown';
  label: string;                 // shown in the UI
  targetEndTimestamp: number;    // ← the single source of truth
  durationMs: number;            // full configured length, for the progress ratio
  startedAt: number;
  pausedAt?: number;             // set while paused
  notificationId?: string | null;// OS id, so we can retract it
}
```

Persisted as JSON in MMKV under `StorageKeys.activeTimer` (`'timer.active'`).

**Only one timer exists at a time.** `startTimer` calls `cancelActiveTimer()`
first, which guarantees no orphaned OS notification can outlive its timer.

`durationMs` is stored separately from the timestamps because pausing changes
`targetEndTimestamp`; without it, the progress bar would jump backwards on every
resume.

### Derived values

```ts
remainingMs(timer, now)   // max(0, target − (pausedAt ?? now))
progressRatio(timer, now) // clamped 0…1 of 1 − remaining/duration
formatDuration(ms)        // "MM:SS", or "H:MM:SS" past an hour
```

`remainingMs` uses `pausedAt` as the reference instead of `now` when set, which
is what freezes the display while paused — with no separate paused-value branch
in the UI.

---

## Lifecycle

```
startTimer({ kind, label, durationMs })
  ├─ cancelActiveTimer()                 retract any previous timer + notification
  ├─ targetEndTimestamp = now + duration
  ├─ scheduleAt(targetEnd, copy)         → notificationId | null
  ├─ write to MMKV
  └─ notify subscribers                  → every mounted useCountdown re-renders
```

`scheduleAt` returning `null` (permission denied, or under one second away) is
**not an error**. The timer still runs correctly; it just cannot announce itself
if the app is dead. Callers must treat `null` as "no notification", never as a
failure.

### The pub/sub

A four-line synchronous `Set<Subscriber>` inside the module:

```ts
function writeActiveTimer(timer: ActiveTimer | null): void {
  if (timer) storage.setJSON(StorageKeys.activeTimer, timer);
  else storage.remove(StorageKeys.activeTimer);
  subscribers.forEach((fn) => fn(timer));
}
```

This exists so the Today dashboard and the Focus screen — both mounted, both
showing the same countdown — can never disagree. Routing it through Zustand or
Query would work, but would add a dependency to a module that is otherwise pure
and framework-agnostic.

---

## Pausing without drift

Pausing is expressed in the same currency as everything else — an instant, not
a duration:

```
pause:   pausedAt = now
         cancel the pending notification   (its fire time is now wrong)

resume:  pausedFor = now − pausedAt
         targetEndTimestamp += pausedFor   ← rebase, do not accumulate
         reschedule the notification against the new target
         clear pausedAt
```

**Rebasing rather than accumulating** is the important part. There is no
"elapsed" accumulator to drift, so `remaining` stays correct to the millisecond
no matter how many pause cycles happen.

The notification *must* be cancelled on pause. Leaving it would fire at the
original time, announcing a block that still has minutes left.

---

## The React binding

```ts
const { timer, remaining, progress, isRunning, isPaused, hasCompleted }
  = useCountdown(onComplete?);
```

Three things it handles that are easy to miss:

**1. Foreground resync.** The 1-second interval is throttled or suspended while
backgrounded, so its last value is stale on return. An `AppState` listener forces
an immediate tick on `'active'`:

```ts
const onAppStateChange = (state: AppStateStatus) => {
  if (state === 'active') tick();
};
```

Without this, a user returning to the app would briefly see the time as of when
they left.

**2. Exactly-once completion.** `onComplete` fires once per timer **id**, guarded
by a ref:

```ts
if (completedIdRef.current === timer.id) return;
completedIdRef.current = timer.id;
```

Several ticks can land on an already-expired timer — the interval tick, the
foreground tick, a re-render. Without the guard, a session row would be marked
complete repeatedly.

**3. No resubscribe churn.** `onComplete` is held in a ref and reassigned each
render, so a caller passing an inline arrow does not tear down the subscription
every render.

`useTimerControls()` returns stable `start` / `pause` / `resume` / `cancel`
wrappers so screens read declaratively.

---

## Notifications

`src/services/notifications.ts`.

### Foreground presentation

```ts
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true, shouldShowList: true,
    shouldPlaySound: true, shouldSetBadge: false,
  }),
});
```

Without this, a notification firing while the app is open is swallowed — a user
watching the timer screen would see it hit zero with no confirmation.

### Permissions

`ensureNotificationPermissions()` caches its promise, so several screens asking
at once on first launch produce a single OS prompt. On Android it also creates
the `recovery-timers` channel with a short, soft vibration pattern
(`[0, 180, 120, 180]`) — this fires at the end of a *rest* block and should feel
like a tap on the shoulder, not an alarm.

The channel must exist before any notification targets it; Android silently
drops notifications to an unknown channel.

### Scheduling

```ts
scheduleAt(date, { title, body, data }) → Promise<string | null>
```

Returns `null` when the target is under a second away or permission was denied.
Uses `SchedulableTriggerInputTypes.DATE` — an absolute instant, matching the
timer's own model.

Per-kind copy lives in `NOTIFICATION_COPY` in `timerEngine.ts`:

| Kind | Title | Body |
| --- | --- | --- |
| `focus` | 90 хв фокусу завершено! | Відійдіть від екрана. Час на перерву. |
| `break` | Перерва завершена | Готові до наступного блоку фокусу? |
| `detox` | Screen-free window finished | You stayed off the glass. Log how it felt. |
| `winddown` | Wind-down starts now | Lights down, screens away. Sleep pressure is highest right now. |

`cancelScheduled(id)` is safe to call with a stale, `null`, or already-delivered
id.

### Required configuration

`app.json` carries what this needs:

- `expo-notifications` plugin, with `color: "#7C9A83"` and
  `defaultChannel: "recovery-timers"`
- Android: `POST_NOTIFICATIONS`, `SCHEDULE_EXACT_ALARM`, `WAKE_LOCK`, `VIBRATE`
- iOS: `NSUserNotificationsUsageDescription`

---

## The focus ring (FE-301)

`src/components/focus/FocusRing.tsx`. A Skia progress ring with the time in the
middle — the whole focus visual, replacing the earlier hairline bar.

- **Skia arc.** One circle `Path`, drawn twice: a faint full-circle track and an
  accent arc trimmed by the `<Path end>` prop (0..1). A −90° `Group` rotation
  starts the arc at twelve o'clock. `strokeCap="round"`.
- **Smoothed progress.** `useCountdown` steps `progress` once a second; the ring
  would jump. `FocusRing` eases an internal SharedValue toward each new value
  with a ~950 ms linear `withTiming`, so the arc glides on the UI thread while
  the JS thread sits idle between ticks. A shrinking target (a reset or a new
  block) snaps instead of unwinding.
- **Time in the centre** is a plain RN `<Text>` (`formatDuration`, so `1:29:59`
  for a 90-minute block — readable beats a rigid `89:59`), not Skia text, which
  would mean loading a font for no gain.
- **Fallback.** Skia is absent in Expo Go, so a plain bordered circle + the
  centred time + a hairline bar stands in — same `isSkiaAvailable` guard as the
  breathing orb. The arc is the only thing lost.

The rest phase (AC3) and the non-blocking break offer are the Focus screen's job,
documented in [features.md](./features.md#фокус-focus--apptabsfocustsx).

---

## Testing that it survives

The behaviour worth verifying properly. **Use a physical device** — simulators
handle process death differently.

### Countdown accuracy across a kill

1. Focus tab → **90 min focus**
2. Note the remaining time
3. Background the app, lock the phone
4. Force-quit from the app switcher
5. Wait a minute, reopen

The countdown should reflect **real elapsed time**, not the moment you left. If
it resumed from where you left off, the delta-timestamp model is broken.

### Notification with the process dead

Temporarily shorten the block:

```ts
// src/services/timerEngine.ts
export const ULTRADIAN = {
  focusMs: 30 * 1000,   // was 90 * 60 * 1000
  breakMs: 20 * 60 * 1000,
} as const;
```

Start a block, force-quit immediately, wait 30 seconds. The notification should
arrive with no process running. Revert the constant afterwards.

### Pause correctness

Start a block, pause for a clearly-measurable stretch (a minute), resume, and
confirm the remaining time is unchanged from when you paused. Then background
and return — it should still be right. Repeat two or three times; any drift will
compound visibly.

### Expo Go caveat

MMKV falls back to memory in Expo Go, so **the timer will not survive a reload
there**. That is a fallback artefact, not a bug in the engine. Test persistence
on a dev build.

---

## Extending it

**Adding a timer kind:** add to the `TimerKind` union, add an entry to
`NOTIFICATION_COPY`. TypeScript will flag the missing case — the `Record<TimerKind, …>`
type makes the copy table exhaustive by construction.

**Multiple concurrent timers:** would require replacing the single
`StorageKeys.activeTimer` row with a keyed map and giving `useCountdown` an id
parameter. The pub/sub and derivation logic would carry over unchanged.

**A repeating ultradian chain** (focus → break → focus…): implement in the
`onComplete` callback by calling `startTimer` for the next kind. Do not build it
into the engine; the engine's job is one interval, and chaining is a policy
decision that belongs in the screen.
