import * as SQLite from 'expo-sqlite';

/**
 * Local-first store.
 *
 * Every write lands here first and is considered committed the moment SQLite
 * accepts it. The `sync_state` column is what makes the app offline-first
 * rather than merely offline-tolerant: rows are authored locally with a UUID
 * and a `pending` flag, and a later push to the .NET backend flips them to
 * `synced`. Nothing in the UI ever waits on the network.
 *
 * `openDatabaseSync` is safe to call at module scope: it opens a handle without
 * touching disk beyond the file header, and it lets the first render read
 * without a loading state. Schema work happens in `initializeDatabase`, which
 * the root layout awaits before it hides the splash screen.
 */
export const db = SQLite.openDatabaseSync('recovery.db');

export type SyncState = 'pending' | 'synced' | 'conflict';
export type SessionType =
  | 'focus'
  | 'break'
  | 'breathing'
  | 'somatic_breathing'
  | 'nsdr'
  | 'detox'
  | 'winddown';

export interface SessionRow {
  id: string;
  type: SessionType;
  started_at: number;
  ended_at: number | null;
  /** Planned length. Differs from actual when the user bails early. */
  planned_duration_ms: number;
  /** Wall-clock time actually spent, written on completion. */
  actual_duration_ms: number | null;
  completed: number;
  soundscape: string | null;
  notes: string | null;
  sync_state: SyncState;
  remote_id: string | null;
}

export interface EnergyCheckinRow {
  id: string;
  /** 1 = depleted, 5 = charged. Deliberately coarse; a finer scale invites fiddling. */
  score: number;
  /** Local calendar day as YYYY-MM-DD, used to group without timezone maths at read time. */
  local_date: string;
  recorded_at: number;
  context: string | null;
  sync_state: SyncState;
  remote_id: string | null;
}

/**
 * Schema version, bumped whenever the statements below change shape.
 * `user_version` is a PRAGMA SQLite maintains for exactly this purpose.
 */
