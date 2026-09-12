# Design system

`tailwind.config.js` and `src/theme/tokens.ts`.

- [The premise](#the-premise)
- [Palette](#palette)
- [Accents as wayfinding](#accents-as-wayfinding)
- [Icons](#icons)
- [Two sources of colour](#two-sources-of-colour)
- [Typography](#typography)
- [Elevation and shape](#elevation-and-shape)
- [Components](#components)
- [Conventions](#conventions)

---

## The premise

This app gets opened at 6am and at 11pm, often in a dark room, often by someone
who is tired. Every visual decision follows from that.

**True black, not near-black.** `#000000` on an OLED panel means those pixels are
switched *off* — no power, and no faint grey cast. A "dark" theme built on
`#121212` glows in a dark room and looks cheap by comparison.

**Muted accents only.** Nothing saturated. A vivid accent that looks energetic in
a screenshot is punishing at 2am, and this is an app about winding down.

**Elevation without shadows.** Shadows render as grey smears against true black.
The entire elevation system is one hairline border and a barely-lifted fill.

---

## Palette

```
Base
  void      #000000   Screen background. Actual black.
  surface   #0A0A0C   Cards
  elevated  #121216   Raised surfaces, banners
  hairline  #1E1E24   Borders, dividers

Accents                       DEFAULT     dim         glow
  sage      Sage green        #7C9A83     #4E6354     #A3C4AB
  indigo    Deep indigo       #5A63A8     #343A63     #8790D6
  amber     Warm amber        #D9A05B     #8A6537     #F0C68C
  ember     Muted terracotta  #B4544A                        (low / critical)

Type ramp
  ink       #F2F2F0   Primary text
  ink-soft  #A1A1A6   Secondary
  ink-mute  #6B6B72   Labels, captions, inactive
  ink-ghost #3A3A42   Disabled, empty states, the close button
```

Primary text is `#F2F2F0`, not `#FFFFFF`. Pure white on pure black is the highest
contrast the panel can produce, and reading it at night is uncomfortable.

### Tinting with alpha

Selected states use the accent at 12% over black rather than a solid fill:

```tsx
backgroundColor: selected ? `${accents.today}1F` : 'transparent'
```

`1F` is hex for ~12% alpha. This keeps a selection legible without lighting up a
large area of the screen at night. Borders use `55` (~33%) by the same logic.

---

## Accents as wayfinding

Each surface owns one accent, used **inside screen content** — countdowns,
progress rules, selected states, stat tiles:

| Screen | Accent | Hex | Reading |
| --- | --- | --- | --- |
| Енергія (Today) | amber | `#D9A05B` | Warmth, energy |
| Фокус (Focus) | indigo | `#5A63A8` | Depth, concentration |
| Сон (Sleep) | indigo glow | `#8790D6` | Cooler, further into the night |
| Детокс (Detox) | sage | `#7C9A83` | Analog, outdoors |

Defined once in `accents`, in `src/theme/tokens.ts`:

```ts
export const accents = {
  today: palette.amber,
  focus: palette.indigo,
  sleep: palette.indigoGlow,
  detox: palette.sage,
} as const;
```

Break blocks on the Focus screen switch from indigo to sage, so a glance tells
you whether you are working or resting without reading the label.

### The tab bar is the exception

The bar uses **one active colour across all four tabs**, not the per-screen
accent:

```ts
export const tabBar = {
  background: palette.void,   // #000000
  border: palette.hairline,
  inactive: '#525252',        // tailwind neutral-600
  active: '#FDE68A',          // tailwind amber-200
  activeAlt: '#34D399',       // tailwind emerald-400
} as const;
```

An accent that changes as you move pulls the eye back to navigation you have
already finished using. One quiet colour lets the bar recede. At rest it is a
row of `neutral-600` glyphs; only the active tab lifts to `amber-200`.

`amber-200` is the default because it is muted and warm — it does not punch a
hole in a dark room at 11pm. `activeAlt` (`emerald-400`) is the cooler
alternative; switching is a one-line change to `active`.

---

## Icons

**Lucide**, at stroke width **1.5** everywhere (`layout.iconStroke`).

Lucide has no filled variants, and that suits this design: colour alone marks
an active tab, so nothing changes weight or shape as you navigate. Sizes are 22
in the tab bar (`layout.tabIconSize`), 17–30 in content.

**Import from `src/components/ui/icons.ts`, never from `lucide-react-native`
directly.** The package barrel re-exports all ~1500 icons, Metro does not
tree-shake CommonJS barrels, and touching it anywhere adds ~2 MB to the bundle
plus the matching parse cost at startup.

Measured on this project (Android Hermes bytecode):

| Import style | Bundle |
| --- | --- |
| `from 'lucide-react-native'` | 7.29 MB |
| `from '@/components/ui/icons'` | 5.29 MB |

`icons.ts` re-exports each icon from its own module:

```ts
export { default as Zap } from 'lucide-react-native/icons/zap';
```

To add one: find the kebab-case file under
`node_modules/lucide-react-native/dist/esm/icons/`, add a line, import it from
`@/components/ui/icons`.

The `LucideIcon` **type** is safe to import from the package root — types are
erased at compile time and cost nothing.

Icons held in data (the detox micro-quests) store the component itself, not a
name string. Capitalise the binding before using it as a JSX tag:

```tsx
const QuestIcon = quest.icon;
return <QuestIcon size={22} strokeWidth={layout.iconStroke} color={accent} />;
```

---

## Two sources of colour

Colour is defined in **two places**, and they must be edited together.

| File | Serves | Used by |
| --- | --- | --- |
| `tailwind.config.js` | `className` | Everything with a `className` |
| `src/theme/tokens.ts` | JS values | Skia paints, React Navigation, notification accent, `StatusBar`, alpha tinting |

This duplication is deliberate rather than lazy: NativeWind does not expose its
resolved config to the native runtime cheaply enough to be worth the indirection,
and Skia's `Canvas` cannot take a `className` at all.

**When you change a colour, change it in both.** There is no build-time check
tying them together.

`tokens.ts` also exports `navigationDarkTheme`, which is what prevents a white
flash between screen mounts. React Navigation paints its own background before a
screen renders; without an explicit dark theme it defaults to white.

---

## Typography

System font throughout. No custom face is loaded — a font file is a download, a
flash of unstyled text, and a licensing question, and none of that buys anything
here.

| Role | Size | Weight | Colour |
| --- | --- | --- | --- |
| Screen title | 32 | 600 | `ink` |
| Screen subtitle | 15 | 400 | `ink-soft` |
| Section label | 11 | 600, uppercase, `tracking-[1.6px]` | `ink-mute` |
| Card title | 16–17 | 600 | `ink` |
| Body | 13–15 | 400 | `ink-soft` |
| Caption | 11–12 | 400 | `ink-mute` |
| **Countdown** | 64 | 200 (`extralight`) | accent |
| Stat value | 26 | 300 (`light`) | accent |

Large numerals are **light or extralight**, never bold. A 64px bold countdown
shouts; the same number at weight 200 is just as readable and considerably
calmer.

### Tabular numerals

Every changing number carries:

```tsx
style={{ fontVariant: ['tabular-nums'] }}
```

Without it, proportional digits have different widths and a countdown jitters
horizontally as it ticks — very visible at 64px.

---

## Elevation and shape

```
borderRadius:  card 20px    pill 999px
spacing:       gutter 20px  (screen edge padding, matches mx-5)
```

Cards are `bg-surface` + `border border-hairline` + `rounded-card`. No shadow,
no `elevation`. The tab bar likewise sets `elevation: 0` and relies on a 1px top
border.

---

## Components

`src/components/ui/Screen.tsx`:

| Export | Purpose |
| --- | --- |
| `Screen` | Standard chrome: black background, safe-area top inset, optional title/subtitle, scroll container with a flat 40px bottom pad (the tab bar is a sibling and absorbs `insets.bottom` itself) |
| `SectionLabel` | Quiet uppercase label that separates groups without drawing a rule |
| `Card` | Elevated surface, `mx-5` |

`src/components/ui/BottomSheet.tsx`:

A minimal sheet — a plain RN `Modal` with a Reanimated slide and a
drag-to-dismiss Pan gesture, no `@gorhom/bottom-sheet` dependency. The parent
owns `visible`; a drag or backdrop tap calls `onClose`, and the Modal unmounts
only after the close animation finishes. It re-roots gestures in its own
`GestureHandlerRootView`, because gestures do not reach into an RN Modal from the
app root. Used by the energy tag picker (FE-202).

`src/components/energy/`:

| Export | Purpose |
| --- | --- |
| `EnergyBattery` | 1–5 selector drawn as a battery; cells fill and colour by `ENERGY_SCALE` |
| `EnergyCheckin` | Battery + tag `BottomSheet`, wired to the store; one tap logs |

`ENERGY_SCALE` (in `tokens.ts`) is the 1→5 colour ramp — index 0 unused so a
score is its own index. It runs muted terracotta → amber → sage, not a literal
red→green: a legible gradient at 11pm, not a traffic light.

`src/components/ui/PressableScale.tsx`:

Spring-driven press feedback plus a semantic haptic. The scale runs on the UI
thread, so feedback lands on the same frame as the touch even when the JS thread
is mid-SQLite-write. Springs rather than timings because a press-in interrupted
by a press-out has to retarget mid-flight without a jump.

**Its structure is load-bearing:**

```tsx
<Pressable className={className}>      {/* NativeWind interops this */}
  <Animated.View style={animatedStyle}> {/* transform lives here */}
    {children}
  </Animated.View>
</Pressable>
```

NativeWind only interops the core components it knows about. Wrapping with
`Animated.createAnimatedComponent(Pressable)` and putting `className` on *that*
would silently drop every Tailwind class handed to it. Keep the class on the
plain `Pressable`.

---

## Conventions

**`className` for layout, `style` for computed colour.** Tailwind handles
spacing, flex, radius, type. Anything derived at runtime — an accent that depends
on timer kind, an alpha tint, a selected state — goes through `style`, because
NativeWind cannot resolve a template-literal class name at build time.

```tsx
// Right
<View className="rounded-card border px-4 py-2.5"
      style={{ borderColor: selected ? accents.focus : palette.hairline }} />

// Wrong — Tailwind never sees this class, so it is never generated
<View className={`border-${selected ? 'indigo' : 'hairline'}`} />
```

**Haptics are semantic, not mechanical.** `src/lib/haptics.ts` exposes
`inhalePrimary`, `inhaleSecondary`, `exhale`, `select`, `success`, `warn` — not
`light`/`medium`/`heavy`. Call sites express intent; the mapping to
`ImpactFeedbackStyle` lives in one place and can be retuned globally.

**Accessibility on custom controls.** The energy dial is
`accessibilityRole="radio"` with `accessibilityState={{ selected }}` and a label
reading `"Steady, 3 of 5"`. Ritual steps are `checkbox` with `checked`. The
breathing canvas is `image` with a label naming the current phase. None of these
are inferable from a `View`, so they have to be stated.

**Adding a colour:**

1. Add it to `tailwind.config.js` under `theme.extend.colors`
2. Add the same value to `palette` in `src/theme/tokens.ts`
3. If it is a surface accent, add it to `accents`
4. Restart Metro — Tailwind config changes need a fresh build
