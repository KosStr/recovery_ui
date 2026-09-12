# Data and sync

`src/db/localDb.ts`, `src/services/storage.ts`, `src/store/useEnergyStore.ts`,
`src/api/`.

- [The model](#the-model)
- [SQLite schema](#sqlite-schema)
- [Reading and writing](#reading-and-writing)
- [MMKV](#mmkv)
- [The Zustand store](#the-zustand-store)
- [TanStack Query](#tanstack-query)
- [Sync protocol](#sync-protocol)
- [What the .NET backend must provide](#what-the-net-backend-must-provide)
- [Migrations](#migrations)

---

## The model

**Local-first, not offline-tolerant.** The distinction matters:

- *Offline-tolerant* means the app works from a cache until the network returns,
  and the server is authoritative.
- *Local-first* means the device is authoritative. A write is **committed** the
  moment SQLite accepts it. The server is a replica that gets updated when it
  happens to be reachable.

Consequences you will see throughout the code:

- No screen has a loading skeleton.
- A failed sync is not an error. `useSyncPendingMutations` has an empty
  `onError`.
- Rows carry a client-generated UUID, so they have a stable identity before the
  server has ever seen them.
- The app is fully functional with no backend at all.

---

## SQLite schema

Opened with `expo-sqlite`'s `openDatabaseSync('recovery.db')` at module scope.
That is safe — it opens a handle without touching disk beyond the file header,
and it lets the first render read without a loading state. Schema work happens in
`initializeDatabase()`, which the root layout awaits before hiding the splash.

`PRAGMA journal_mode = WAL` (concurrent reads during a write) and
`PRAGMA foreign_keys = ON`.

### `sessions`

Every focus block, break, breathing session, NSDR, detox window, wind-down.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PK | Client-generated UUID |
| `type` | TEXT | `focus` `break` `breathing` `somatic_breathing` `nsdr` `detox` `winddown` |
| `started_at` | INTEGER | ms epoch |
| `ended_at` | INTEGER? | null while running or abandoned |
| `planned_duration_ms` | INTEGER | What was configured |
| `actual_duration_ms` | INTEGER? | Written on completion |
| `completed` | INTEGER | 0 / 1 |
| `soundscape` | TEXT? | |
| `notes` | TEXT? | |
| `sync_state` | TEXT | `pending` `synced` `conflict` |
| `remote_id` | TEXT? | Server id, after sync |

`planned_duration_ms` and `actual_duration_ms` are separate on purpose — the gap
between them is the interesting signal (how often blocks get abandoned).

### `energy_checkins`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PK | Client UUID |
| `score` | INTEGER | `CHECK (score BETWEEN 1 AND 5)` |
| `local_date` | TEXT | `YYYY-MM-DD`, **local** calendar day |
| `recorded_at` | INTEGER | ms epoch |
| `context` | TEXT? | |
| `sync_state` | TEXT | |
| `remote_id` | TEXT? | |

`local_date` is stored denormalised so grouping by day needs no timezone maths at
read time. Computed by `localDateKey()`, which subtracts the device offset before
slicing the ISO string — using UTC here would put an 11pm check-in on the wrong
day for anyone west of Greenwich.

**Many rows per day (FE-202).** There is deliberately *no* unique constraint on
`local_date`: the product tracks energy dips through the day, so each tap appends
a row and the day's headline number is `AVG(score)` (`getTodayEnergyStats`). The
schema always allowed this; only the app logic changed, from a one-per-day upsert
to an append. `context` holds the quick tags as a JSON array of stable tag ids.

### `ritual_completions`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PK | |
| `ritual_key` | TEXT | e.g. `screens-off` |
| `local_date` | TEXT | |
| `completed_at` | INTEGER | |
| `sync_state` | TEXT | |

Unique index on `(ritual_key, local_date)` — one tick per step per day.

### Indexes

```sql
idx_sessions_started   ON sessions (started_at DESC)
idx_sessions_sync      ON sessions (sync_state) WHERE sync_state = 'pending'
idx_checkins_date      ON energy_checkins (local_date DESC)
idx_checkins_sync      ON energy_checkins (sync_state) WHERE sync_state = 'pending'
idx_ritual_unique      ON ritual_completions (ritual_key, local_date)  -- UNIQUE
```

The dashboard reads "today" and "this week" constantly, and the sync worker scans
for pending rows. The two partial indexes keep the sync scan proportional to the
*pending* set rather than the whole table, which matters after a few months of
history.

---

## Reading and writing

All SQL lives in `localDb.ts`. **Screens never import it directly** — they go
through the hooks in `src/api/hooks/useSessions.ts`, which keeps cache
invalidation in one place.

| Function | Does |
| --- | --- |
| `insertSession(...)` | Opens a row, `pending`, returns the client id |
| `completeSession(id, endedAt?)` | Sets `ended_at`, computes `actual_duration_ms`, marks complete |
| `getRecentSessions(limit)` | Newest first |
| `getFocusMinutesForDay(dateKey)` | SUM of completed focus time for a local day |
| `insertEnergyCheckin(score, tags?)` | Appends a check-in; many per day |
| `updateCheckinTags(id, tags)` | Rewrites the tag array on one row |
| `getTodayEnergyStats()` | `{ average, count, latest }` for the local day |
| `getLatestTodayCheckin()` | Most recent row today, or null |
| `getEnergyTrend(days)` | |
| `toggleRitual(key)` | Returns the new checked state |
| `getCompletedRituals(dateKey?)` | Array of keys |
| `getPendingMutations()` | Everything the sync worker needs |
| `markSynced(table, id, remoteId)` | Flips to `synced` |

`localId()` generates an RFC-4122-shaped UUID using `Math.random`.
`crypto.randomUUID` is not guaranteed on Hermes, and these ids are namespaced by
account server-side, so per-device uniqueness is sufficient.

`markSynced` interpolates its table name, which is safe because the parameter is
a two-literal union (`'sessions' | 'energy_checkins'`) — TypeScript makes an
injected value unrepresentable. Every other value is a bound parameter.

---

## MMKV

`src/services/storage.ts`. Synchronous key-value storage, id `recovery.v1`.

Used for exactly two things:

1. The active timer, which must be readable during the first render pass.
2. The persisted Zustand snapshot, so a cold start restores instantly.

### Keys

```ts
StorageKeys = {
  activeTimer:       'timer.active',
  lastEnergyCheckin: 'energy.lastCheckin',
  energyStore:       'store.energy',
  windDownProgress:  'sleep.windDown',
  caffeineCutoff:    'sleep.caffeineCutoff',
  detoxSession:      'detox.activeSession',
  onboardingSeen:    'app.onboardingSeen',
}
```

Namespaced so a future migration can wipe one feature's data without touching
others.

### The fallback

MMKV is a JSI module, absent in Expo Go. Rather than crash on import, the module
falls back to an in-memory `Map`:

```ts
export const storageIsPersistent: boolean;
```

Everything keeps working for the length of the session; it just does not survive
a reload. `storageIsPersistent` is exported so UI can warn rather than silently
losing data.

`getJSON` deletes a corrupt entry on a parse failure, so a bad write cannot keep
throwing on every subsequent read.

---

## The Zustand store

`src/store/useEnergyStore.ts`. What the UI needs *right now*, persisted through
MMKV.

```ts
{
  // Today's energy, averaged across every check-in (FE-202)
  todayAverage: number | null;   todayCount: number;
  latestScore: EnergyScore | null;   energyDate: string | null;
  lastCheckinId: string | null;  lastTags: string[];  // for the tag sheet

  soundscape: Soundscape;
  detoxArmed: boolean;           detoxStartedAt: number | null;
  breathCyclesToday: number;     breathDate: string | null;
  hydrated: boolean;
}
```

Every day-scoped value is paired with the date it belongs to (`energyDate`,
`breathDate`). That is what makes midnight rollover possible without a scheduled
job: `hydrateFromDb()` compares the stored date against today and clears anything
stale, then reconciles the figures against SQLite (which wins).

`logEnergy` is optimistic for the 0 ms latency AC 3 demands: it folds the new
score into the running average synchronously, then writes the row and re-reads
`getTodayEnergyStats` to correct rounding. The persisted store is `version: 2` —
the shape changed from a single daily score, and the old blob is discarded rather
than migrated since it only held one transient day's figures.

### `hydrateFromDb()`

Runs on launch and on every foreground (`AppState → 'active'` in the root
layout). It does two things:

1. **Rolls over** anything stamped with a previous day.
2. **Reconciles with SQLite**, which wins. A check-in written before MMKV
   flushed, or made on another surface, overrides the persisted snapshot.

`hydrated` is excluded from persistence via `partialize` — it is a runtime flag,
not durable state.

### Selector hooks

```ts
useTodayEnergy()   useSoundscape()   useDetoxArmed()   useBreathCycles()
```

Subscribing to one field rather than the whole store means the breathing screen
does not re-render when the soundscape changes — which matters when a Skia canvas
is running behind it.

---

## TanStack Query

`src/api/queryClient.ts`.

The inversion worth understanding: **most queries here read from disk, not the
network.** Query is used for its cache and invalidation, not its fetching.

```ts
staleTime: 60_000        // local reads are cheap but not free
gcTime: 24h
retry: ApiError.isRetryable && count < 2
refetchOnWindowFocus: false   // RN has no window focus; the default is a no-op
refetchOnReconnect: true
```

`ApiError.isRetryable` is `true` for 5xx, 408 and 429 — a 400 or 404 will not
succeed on retry, so retrying it just delays the failure.

Keys are centralised in `queryKeys` so invalidation never depends on a
stringly-typed guess:

```ts
queryKeys.sessions.all
queryKeys.sessions.recent(limit)
queryKeys.sessions.focusMinutes(dateKey)
queryKeys.energy.today
queryKeys.energy.trend(days)
queryKeys.rituals.forDay(dateKey)
queryKeys.insights
```

### Hooks

| Hook | Source |
| --- | --- |
| `useRecentSessions` `useFocusMinutesToday` `useTodayCheckin` `useEnergyTrend` `useCompletedRituals` | SQLite |
| `useStartSession` `useCompleteSession` `useToggleRitual` | SQLite (write) |
| `useInsights` | **Network** |
| `useSyncPendingMutations` | **Network** |

`useToggleRitual` is optimistic: `onMutate` patches the cache, `onError` rolls
back from the snapshot, `onSettled` invalidates. A checklist tap must not wait on
disk.

---

## Sync protocol

One batched push. `useSyncPendingMutations` is called on the Today screen's mount
and can be called after any session completes.

```
getPendingMutations()          SELECT … WHERE sync_state = 'pending'
  │
  ├─ nothing pending? → return null, no request
  │
  ├─ POST /api/sync   { sessions: [...], checkins: [...] }
  │                     each carrying its clientId
  │
  └─ response         { sessionIds: {clientId: remoteId},
                        checkinIds: {clientId: remoteId} }
       └─ markSynced() per entry
```

**A row missing from the response map stays `pending`** and is retried on the
next drain. That is the desired behaviour for a partial server-side failure — no
row is lost, and no row is marked synced that was not.

Timestamps are converted to ISO-8601 at the boundary (`DateTimeOffset`
server-side); SQLite stores ms epochs.

`onError` is empty. Offline is the expected case, not an exception.

### Not yet implemented

- **Pull.** Nothing reads server state back into SQLite. Adding it means
  resolving conflicts — hence the `conflict` value already in the `sync_state`
  union.
- **Automatic drain triggers.** Currently only the Today screen fires it. A
  `NetInfo` reconnect listener or an `AppState` foreground hook would be the
  natural additions.

---

## What the .NET backend must provide

Two endpoints, per `src/api/types.ts`:

### `POST /api/sync`

```jsonc
// request — SyncPushRequest
{
  "sessions": [{
    "clientId": "…uuid…",
    "type": "focus",
    "startedAt": "2026-09-08T09:00:00+02:00",   // DateTimeOffset
    "endedAt": "2026-09-08T10:30:00+02:00",
    "plannedDurationMs": 5400000,
    "actualDurationMs": 5400000,
    "completed": true,
    "soundscape": "brown-noise",
    "notes": null
  }],
  "checkins": [{
    "clientId": "…uuid…",
    "score": 4,
    "localDate": "2026-09-08",                   // DateOnly
    "recordedAt": "2026-09-08T08:12:00+02:00",
    "context": null
  }]
}

// response — SyncPushResponse
{
  "sessionIds": { "…clientId…": "…serverId…" },
  "checkinIds": { "…clientId…": "…serverId…" }
}
```

**Must be idempotent by `clientId`.** The client retries anything it did not see
acknowledged, so the same row will arrive twice.

### `GET /api/insights`

```jsonc
// RecoveryInsightsDto
{
  "averageEnergy": 3.4,              // rolling 7-day mean
  "focusMinutesThisWeek": 620,
  "breathingSessionsThisWeek": 12,
  "longestDetoxStreakDays": 4,
  "peakEnergyHour": 10               // 0–23, or null
}
```

Aggregates the server computes so the client does not have to. Optional — the
dashboard reads local data and works without it.

### Auth

`setAuthTokenProvider()` in `src/api/client.ts` is wired but unused. Point it at
your auth store and every request gains `Authorization: Bearer …`.

### Generating types

Replace `src/api/types.ts` wholesale once Swagger is up:

```bash
npx openapi-typescript http://localhost:5187/swagger/v1/swagger.json -o src/api/types.ts
```

Nothing else imports the transport layer, so regeneration is a single-file swap.
Keep the exported names stable (or re-export the generated ones under these
aliases) and the hooks keep compiling.

---

## Migrations

`PRAGMA user_version` tracks the schema version; `SCHEMA_VERSION` is the target.

```ts
const row = await db.getFirstAsync<{user_version: number}>('PRAGMA user_version');
const current = row?.user_version ?? 0;

if (current < SCHEMA_VERSION) {
  // if (current < 2) { await db.execAsync('ALTER TABLE …'); }
  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}
```

At v1 the `CREATE TABLE IF NOT EXISTS` statements are the whole story. To add a
migration: bump `SCHEMA_VERSION`, add an `if (current < N)` block with the
`ALTER`/backfill, and leave the earlier blocks in place.

`initializeDatabase()` caches its promise, so it is safe to await from several
call sites during startup.
