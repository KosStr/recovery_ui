# The breathing engine

`src/components/breathing/useSighCycle.ts` and `PhysiologicalSigh.tsx`.

- [What a physiological sigh is](#what-a-physiological-sigh-is)
- [The state machine](#the-state-machine)
- [Why it runs on the UI thread](#why-it-runs-on-the-ui-thread)
- [Haptic synchronisation](#haptic-synchronisation)
- [The Skia scene](#the-skia-scene)
- [The Expo Go fallback](#the-expo-go-fallback)
- [Tuning](#tuning)
- [Testing](#testing)

---

## What a physiological sigh is

Two inhales through the nose — a long one, then a short second sniff that
reinflates collapsed alveoli — followed by a long, slow exhale.

The exhale is roughly twice the length of both inhales combined. **That ratio is
the mechanism**, not a stylistic choice: a prolonged exhale is what actually
slows heart rate. It is the one number in this file not worth tuning for
aesthetics.

| Phase | Duration | Fullness target | Easing | Rationale |
| --- | --- | --- | --- | --- |
| `inhale1` | 1600 ms | 0.68 | `out(cubic)` | Chest fills quickly, then settles |
| `inhale2` | 700 ms | 1.00 | `linear` | Short and sharp; reads as a distinct second action |
| `exhale` | 5500 ms | 0.00 | `inOut(quad)` | The long release; `inOut` stops it stalling at the end |
| `rest` | 900 ms | 0.00 | `linear` | A beat of stillness, so it never feels like a metronome |

One cycle: **8700 ms**. Exported as `CYCLE_MS`.

The breathing modal runs `TARGET_CYCLES = 5` — about **45 seconds** — then fires
a success haptic and auto-dismisses 1.4 s later, letting the final exhale land.

---

## The state machine

One `SharedValue` — `lungFullness`, 0 (empty) to 1 (full) — is the entire model.
Every visual derives from it, and one `withSequence` drives it:

```ts
lungFullness.value = withSequence(
  withTiming(0.68, { duration: 1600, easing: Easing.out(Easing.cubic) }, cb),
  withTiming(1,    { duration: 700,  easing: Easing.linear },            cb),
  withTiming(0,    { duration: 5500, easing: Easing.inOut(Easing.quad) }, cb),
  withTiming(0,    { duration: 900,  easing: Easing.linear },            cb),
);
```

The fourth segment animates to the value it already holds. That is the cheapest
way to express "wait" inside a sequence — no timeout, no separate scheduler.

Each segment's completion callback announces the *next* phase, so the caption
and haptic for a phase fire exactly when that phase begins. The last one calls
`finishCycle`, which increments the count and either schedules another cycle or
stops.

`runCycle` schedules itself via `runCycleRef` — a ref rather than a direct
reference, because a `useCallback` cannot reference its own not-yet-assigned
identity.

### Public surface

```ts
const { lungFullness, phase, completedCycles, isRunning, start, stop }
  = useSighCycle({ targetCycles, onCycleComplete, onFinished });
```

`stop()` eases back to empty over 600 ms rather than snapping — an abort should
still feel calm.

Unmounting sets `runningRef.current = false`, so leaving the screen mid-cycle
cannot leave a sequence firing callbacks at a dead component.

---

## Why it runs on the UI thread

React renders the breathing screen **once**. For the remaining 45 seconds it does
nothing.

The animation lives in Reanimated worklets on the UI thread, and the Skia scene
graph is mutated directly from derived values. Nothing crosses to JS per frame.

This is not premature optimisation — it is what makes the feature work at all.
During a breathing session the JS thread is busy inserting a `sessions` row and
running TanStack Query invalidation. If the orb were driven by React state, every
one of those would cost frames, and a stutter in a *breathing guide* is worse
than a stutter anywhere else: the user is synchronising their body to it.

To verify: dev menu → **Performance Monitor**. The JS thread should sit near-idle
while the orb animates.

---

## Haptic synchronisation

The only JS-thread work per phase is one haptic call and one caption update,
hopped across with `runOnJS` from the completion callback of the *preceding*
segment:

```ts
withTiming(INHALE_1_PEAK, { ... }, (finished) => {
  'worklet';
  if (finished) runOnJS(enterPhase)('inhale2');
}),
```

The `if (finished)` guard matters: an interrupted animation calls its callback
with `finished === false`, and without the check, cancelling a session would fire
a spurious haptic.

`enterPhase` sets the caption and fires the matching cue in one place, so the two
can never disagree:

| Phase | Cue | Why that one |
| --- | --- | --- |
| `inhale1` | `impactAsync(Light)` | The lightest possible tap — an invitation |
| `inhale2` | `impactAsync(Rigid)` | Sharper, so the second sniff is distinct |
| `exhale` | `impactAsync(Soft)` | Soft and diffuse; reads as "release", not "act" |
| session end | `notificationAsync(Success)` | Completion |

All of these go through `src/lib/haptics.ts`, which never throws. Every call site
is on a UI path, and a rejected promise from a device with no taptic engine must
not surface as an unhandled rejection mid-session. Web has no API at all, so the
wrapper checks `Platform.OS` first.

---

## The Skia scene

`PhysiologicalSigh.tsx`. Every visual property is a `useDerivedValue` off
`lungFullness`.

### Geometry

Sized off the viewport so the orb never clips on a small phone or stretches on a
tablet:

```
canvasSize = min(width × 0.86, 380)
maxRadius  = canvasSize × 0.34
minRadius  = maxRadius × 0.34      ← empty lungs still show a visible core
ringRadius = canvasSize × 0.44
```

`minRadius` is deliberately non-zero. A fully collapsed orb reads as *stopped*
rather than *exhaled*.

### Layers, back to front

| Layer | Derivation | Purpose |
| --- | --- | --- |
| **Halo** | `orbRadius × 1.42`, opacity `0.12 + fullness × 0.34`, `BlurMask(38)` | Leads the orb and fades as lungs empty, so an exhale reads as heat leaving the body rather than a shape merely shrinking |
| **Guide ring** | Fixed radius, opacity `0.1 + fullness × 0.28`, 1px stroke | Faint constant presence that brightens at full inhale, so the peak of the sniff is legible without reading the caption |
| **Orb** | `minRadius + fullness × (maxRadius − minRadius)`, radial gradient | The subject. Bright core falling to transparent at the rim |
| **Highlight** | `orbRadius × 0.18`, offset up-left, opacity `fullness × 0.22` | A light source, so the orb has form rather than being a flat disc |

The gradient uses an 8-digit hex for its outer stop (`${accent}00`) — Skia parses
`#RRGGBBAA`, so appending `00` gives a fully transparent version of the accent
without a second constant.

The halo is a separate blurred circle rather than a blur on the group, so the
core stays crisp.

### A hooks-order note

`highlightRadius` and `highlightOpacity` are declared with the other derived
values, **above** the Skia-availability branch, not inline in the JSX. Hooks
after a conditional return break the rules of hooks. `Skia` is a module-level
constant so it would work in practice, but it would be a lint error and a trap
for anyone who later makes the branch dynamic.

### Accessibility

The canvas carries `accessibilityRole="image"` and an
`accessibilityLabel` naming the current phase, so the exercise still works for
someone running a screen reader or with the display dimmed to black.

---

## The Expo Go fallback

Skia is a native module with no Expo Go support. It is required lazily:

```ts
let Skia: SkiaModule | null;
try { Skia = require('@shopify/react-native-skia'); }
catch { Skia = null; }
export const isSkiaAvailable = Skia !== null;
```

When absent, `FallbackOrb` renders two scaled `Animated.View` circles. It loses
the gradient and the blur, but it is **driven by the same `SharedValue`**, so
timing and haptic sync are identical. The breathing modal shows a small note at
the bottom when the fallback is active.

This keeps the exercise tunable without a dev build.

---

## Tuning

**Cycle timing** — `TIMING` in `useSighCycle.ts`. Keep the exhale at roughly
twice the two inhales combined; that ratio is the mechanism.

**Session length** — `TARGET_CYCLES` in `app/modal/breathing.tsx`. If you change
it, update the "About 45 seconds" copy on the Today screen
(`app/(tabs)/index.tsx`) and the comment above the constant. Session length is
`CYCLE_MS × TARGET_CYCLES`.

**Inhale split** — `INHALE_1_PEAK` (0.68). How full the lungs are before the
second sniff.

**Colour** — pass `accent` to `PhysiologicalSigh`. Defaults to sage.

**Size** — pass `size` to override the viewport-derived diameter.

---

## Testing

**Frame rate.** Dev menu → Performance Monitor. UI thread at display refresh
rate, JS thread near-idle.

**Haptics.** Physical device only — simulators have no taptic engine. Feel for
the three distinct cues in order (light → rigid → soft), then the success
pattern after the fifth dot fills.

**Interruption.** Close the modal mid-inhale. The orb should ease down to empty
over 600 ms, and **no further haptics should fire** — that verifies the
`if (finished)` guards.

**Fallback path.** Run in Expo Go. The orb should be a plain circle breathing on
the same rhythm, with the note visible at the bottom. Timing should be
indistinguishable from the Skia version.
