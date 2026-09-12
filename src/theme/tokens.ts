/**
 * Single source of truth for colour.
 *
 * Tailwind reads these values from `tailwind.config.js` for className styling;
 * this module exists for the places that cannot take a className — Skia paints,
 * React Navigation themes, notification accents and StatusBar config.
 * Keep the two in sync by hand: NativeWind does not expose the resolved config
 * to the native runtime cheaply enough to be worth the indirection.
 */
export const palette = {
  void: '#000000',
  surface: '#0A0A0C',
  elevated: '#121216',
  hairline: '#1E1E24',

  sage: '#7C9A83',
  sageDim: '#4E6354',
  sageGlow: '#A3C4AB',

  indigo: '#5A63A8',
  indigoDim: '#343A63',
  indigoGlow: '#8790D6',

  amber: '#D9A05B',
  amberDim: '#8A6537',
  amberGlow: '#F0C68C',

  ink: '#F2F2F0',
  inkSoft: '#A1A1A6',
  inkMute: '#6B6B72',
  inkGhost: '#3A3A42',
} as const;

/**
 * Each surface of the app owns one accent, used inside screen content --
 * countdowns, progress rules, selected states. The tab bar deliberately does
 * not use these; see `tabBar` below.
 */
export const accents = {
  today: palette.amber,
  focus: palette.indigo,
  sleep: palette.indigoGlow,
  detox: palette.sage,
} as const;

export type AccentKey = keyof typeof accents;

/**
 * Tab bar chrome.
 *
 * One active colour across all four tabs rather than a per-tab accent: the bar
 * should read as a single quiet control strip, and a colour that changes as you
 * move draws the eye back to navigation you have already finished using.
 *
 * `active` is Tailwind `amber-200` -- muted and warm, so it does not punch a
 * hole in a dark room. `activeAlt` is `emerald-400`, the cooler alternative;
 * swap `active` to it in one line if you prefer green. `inactive` is
 * `neutral-600`, legible against true black without competing.
 */
export const tabBar = {
  background: palette.void,
  border: palette.hairline,
  inactive: '#525252',
  active: '#FDE68A',
  activeAlt: '#34D399',
} as const;

/** Shared geometry that more than one component has to agree on. */
export const layout = {
  /**
   * Tab bar height *above* the safe-area inset. The real height is this plus
   * `insets.bottom`, which is what keeps it stable across a home-indicator
   * iPhone, a notched Android, and a device with hardware keys.
   */
  tabBarContentHeight: 56,
  /** Lucide stroke width. Thin enough to stay calm at small sizes. */
  iconStroke: 1.5,
  tabIconSize: 22,
} as const;

/** React Navigation theme — prevents the white flash between screen mounts. */
export const navigationDarkTheme = {
  dark: true,
  colors: {
    primary: palette.sage,
    background: palette.void,
    card: palette.void,
    text: palette.ink,
    border: palette.hairline,
    notification: palette.amber,
  },
  fonts: {
    regular: { fontFamily: 'System', fontWeight: '400' as const },
    medium: { fontFamily: 'System', fontWeight: '500' as const },
    bold: { fontFamily: 'System', fontWeight: '600' as const },
    heavy: { fontFamily: 'System', fontWeight: '700' as const },
  },
};
