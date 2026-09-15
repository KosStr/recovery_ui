/**
 * The app's icon set.
 *
 * Every icon is imported from its own module rather than from the
 * `lucide-react-native` barrel. That is not style — the barrel re-exports all
 * ~1500 icons, Metro does not tree-shake CommonJS barrels, and importing it
 * anywhere adds roughly 1.8 MB to the bundle and a matching parse cost at
 * startup. Deep imports cost exactly what is listed here.
 *
 * Measured on this project, Android Hermes bytecode: barrel import 7.29 MB,
 * deep imports 5.29 MB.
 *
 * **Import icons from this file, never from `lucide-react-native` directly.**
 * The one exception is `LucideIcon`, which is a type and erased at compile
 * time, so it is free to import from the package root.
 */
export { default as Bed } from 'lucide-react-native/icons/bed';
export { default as Check } from 'lucide-react-native/icons/check';
export { default as ChevronRight } from 'lucide-react-native/icons/chevron-right';
export { default as Circle } from 'lucide-react-native/icons/circle';
export { default as CircleX } from 'lucide-react-native/icons/circle-x';
export { default as Coffee } from 'lucide-react-native/icons/coffee';
export { default as CupSoda } from 'lucide-react-native/icons/cup-soda';
export { default as Droplet } from 'lucide-react-native/icons/droplet';
export { default as Eye } from 'lucide-react-native/icons/eye';
export { default as Footprints } from 'lucide-react-native/icons/footprints';
export { default as Leaf } from 'lucide-react-native/icons/leaf';
export { default as Lightbulb } from 'lucide-react-native/icons/lightbulb';
export { default as Moon } from 'lucide-react-native/icons/moon';
export { default as MoonStar } from 'lucide-react-native/icons/moon-star';
export { default as Music } from 'lucide-react-native/icons/music';
export { default as Pause } from 'lucide-react-native/icons/pause';
export { default as PenLine } from 'lucide-react-native/icons/pen-line';
export { default as Play } from 'lucide-react-native/icons/play';
export { default as ShieldOff } from 'lucide-react-native/icons/shield-off';
export { default as Smartphone } from 'lucide-react-native/icons/smartphone';
export { default as Sunset } from 'lucide-react-native/icons/sunset';
export { default as Target } from 'lucide-react-native/icons/target';
export { default as Timer } from 'lucide-react-native/icons/timer';
export { default as Volume2 } from 'lucide-react-native/icons/volume-2';
export { default as Wind } from 'lucide-react-native/icons/wind';
export { default as Wrench } from 'lucide-react-native/icons/wrench';
export { default as X } from 'lucide-react-native/icons/x';
export { default as Zap } from 'lucide-react-native/icons/zap';

export type { LucideIcon } from 'lucide-react-native';
