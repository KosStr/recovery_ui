import { QueryClient } from '@tanstack/react-query';

import { ApiError } from '@/api/client';

/**
 * Query defaults tuned for a local-first app.
 *
 * The important inversion: SQLite is the source of truth, so most queries here
 * read from disk and never fail. Network queries are the exception, and they
 * are configured to give up quietly rather than spin -- a user in a subway with
 * no signal should see yesterday's numbers, not a spinner.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Local reads are cheap but not free; a minute is long enough to avoid
      // refetch storms when several dashboard cards mount at once.
      staleTime: 60_000,
      gcTime: 24 * 60 * 60 * 1000,
      retry: (failureCount, error) => {
        if (error instanceof ApiError) return error.isRetryable && failureCount < 2;
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      // RN has no window focus; Query's default listener is a no-op that only
      // adds confusion. Refetch is driven explicitly by AppState instead.
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: {
      // Mutations write to SQLite first and are replayed by the sync worker,
      // so a failed push is not a user-visible error.
      retry: 1,
    },
  },
});

/** Centralised keys, so invalidation never depends on a stringly-typed guess. */
export const queryKeys = {
  sessions: {
    all: ['sessions'] as const,
    recent: (limit: number) => ['sessions', 'recent', limit] as const,
    focusMinutes: (dateKey: string) => ['sessions', 'focusMinutes', dateKey] as const,
  },
  energy: {
    all: ['energy'] as const,
    today: ['energy', 'today'] as const,
    trend: (days: number) => ['energy', 'trend', days] as const,
  },
  rituals: {
    forDay: (dateKey: string) => ['rituals', dateKey] as const,
  },
  insights: ['insights'] as const,
} as const;
