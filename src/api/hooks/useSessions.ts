import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/api/client';
import { queryKeys } from '@/api/queryClient';
import type { RecoveryInsightsDto, SyncPushRequest, SyncPushResponse } from '@/api/types';
import {
  completeSession,
  getCompletedRituals,
  getEnergyTrend,
  getFocusMinutesForDay,
  getPendingMutations,
  getRecentSessions,
  getTodayEnergyStats,
  insertSession,
  localDateKey,
  markSynced,
  toggleRitual,
  type SessionType,
} from '@/db/localDb';

/**
 * Query hooks.
 *
 * Reads hit SQLite; only `useInsights` and `useSyncPendingMutations` touch the
 * network. Keeping that split explicit here means no screen has to know whether
 * it is online.
 */

// --- Local reads -----------------------------------------------------------

export function useRecentSessions(limit = 30) {
  return useQuery({
    queryKey: queryKeys.sessions.recent(limit),
    queryFn: () => getRecentSessions(limit),
  });
}

export function useFocusMinutesToday() {
  const dateKey = localDateKey();
  return useQuery({
    queryKey: queryKeys.sessions.focusMinutes(dateKey),
    queryFn: () => getFocusMinutesForDay(dateKey),
  });
}

/** Today's averaged energy figures, straight from SQLite. The home screen reads
 *  these from the Zustand store for a synchronous first paint; this query is here
 *  for any surface that would rather subscribe through TanStack Query. */
export function useTodayEnergyStats() {
  return useQuery({
    queryKey: queryKeys.energy.today,
    queryFn: () => getTodayEnergyStats(),
  });
}

export function useEnergyTrend(days = 7) {
  return useQuery({
    queryKey: queryKeys.energy.trend(days),
    queryFn: () => getEnergyTrend(days),
  });
}

export function useCompletedRituals() {
  const dateKey = localDateKey();
  return useQuery({
    queryKey: queryKeys.rituals.forDay(dateKey),
    queryFn: () => getCompletedRituals(dateKey),
  });
}

// --- Local writes ----------------------------------------------------------

export function useStartSession() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      type: SessionType;
      plannedDurationMs: number;
      soundscape?: string;
    }) =>
      insertSession({
        type: input.type,
        started_at: Date.now(),
        planned_duration_ms: input.plannedDurationMs,
        soundscape: input.soundscape,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.sessions.all }),
  });
}

export function useCompleteSession() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => completeSession(sessionId),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.sessions.all }),
  });
}

export function useToggleRitual() {
  const client = useQueryClient();
  const dateKey = localDateKey();
  return useMutation({
    mutationFn: (ritualKey: string) => toggleRitual(ritualKey),
    // Optimistic toggle: a checklist tap must not wait on disk.
    onMutate: async (ritualKey) => {
      const key = queryKeys.rituals.forDay(dateKey);
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<string[]>(key) ?? [];
      client.setQueryData<string[]>(
        key,
        previous.includes(ritualKey)
          ? previous.filter((k) => k !== ritualKey)
          : [...previous, ritualKey],
      );
      return { previous };
    },
    onError: (_error, _key, context) => {
      if (context?.previous) {
        client.setQueryData(queryKeys.rituals.forDay(dateKey), context.previous);
      }
    },
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.rituals.forDay(dateKey) }),
  });
}

// --- Network ---------------------------------------------------------------

/**
 * Server-computed aggregates. `enabled` is left to the caller so a screen can
 * hold this back until the user has actually signed in.
 */
export function useInsights(enabled = true) {
  return useQuery({
    queryKey: queryKeys.insights,
    queryFn: () => api.get<RecoveryInsightsDto>('/api/insights'),
    enabled,
    // Insights are a nice-to-have over local data; never block the dashboard.
    staleTime: 15 * 60 * 1000,
  });
}

/**
 * Drains every pending local row in one round trip and marks the rows synced
 * from the id map the server returns.
 *
 * Call this on app foreground and after a session completes. It is safe to call
 * when there is nothing pending -- it short-circuits without a request.
 */
export function useSyncPendingMutations() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { sessions, checkins } = await getPendingMutations();
      if (sessions.length === 0 && checkins.length === 0) return null;

      const payload: SyncPushRequest = {
        sessions: sessions.map((row) => ({
          clientId: row.id,
          type: row.type,
          startedAt: new Date(row.started_at).toISOString(),
          endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : null,
          plannedDurationMs: row.planned_duration_ms,
          actualDurationMs: row.actual_duration_ms,
          completed: row.completed === 1,
          soundscape: row.soundscape,
          notes: row.notes,
        })),
        checkins: checkins.map((row) => ({
          clientId: row.id,
          score: row.score,
          localDate: row.local_date,
          recordedAt: new Date(row.recorded_at).toISOString(),
          context: row.context,
        })),
      };

      const result = await api.post<SyncPushResponse>('/api/sync', payload);

      // Mark synced one row at a time against the returned map. A row missing
      // from the map stays pending and is retried on the next drain, which is
      // the behaviour we want for a partial server-side failure.
      await Promise.all([
        ...Object.entries(result.sessionIds).map(([clientId, remoteId]) =>
          markSynced('sessions', clientId, remoteId),
        ),
        ...Object.entries(result.checkinIds).map(([clientId, remoteId]) =>
          markSynced('energy_checkins', clientId, remoteId),
        ),
      ]);

      return result;
    },
    onSuccess: (result) => {
      if (result) client.invalidateQueries({ queryKey: queryKeys.insights });
    },
    onError: () => {
      // Offline is the expected case, not an exception. Rows stay pending.
    },
  });
}