const SCHEMA_VERSION = 1;

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS sessions (
    id                  TEXT PRIMARY KEY NOT NULL,
    type                TEXT NOT NULL,
    started_at          INTEGER NOT NULL,
    ended_at            INTEGER,
    planned_duration_ms INTEGER NOT NULL DEFAULT 0,
    actual_duration_ms  INTEGER,
    completed           INTEGER NOT NULL DEFAULT 0,
    soundscape          TEXT,
    notes               TEXT,
    sync_state          TEXT NOT NULL DEFAULT 'pending',
    remote_id           TEXT
  );

  CREATE TABLE IF NOT EXISTS energy_checkins (
    id           TEXT PRIMARY KEY NOT NULL,
    score        INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
    local_date   TEXT NOT NULL,
    recorded_at  INTEGER NOT NULL,
    context      TEXT,
    sync_state   TEXT NOT NULL DEFAULT 'pending',
    remote_id    TEXT
  );

  CREATE TABLE IF NOT EXISTS ritual_completions (
    id           TEXT PRIMARY KEY NOT NULL,
    ritual_key   TEXT NOT NULL,
    local_date   TEXT NOT NULL,
    completed_at INTEGER NOT NULL,
    sync_state   TEXT NOT NULL DEFAULT 'pending'
  );

  -- Dashboards read "today" and "this week" constantly; these two indexes keep
  -- those queries off a full scan as history accumulates.
  CREATE INDEX IF NOT EXISTS idx_sessions_started    ON sessions (started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_sessions_sync       ON sessions (sync_state) WHERE sync_state = 'pending';
  CREATE INDEX IF NOT EXISTS idx_checkins_date       ON energy_checkins (local_date DESC);
  CREATE INDEX IF NOT EXISTS idx_checkins_sync       ON energy_checkins (sync_state) WHERE sync_state = 'pending';

  -- One wind-down ritual step can only be ticked once per day.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_ritual_unique ON ritual_completions (ritual_key, local_date);
`;

let initialization: Promise<void> | null = null;

/** Idempotent; safe to await from several call sites during startup. */
export function initializeDatabase(): Promise<void> {
  initialization ??= (async () => {
    await db.execAsync(SCHEMA);

    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    const current = row?.user_version ?? 0;

    if (current < SCHEMA_VERSION) {
      // Migrations land here as `if (current < N) { ... }` blocks. At v1 the
      // CREATE IF NOT EXISTS statements above are the whole story.
      await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }
  })();

  return initialization;
}

// --- Helpers ---------------------------------------------------------------

/**
 * RFC-4122-shaped id generated locally so a row has a stable identity before it
 * has ever reached the server. `crypto.randomUUID` is not guaranteed on the
 * Hermes runtime, so this uses Math.random -- adequate for per-device ids that
 * are namespaced by account server-side.
 */
export function localId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Local calendar day. Uses the device offset so "today" matches the user's day, not UTC. */
export function localDateKey(date: Date = new Date()): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
}

// --- Sessions --------------------------------------------------------------

export async function insertSession(
  input: Pick<SessionRow, 'type' | 'started_at' | 'planned_duration_ms'> &
    Partial<Pick<SessionRow, 'soundscape' | 'notes'>>,
): Promise<string> {
  const id = localId();
  await db.runAsync(
    `INSERT INTO sessions (id, type, started_at, planned_duration_ms, soundscape, notes, completed, sync_state)
     VALUES (?, ?, ?, ?, ?, ?, 0, 'pending')`,
    id,
    input.type,
    input.started_at,
    input.planned_duration_ms,
    input.soundscape ?? null,
    input.notes ?? null,
  );
  return id;
}

export async function completeSession(id: string, endedAt: number = Date.now()): Promise<void> {
  await db.runAsync(
    `UPDATE sessions
        SET ended_at = ?,
            actual_duration_ms = ? - started_at,
            completed = 1,
            sync_state = 'pending'
      WHERE id = ?`,
    endedAt,
    endedAt,
    id,
  );
}

export async function getRecentSessions(limit = 30): Promise<SessionRow[]> {
  return db.getAllAsync<SessionRow>(
    'SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?',
    limit,
  );
}

/** Total completed focus minutes for a given local day, used by the dashboard. */
export async function getFocusMinutesForDay(dateKey = localDateKey()): Promise<number> {
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(actual_duration_ms) AS total
       FROM sessions
      WHERE type = 'focus'
        AND completed = 1
        AND date(started_at / 1000, 'unixepoch', 'localtime') = ?`,
    dateKey,
  );
  return Math.round((row?.total ?? 0) / 60_000);
}

// --- Energy check-ins ------------------------------------------------------

/**
 * Appends a check-in. FE-202 tracks energy *through the day* — the dips after
 * lunch, the crash after a screen binge — so every tap is its own row rather
 * than overwriting an earlier one. The day's headline number is the average of
 * these rows (see `getTodayEnergyStats`), not the latest.
 *
 * `context` carries the quick tags as a JSON array of strings; the helpers
 * below encode and decode it so no call site has to know the wire shape.
 */
export async function insertEnergyCheckin(score: number, tags?: string[]): Promise<string> {
  const id = localId();
  await db.runAsync(
    `INSERT INTO energy_checkins (id, score, local_date, recorded_at, context, sync_state)
     VALUES (?, ?, ?, ?, ?, 'pending')`,
    id,
    score,
    localDateKey(),
    Date.now(),
    encodeTags(tags),
  );
  return id;
}

/**
 * Replaces the tags on an existing check-in. The tag bottom-sheet writes
 * through this as the user toggles chips, so the row and the UI never drift.
 * Re-flags the row `pending` so the edit is picked up by the next sync.
 */
export async function updateCheckinTags(id: string, tags: string[]): Promise<void> {
  await db.runAsync(
    `UPDATE energy_checkins SET context = ?, sync_state = 'pending' WHERE id = ?`,
    encodeTags(tags),
    id,
  );
}

export function encodeTags(tags?: string[] | null): string | null {
  return tags && tags.length > 0 ? JSON.stringify(tags) : null;
}

