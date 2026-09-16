import {
  CupSoda,
  Eye,
  Footprints,
  Leaf,
  PenLine,
  PersonStanding,
  Wrench,
  type LucideIcon,
} from '@/components/ui/icons';

/**
 * Analog micro-quests (FE-501 AC1): something to do with the hands while the
 * phone is away. Every one is deliberately *unrecordable* — no photo, no log,
 * nothing to post — because a quest that produces a shareable artefact just
 * feeds the loop it is meant to break.
 *
 * The first three are the ones the acceptance criteria name; the rest add
 * variety. `pickRandomQuest` chooses one at the start of a detox.
 */
export interface Quest {
  icon: LucideIcon;
  title: string;
  detail: string;
}

export const QUESTS: Quest[] = [
  {
    icon: CupSoda,
    title: 'Зроби 10 повільних ковтків холодної води',
    detail: 'Без телефону в руках. Відчуй кожен ковток.',
  },
  {
    icon: Eye,
    title: 'Правило 20-20-20',
    detail: 'Дивись на точку за 6 метрів протягом 20 секунд.',
  },
  {
    icon: PersonStanding,
    title: "Розтягни трапецію та шию",
    detail: 'Повільно, без ривків. Опусти плечі від вух.',
  },
  {
    icon: Footprints,
    title: 'Пройди один квартал без навушників',
    detail: 'Поміть пʼять звуків, яких зазвичай не чуєш.',
  },
  {
    icon: PenLine,
    title: 'Напиши пів сторінки від руки',
    detail: 'Будь-що. Розбірливість необовʼязкова.',
  },
  {
    icon: Leaf,
    title: 'Вийди надвір і знайди обрій',
    detail: 'Панорамний зір знижує збудження за хвилину.',
  },
  {
    icon: Wrench,
    title: 'Полагодь одну дрібницю',
    detail: 'Шухляду, ґудзик, хитку ніжку.',
  },
];

/** A random quest, non-null since QUESTS is statically non-empty. */
export function pickRandomQuest(): Quest {
  return QUESTS[Math.floor(Math.random() * QUESTS.length)]!;
}
