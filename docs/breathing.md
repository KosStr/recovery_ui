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

FE-201 defines four phases. Radius runs 40% → 85% → 100% → 40%; `lungFullness`
carries that as 0 → 0.75 → 1.0 → 0 (the visual maps fullness 0..1 onto radius
40%..100%, so fullness 0.75 is 85% radius).

| Phase | Duration | Fullness target | Easing | Rationale |
| --- | --- | --- | --- | --- |
| `inhale1` | 1500 ms | 0.75 (85% r) | `inOut(quad)` | Smooth fill; the rising haptic ramp runs across it |
| `inhale2` | 600 ms | 1.00 (100% r) | `out(quad)` | The sharp "довдих" top-off |
| `hold` | 1000 ms | 1.00 | `linear` | Held at full while the glow pulses |
| `exhale` | 5000 ms | 0.00 (40% r) | `out(cubic)` | The long, soft release |

One cycle: **8100 ms**, exported as `CYCLE_MS`.

The modal runs `TARGET_CYCLES = 10` — about **81 seconds** — then fires a success
haptic, writes a `somatic_breathing` session, and auto-dismisses 1.4 s later so
the final exhale lands. Ten is the count the FE-201 acceptance criteria record.

---

## The state machine

Two `SharedValue`s — `lungFullness` (0..1, drives the orb's size) and `glow`
(0..1, pulses only during the hold) — are the whole model. `lungFullness` is
driven by one `withSequence`:

```ts
lungFullness.value = withSequence(
  withTiming(0.75, { duration: 1500, easing: Easing.inOut(Easing.quad) }, cb),
  withTiming(1,    { duration: 600,  easing: Easing.out(Easing.quad) },   cb),
  withTiming(1,    { duration: 1000, easing: Easing.linear },             cb), // hold
  withTiming(0,    { duration: 5000, easing: Easing.out(Easing.cubic) },  cb),
);
```

`glow` is a separate `withRepeat(withSequence(...), -1, true)` started when the
hold phase begins and cancelled at the exhale — that is the visual stand-in for
the one phase with no haptic.

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
const { lungFullness, glow, phase, completedCycles, isRunning, start, stop }
  = useSighCycle({ targetCycles, onCycleComplete, onFinished });
```

`stop()` eases back to empty over 600 ms rather than snapping — an abort should
still feel calm.

Unmounting sets `runningRef.current = false`, so leaving the screen mid-cycle
cannot leave a sequence firing callbacks at a dead component.

---

## Why it runs on the UI thread

React renders the breathing screen **once**. For the remaining ~80 seconds it does
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
| `inhale1` | **rising ramp** of `impactAsync(Light)` | Accelerating taps read as "keep drawing in" |
| `inhale2` | `impactAsync(Medium)` | The sharp "довдих"; stronger than the ramp so the two inhales feel separate |
| `hold` | *(none)* | The glow pulses instead |
| `exhale` | `impactAsync(Light)` | One soft marker at the start of the release |
| session end | `notificationAsync(Success)` | Completion |

The **rising ramp** is the one piece not driven by Reanimated. `startInhaleRamp`
schedules Light taps across the 1.5 s inhale with the gap shrinking from ~360 ms
to ~110 ms, tracked in a ref and cleared on phase change, stop, or unmount. It
runs on the JS thread (`setTimeout`) because it only *triggers* haptics — it
never drives the animation, so throttling would at worst drop a tap, never
stutter the orb.

All cues go through `src/lib/haptics.ts`, which never throws. Every call site is
on a UI path, and a rejected promise from a device with no taptic engine must not
surface as an unhandled rejection mid-session. Web has no API at all, so the
wrapper checks `Platform.OS` first.

### Eyes-closed mode

FE-201 asks for a practice done without looking at the phone. "Заплющити очі"
sets a full-`#000000` overlay over the running session; the exercise continues,
driven by the haptic cues above, and a tap anywhere brings the visual back
without stopping it. This is why the haptic design carries the whole cycle on its
own — with the screen black, vibration is the only channel left.

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
minRadius  = maxRadius × 0.40      ← FE-201: the orb never shrinks below 40% r
ringRadius = canvasSize × 0.44
```

`minRadius` is deliberately non-zero. A fully collapsed orb reads as *stopped*;
40% reads as *exhaled, still alive*. Fullness 0..1 maps linearly onto this
40%..100% band.

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
it, update the "Близько 80 секунд" copy on the Today screen
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
