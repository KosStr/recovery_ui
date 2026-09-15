import { CircadianPanel } from '@/components/sleep/CircadianPanel';
import { SleepPlayer } from '@/components/sleep/SleepPlayer';
import { WindDownChecklist } from '@/components/sleep/WindDownChecklist';
import { Screen, SectionLabel } from '@/components/ui/Screen';

/**
 * Сон — the circadian sleep hub (EPIC 4).
 *
 * Three stacked concerns, each its own component:
 *   - CircadianPanel   bedtime target → caffeine cutoff + digital sunset (FE-402)
 *   - SleepPlayer      background NSDR / soundscapes + sleep timer (FE-401)
 *   - WindDownChecklist the four evening toggles (FE-402 AC2)
 */
export default function SleepScreen() {
  return (
    <Screen title="Сон" subtitle="Вечірній ритуал важливіший за час відходу до сну.">
      <SectionLabel>Циркадний ритм</SectionLabel>
      <CircadianPanel />

      <SleepPlayer />

      <WindDownChecklist />
    </Screen>
  );
}
