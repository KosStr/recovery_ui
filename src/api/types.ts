/**
 * Contract with the .NET backend.
 *
 * These are hand-written placeholders that mirror the intended DTOs. Replace
 * the whole file with generated output once the API is up:
 *
 *   npx openapi-typescript http://localhost:5187/swagger/v1/swagger.json \
 *     -o src/api/types.ts
 *
 * Nothing else imports from the transport layer, so regeneration is a
 * single-file swap. Keep the exported names below stable (or re-export the
 * generated ones under these aliases) and the hooks keep compiling.
 */

export interface SessionDto {
  id: string;
  /** Client-generated id, echoed back so we can reconcile the local row. */
  clientId: string;
  type: 'focus' | 'break' | 'breathing' | 'nsdr' | 'detox' | 'winddown';
  /** ISO-8601 with offset. DateTimeOffset on the server. */
  startedAt: string;
  endedAt: string | null;
  plannedDurationMs: number;
  actualDurationMs: number | null;
  completed: boolean;
  soundscape: string | null;
  notes: string | null;
}

export interface EnergyCheckinDto {
  id: string;
  clientId: string;
  score: number;
  /** DateOnly on the server, serialised as YYYY-MM-DD. */
  localDate: string;
  recordedAt: string;
  context: string | null;
}

/** Aggregates the server computes so the client does not have to. */
export interface RecoveryInsightsDto {
  /** Rolling 7-day mean of energy check-ins. */
  averageEnergy: number;
  focusMinutesThisWeek: number;
  breathingSessionsThisWeek: number;
  longestDetoxStreakDays: number;
  /** Hour of day (0-23) at which this user historically reports peak energy. */
  peakEnergyHour: number | null;
}

/** Batch push envelope, so a sync drain is one round trip rather than N. */
export interface SyncPushRequest {
  sessions: Omit<SessionDto, 'id'>[];
  checkins: Omit<EnergyCheckinDto, 'id'>[];
}

export interface SyncPushResponse {
  /** Maps clientId to the server-assigned id, for marking rows synced. */
  sessionIds: Record<string, string>;
  checkinIds: Record<string, string>;
}