export function decodeTags(context: string | null): string[] {
  if (!context) return [];
  try {
    const parsed = JSON.parse(context);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/** The most recent check-in today, or null. Used to seed the store and to
 *  target tag edits at the row the user just created. */
export async function getLatestTodayCheckin(): Promise<EnergyCheckinRow | null> {
  return db.getFirstAsync<EnergyCheckinRow>(
    'SELECT * FROM energy_checkins WHERE local_date = ? ORDER BY recorded_at DESC LIMIT 1',
    localDateKey(),
  );
}

export interface TodayEnergyStats {
  /** Rounded-to-one-decimal mean of today's scores, or null with no readings. */
  average: number | null;
  count: number;
  /** Score of the most recent reading, or null. */
  latest: number | null;
}

export async function getTodayEnergyStats(): Promise<TodayEnergyStats> {
  const row = await db.getFirstAsync<{ avg: number | null; n: number; latest: number | null }>(
    `SELECT AVG(score) AS avg,
            COUNT(*)   AS n,
            (SELECT score FROM energy_checkins
              WHERE local_date = ? ORDER BY recorded_at DESC LIMIT 1) AS latest
       FROM energy_checkins
      WHERE local_date = ?`,
    localDateKey(),
    localDateKey(),
  );
  return {
    average: row?.avg != null ? Math.round(row.avg * 10) / 10 : null,
    count: row?.n ?? 0,
    latest: row?.latest ?? null,
  };
}

export async function getTodayCheckins(): Promise<EnergyCheckinRow[]> {
  return db.getAllAsync<EnergyCheckinRow>(
    'SELECT * FROM energy_checkins WHERE local_date = ? ORDER BY recorded_at ASC',
    localDateKey(),
  );
}

export async function getEnergyTrend(days = 7): Promise<EnergyCheckinRow[]> {
  return db.getAllAsync<EnergyCheckinRow>(
    'SELECT * FROM energy_checkins ORDER BY local_date DESC, recorded_at DESC LIMIT ?',
    days,
  );
}

// --- Wind-down rituals -----------------------------------------------------

export async function toggleRitual(ritualKey: string): Promise<boolean> {
  const dateKey = localDateKey();
  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM ritual_completions WHERE ritual_key = ? AND local_date = ?',
    ritualKey,
    dateKey,
  );

  if (existing) {
    await db.runAsync('DELETE FROM ritual_completions WHERE id = ?', existing.id);
    return false;
  }

  await db.runAsync(
    `INSERT INTO ritual_completions (id, ritual_key, local_date, completed_at, sync_state)
     VALUES (?, ?, ?, ?, 'pending')`,
    localId(),
    ritualKey,
    dateKey,
    Date.now(),
  );
  return true;
}

export async function getCompletedRituals(dateKey = localDateKey()): Promise<string[]> {
  const rows = await db.getAllAsync<{ ritual_key: string }>(
    'SELECT ritual_key FROM ritual_completions WHERE local_date = ?',
    dateKey,
  );
  return rows.map((r) => r.ritual_key);
}

// --- Sync surface ----------------------------------------------------------

/** Everything the push worker needs to drain. Kept in one place for the sync hook. */
export async function getPendingMutations(): Promise<{
  sessions: SessionRow[];
  checkins: EnergyCheckinRow[];
}> {
  const [sessions, checkins] = await Promise.all([
    db.getAllAsync<SessionRow>("SELECT * FROM sessions WHERE sync_state = 'pending'"),
    db.getAllAsync<EnergyCheckinRow>("SELECT * FROM energy_checkins WHERE sync_state = 'pending'"),
  ]);
  return { sessions, checkins };
}

export async function markSynced(
  table: 'sessions' | 'energy_checkins',
  id: string,
  remoteId: string,
): Promise<void> {
  await db.runAsync(
    `UPDATE ${table} SET sync_state = 'synced', remote_id = ? WHERE id = ?`,
    remoteId,
    id,
  );
}
