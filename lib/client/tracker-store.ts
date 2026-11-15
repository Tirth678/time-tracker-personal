/**
 * The app's state, independent of React.
 *
 * Everything is kept in the browser first ("local-first"): the running timer,
 * the settings and every finished session live in localStorage, so the app
 * works with no database and offline. When the API reports a database, the
 * finished sessions are uploaded and the totals come from the server.
 *
 * Invariant: `local` holds exactly the finished sessions that the cached
 * server snapshot `remote` does not include. The total shown to the user is
 * therefore always `remote.stats + local`, with nothing counted twice.
 */

import {
  completePhase,
  finishTimer,
  isPhaseComplete,
  pauseTimer,
  renameTimer,
  resumeTimer,
  skipBreak,
  startTimer,
  type ActiveTimer,
  type Phase,
} from "../timer/engine";
import { startOfDay } from "../timer/format";
import {
  EARLIEST_SESSION_START_MS,
  MAX_POMODOROS_COMPLETED,
  TIMER_MODES,
  type StudySession,
  type StudyStats,
  type TimerMode,
} from "../types";
import { ApiError, type TrackerApi } from "./api";
import { newId as randomId } from "./id";
import { sanitizeSettings, type Settings } from "./settings";
import { createJsonStore, type KeyValueStorage } from "./storage";

export const STORAGE_KEYS = {
  settings: "study-tracker:settings:v1",
  timer: "study-tracker:timer:v1",
  sessions: "study-tracker:sessions:v1",
  /** When a page last saw the stopwatch running: a heartbeat. */
  seen: "study-tracker:seen:v1",
} as const;

/** Sessions fetched per page of history. */
export const PAGE_SIZE = 30;
/** Sessions uploaded per request (the API accepts up to 200). */
const UPLOAD_BATCH = 100;
/** How long a successful sync is considered fresh when the tab regains focus. */
const STALE_AFTER_MS = 5 * 60_000;
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000];
/** A stopwatch that ran unobserved for longer than this is worth asking about. */
export const AWAY_AFTER_MS = 30 * 60_000;
const HEARTBEAT_EVERY_MS = 10_000;

/** A finished session that the cached server snapshot does not include. */
export interface LocalSession extends StudySession {
  /** The server has stored it, but the snapshot in `remote` is older than that. */
  synced?: true;
  /** The server refused it. It stays on this device so that it is never lost. */
  rejected?: true;
}

/** The last answer from the server, cached so the app opens instantly and works offline. */
export interface RemoteSnapshot {
  /** When this snapshot was requested (device clock), to tell which of two is newer. */
  requestedAt: number;
  stats: StudyStats;
  /** The local midnight (ISO) that `stats.todaySeconds` was calculated for. */
  todayStart: string;
  /** The newest sessions: the first page of history. */
  sessions: StudySession[];
  nextCursor: string | null;
}

export type SyncState =
  | { status: "idle" }
  | { status: "syncing" }
  | { status: "synced" }
  /** The API works but has no database: sessions stay on this device for now. */
  | { status: "local" }
  | { status: "error"; reason: "offline" | "unavailable" };

export interface TrackerState {
  settings: Settings;
  timer: ActiveTimer | null;
  /** The session name typed before pressing Start. */
  draftName: string;
  local: LocalSession[];
  remote: RemoteSnapshot | null;
  /** Older pages of history, loaded on demand. Never persisted. */
  older: { sessions: StudySession[]; nextCursor: string | null } | null;
  sync: SyncState;
  /**
   * Set when the stopwatch kept running while nobody was looking: the page was
   * closed or the device asleep since `since`. The user decides whether that
   * time counts — forgetting to press End should not log a whole night.
   */
  away: { since: number } | null;
  /** False while the browser refuses to store data (e.g. its quota is full). */
  storageOk: boolean;
}

export type TrackerEvent = { type: "phase-change"; from: Phase; to: Phase };

export interface TrackerStore {
  getState(): TrackerState;
  subscribe(listener: () => void): () => void;
  onEvent(listener: (event: TrackerEvent) => void): () => void;

  setDraftName(name: string): void;
  start(): void;
  pause(): void;
  resume(): void;
  /** Ends a Pomodoro break early and starts the next focus round. */
  skipBreak(): void;
  rename(name: string): void;
  /** Ends the session and stores it. Returns null when it was too short to keep. */
  end(): StudySession | null;
  /**
   * Keeps the timer up to date: advances a Pomodoro phase that has run out and
   * notices when the stopwatch ran unobserved. Cheap; call it a few times a second.
   */
  tick(now?: number): void;
  /** Answers the `away` question: the time counts. */
  keepAwayTime(): void;
  /** Answers the `away` question: stop the clock at the moment the user left. */
  discardAwayTime(): void;

  updateSettings(patch: Partial<Settings>): void;

  /** Uploads unsaved sessions and refreshes the totals. Never rejects. */
  sync(): Promise<void>;
  /**
   * The same, for when there is reason to think it will work now (the browser
   * reports a connection again, or the user asked): the waits between the
   * automatic retries, which grow with every failure, start over.
   */
  syncAfresh(): Promise<void>;
  /** Syncs if the last result is old, failed, or from a previous day. */
  syncIfStale(): void;
  deleteSession(id: string): Promise<void>;
  loadOlder(): Promise<void>;

  /** Re-reads a slice after another tab changed it. */
  reload(storageKey: string | null): void;
  dispose(): void;
}

// ───────────────────────────── stored data ─────────────────────────────

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isCount = (value: unknown): value is number => isNumber(value) && value >= 0;

// Stored data may be damaged or edited by hand. Besides the right types, the
// numbers have to be plausible, or one bad entry would wreck every total.
/** A century: longer than anything a timer can have counted. */
const MAX_SPAN_MS = 100 * 365.25 * 24 * 60 * 60 * 1000;
const isSpan = (value: unknown): value is number => isCount(value) && value <= MAX_SPAN_MS;
/** A moment on the device clock (the largest value a `Date` can hold is 8.64e15). */
const isClockTime = (value: unknown): value is number =>
  isNumber(value) && value >= EARLIEST_SESSION_START_MS && value <= 8.64e15;
const isRounds = (value: unknown): value is number =>
  isCount(value) && Number.isInteger(value) && value <= MAX_POMODOROS_COMPLETED;
const isMode = (value: unknown): value is TimerMode => TIMER_MODES.includes(value as TimerMode);
const isInstant = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));

const PHASES: readonly Phase[] = ["focus", "shortBreak", "longBreak"];
/** Rounding between the wall-clock span of a session and its counted seconds. */
const DURATION_TOLERANCE_SECONDS = 2;

function sanitizeTimer(value: unknown): ActiveTimer | null {
  if (!isRecord(value)) return null;
  const { id, name, mode, startedAt, phase, phaseDurationMs, phaseElapsedMs, runningSince, lastActiveAt } = value;
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    !isMode(mode) ||
    !isClockTime(startedAt) ||
    !PHASES.includes(phase as Phase) ||
    !isSpan(phaseElapsedMs) ||
    !(runningSince === null || isClockTime(runningSince)) ||
    !isNumber(lastActiveAt) ||
    !isSpan(value.focusMs) ||
    !isRounds(value.pomodorosCompleted)
  ) {
    return null;
  }
  // A stopwatch is open-ended; a Pomodoro phase always has a length.
  if (mode === "stopwatch" ? phaseDurationMs !== null : !(isSpan(phaseDurationMs) && phaseDurationMs > 0)) {
    return null;
  }
  return {
    id,
    name,
    mode,
    startedAt,
    phase: phase as Phase,
    phaseDurationMs: phaseDurationMs as number | null,
    phaseElapsedMs,
    runningSince: runningSince as number | null,
    lastActiveAt,
    focusMs: value.focusMs as number,
    pomodorosCompleted: value.pomodorosCompleted as number,
  };
}

function sanitizeSession(value: unknown): LocalSession | null {
  if (!isRecord(value)) return null;
  const { id, name, mode, startedAt, endedAt, durationSeconds, pomodorosCompleted } = value;
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    !isMode(mode) ||
    !isInstant(startedAt) ||
    !isInstant(endedAt) ||
    !isCount(durationSeconds)
  ) {
    return null;
  }
  const spanMs = Date.parse(endedAt) - Date.parse(startedAt);
  if (spanMs < 0) return null;
  // Time studied can never exceed the time that passed (the server insists on that too).
  const longestSeconds = Math.floor(spanMs / 1000) + DURATION_TOLERANCE_SECONDS;
  return {
    id,
    name,
    mode,
    startedAt,
    endedAt,
    durationSeconds: Math.min(Math.floor(durationSeconds), longestSeconds),
    pomodorosCompleted: isCount(pomodorosCompleted)
      ? Math.min(Math.floor(pomodorosCompleted), MAX_POMODOROS_COMPLETED)
      : 0,
    ...(value.synced === true ? { synced: true as const } : {}),
    ...(value.rejected === true ? { rejected: true as const } : {}),
  };
}

function sanitizeSessions(value: unknown): LocalSession[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, LocalSession>();
  for (const item of value) {
    const session = sanitizeSession(item);
    if (session && !byId.has(session.id)) byId.set(session.id, session);
  }
  return [...byId.values()];
}

function isStats(value: unknown): value is StudyStats {
  return isRecord(value) && isCount(value.totalSeconds) && isCount(value.sessionCount) && isCount(value.todaySeconds);
}

function sanitizeRemote(value: unknown): RemoteSnapshot | null {
  if (!isRecord(value) || !isStats(value.stats) || !isInstant(value.todayStart)) return null;
  return {
    requestedAt: isNumber(value.requestedAt) ? value.requestedAt : 0,
    stats: {
      totalSeconds: value.stats.totalSeconds,
      sessionCount: value.stats.sessionCount,
      todaySeconds: value.stats.todaySeconds,
    },
    todayStart: value.todayStart,
    sessions: sanitizeSessions(value.sessions).map(toStudySession),
    nextCursor: typeof value.nextCursor === "string" ? value.nextCursor : null,
  };
}

interface SessionsData {
  local: LocalSession[];
  remote: RemoteSnapshot | null;
}

function sanitizeSessionsData(value: unknown): SessionsData {
  const input = isRecord(value) ? value : {};
  return { local: sanitizeSessions(input.local), remote: sanitizeRemote(input.remote) };
}

function samePage(a: RemoteSnapshot | null, b: RemoteSnapshot | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.nextCursor === b.nextCursor &&
    a.sessions.length === b.sessions.length &&
    a.sessions.every((session, index) => session.id === b.sessions[index].id)
  );
}

function toStudySession(session: LocalSession): StudySession {
  const { id, name, mode, startedAt, endedAt, durationSeconds, pomodorosCompleted } = session;
  return { id, name, mode, startedAt, endedAt, durationSeconds, pomodorosCompleted };
}

// ───────────────────────────── selectors ─────────────────────────────

export interface Totals {
  totalSeconds: number;
  todaySeconds: number;
  sessionCount: number;
}

const sumSeconds = (sessions: readonly StudySession[]) =>
  sessions.reduce((sum, session) => sum + session.durationSeconds, 0);

/** The numbers on the dashboard: what the server knows plus what it does not know yet. */
export function selectTotals(state: Pick<TrackerState, "local" | "remote" | "older">, now: number): Totals {
  const todayStart = startOfDay(now);
  // Belt and braces for the invariant: a session the server is known to have is never added again.
  const known = new Set([...(state.remote?.sessions ?? []), ...(state.older?.sessions ?? [])].map(({ id }) => id));
  const local = state.local.filter((session) => !known.has(session.id));
  const localToday = local.filter((session) => Date.parse(session.startedAt) >= todayStart);
  // After midnight the cached "today" figure belongs to yesterday.
  const remoteIsToday = state.remote !== null && Date.parse(state.remote.todayStart) === todayStart;

  return {
    totalSeconds: (state.remote?.stats.totalSeconds ?? 0) + sumSeconds(local),
    todaySeconds: (remoteIsToday ? state.remote!.stats.todaySeconds : 0) + sumSeconds(localToday),
    sessionCount: (state.remote?.stats.sessionCount ?? 0) + local.length,
  };
}

export interface HistoryItem extends StudySession {
  /** Not stored in the database (yet). */
  pending: boolean;
  /** The server refused this session. */
  rejected: boolean;
}

/** Every loaded session, newest first, without duplicates. */
export function selectHistory(state: Pick<TrackerState, "local" | "remote" | "older">): HistoryItem[] {
  const byId = new Map<string, HistoryItem>();
  const add = (session: StudySession, pending: boolean, rejected: boolean) => {
    if (!byId.has(session.id)) byId.set(session.id, { ...toStudySession(session), pending, rejected });
  };

  for (const session of state.remote?.sessions ?? []) add(session, false, false);
  for (const session of state.older?.sessions ?? []) add(session, false, false);
  for (const session of state.local) add(session, session.synced !== true, session.rejected === true);

  return [...byId.values()].sort(
    (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || (a.id < b.id ? 1 : -1),
  );
}

/** Whether the server has older sessions that have not been loaded. */
export function selectHasOlder(state: Pick<TrackerState, "remote" | "older">): boolean {
  return (state.older ? state.older.nextCursor : (state.remote?.nextCursor ?? null)) !== null;
}

/** Sessions that exist only on this device. */
export function selectUnsyncedCount(state: Pick<TrackerState, "local">): number {
  return state.local.filter((session) => session.synced !== true).length;
}

/** Distinct names of recent sessions, newest first, for suggestions. */
export function selectRecentNames(state: Pick<TrackerState, "local" | "remote" | "older">, limit = 8): string[] {
  const names = new Set<string>();
  for (const session of selectHistory(state)) {
    names.add(session.name);
    if (names.size >= limit) break;
  }
  return [...names];
}

// ───────────────────────────── the store ─────────────────────────────

export interface TrackerStoreOptions {
  storage: KeyValueStorage;
  api: TrackerApi;
  /** Generates session ids. Defaults to random UUIDs. */
  newId?: () => string;
  /** Waits between attempts after a failed sync; the last one repeats. */
  retryDelaysMs?: readonly number[];
}

export function createTrackerStore({
  storage,
  api,
  newId = randomId,
  retryDelaysMs = RETRY_DELAYS_MS,
}: TrackerStoreOptions): TrackerStore {
  const json = createJsonStore(storage);
  const loadSettings = () => sanitizeSettings(json.read(STORAGE_KEYS.settings));
  const loadTimer = () => sanitizeTimer(json.read(STORAGE_KEYS.timer));
  const loadSessions = () => sanitizeSessionsData(json.read(STORAGE_KEYS.sessions));

  let state: TrackerState = {
    settings: loadSettings(),
    timer: loadTimer(),
    draftName: "",
    ...loadSessions(),
    older: null,
    sync: { status: "idle" },
    away: null,
    storageOk: true,
  };

  const listeners = new Set<() => void>();
  const eventListeners = new Set<(event: TrackerEvent) => void>();

  function set(patch: Partial<TrackerState>): void {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  }

  function emit(event: TrackerEvent): void {
    for (const listener of [...eventListeners]) listener(event);
  }

  /*
   * Persisted slices are changed with read-modify-write: the change is applied
   * to what is in storage *now*, not to this tab's copy. If the app is open in
   * two tabs, one tab can therefore never overwrite what the other just saved.
   */
  function persist(key: string, value: unknown): Partial<TrackerState> {
    json.write(key, value);
    return { storageOk: json.healthy() };
  }

  function changeSettings(change: (settings: Settings) => Settings): void {
    const settings = change(loadSettings());
    set({ settings, ...persist(STORAGE_KEYS.settings, settings) });
  }

  function changeTimer(change: (timer: ActiveTimer | null) => ActiveTimer | null, extra?: Partial<TrackerState>): void {
    const timer = change(loadTimer());
    set({ timer, ...extra, ...persist(STORAGE_KEYS.timer, timer) });
  }

  function changeSessions(change: (data: SessionsData) => SessionsData, extra?: Partial<TrackerState>): void {
    const data = change(loadSessions());
    set({ ...data, ...extra, ...persist(STORAGE_KEYS.sessions, data) });
  }

  // ── timer ──

  const settingsNow = () => state.settings.pomodoro;

  /**
   * Applies a change to the running timer after bringing its phase up to date.
   * Listeners hear about a phase that ran out, not about one the user skipped.
   */
  function changeActiveTimer(change: (timer: ActiveTimer, now: number) => ActiveTimer): void {
    const now = Date.now();
    const events: TrackerEvent[] = [];

    changeTimer((stored) => {
      if (!stored) return null;
      const current = completePhase(stored, settingsNow(), now);
      if (current.phase !== stored.phase) events.push({ type: "phase-change", from: stored.phase, to: current.phase });
      return change(current, now);
    });

    events.forEach(emit);
  }

  // ── absence ──

  const storedSeen = () => {
    const value = json.read(STORAGE_KEYS.seen);
    return isNumber(value) ? value : 0;
  };
  let lastSeen = storedSeen();
  let lastSeenSavedAt = 0;

  function markSeen(now: number): void {
    lastSeen = now;
    lastSeenSavedAt = now;
    json.write(STORAGE_KEYS.seen, now);
  }

  /**
   * Only the stopwatch is watched: it is open-ended, so a forgotten session
   * grows without limit. A Pomodoro round stops by itself when it is over.
   */
  function watchForAbsence(now: number): void {
    const timer = state.timer;
    if (!timer || timer.mode !== "stopwatch" || timer.runningSince === null) return;
    // While the question is open, the heartbeat stays put, so a reload asks again.
    if (state.away) return;

    if (now - lastSeen > AWAY_AFTER_MS) {
      // Another tab may have been watching the timer in the meantime.
      const since = Math.max(lastSeen, storedSeen(), timer.runningSince);
      if (now - since > AWAY_AFTER_MS) {
        set({ away: { since } });
        return;
      }
    }

    lastSeen = now;
    if (now - lastSeenSavedAt >= HEARTBEAT_EVERY_MS) markSeen(now);
  }

  // ── sync ──

  let running: Promise<void> | null = null;
  let rerun = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let lastAttemptAt = 0;
  /** True once the database has answered during this page visit. */
  let databaseSeen = false;
  /** Sessions the server refused during this page visit: not sent again until the next visit. */
  const refused = new Set<string>();
  let loadingOlder = false;
  let disposed = false;

  function cancelRetry(): void {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  }

  async function upload(): Promise<void> {
    const attempted = new Set<string>();
    while (!disposed) {
      const batch = state.local
        .filter((session) => !session.synced && !attempted.has(session.id) && !refused.has(session.id))
        .slice(0, UPLOAD_BATCH);
      if (batch.length === 0) return;
      for (const session of batch) attempted.add(session.id);

      const result = await api.saveSessions(batch.map(toStudySession));

      const rejected = new Set<string>();
      for (const { index } of Array.isArray(result?.rejected) ? result.rejected : []) {
        const id = batch[index]?.id;
        if (id) rejected.add(id);
      }
      for (const id of rejected) refused.add(id);

      const sent = new Set(batch.map((session) => session.id));
      changeSessions((data) => ({
        ...data,
        local: data.local.map((session): LocalSession => {
          if (!sent.has(session.id)) return session;
          return rejected.has(session.id)
            ? { ...toStudySession(session), rejected: true }
            : { ...toStudySession(session), synced: true };
        }),
      }));
    }
  }

  async function download(): Promise<void> {
    // Whatever the server confirmed before this request is part of its answer.
    const included = new Set(state.local.filter((session) => session.synced).map((session) => session.id));
    const requestedAt = Date.now();
    const todayStart = new Date(startOfDay(requestedAt)).toISOString();

    const [stats, page] = await Promise.all([api.stats(todayStart), api.sessions({ limit: PAGE_SIZE })]);
    if (!isStats(stats) || !isRecord(page) || !Array.isArray(page.sessions)) {
      throw new ApiError(200, "bad_response", "The server sent an unreadable response.");
    }

    const snapshot: RemoteSnapshot = {
      requestedAt,
      stats,
      todayStart,
      sessions: sanitizeSessions(page.sessions).map(toStudySession),
      nextCursor: typeof page.nextCursor === "string" ? page.nextCursor : null,
    };

    // Snapshot and local list change in one update, so the total on screen
    // never dips or double-counts.
    let firstPageChanged = true;
    changeSessions((data) => {
      // Another tab may have stored a snapshot that was requested after ours.
      const remote = data.remote !== null && data.remote.requestedAt > requestedAt ? data.remote : snapshot;
      firstPageChanged = !samePage(state.remote, remote);
      return { remote, local: data.local.filter((session) => !included.has(session.id)) };
    });
    // Older pages continue from the first one, so they are only valid while it is unchanged.
    set({ sync: { status: "synced" }, ...(firstPageChanged ? { older: null } : {}) });
  }

  async function syncOnce(): Promise<void> {
    cancelRetry();
    lastAttemptAt = Date.now();
    set({ sync: { status: "syncing" } });

    try {
      if (!databaseSeen) {
        const health = await api.health();
        if (health.database === "not_configured") {
          failures = 0;
          set({ sync: { status: "local" } });
          return;
        }
        if (health.database !== "connected") {
          throw new ApiError(503, "database_unavailable", "The database could not be reached.");
        }
        databaseSeen = true;
      }

      if (disposed) return;
      await upload();
      if (disposed) return;
      await download();
      failures = 0;
      // Another tab confirmed more sessions while we were downloading: fetch a snapshot that includes them.
      if (state.local.some((session) => session.synced)) rerun = true;
    } catch (err) {
      if (err instanceof ApiError && err.code === "database_not_configured") {
        databaseSeen = false;
        failures = 0;
        set({ sync: { status: "local" } });
        return;
      }
      if (!(err instanceof ApiError)) console.error("Sync failed unexpectedly:", err);

      const offline = err instanceof ApiError && err.code === "network_error";
      set({ sync: { status: "error", reason: offline ? "offline" : "unavailable" } });

      if (!disposed) {
        const delay = retryDelaysMs[Math.min(failures, retryDelaysMs.length - 1)] ?? 60_000;
        failures += 1;
        retryTimer = setTimeout(() => void sync(), delay);
      }
    }
  }

  function sync(): Promise<void> {
    if (running) {
      // Something changed while a sync was in flight: go round once more afterwards.
      rerun = true;
      return running;
    }
    running = (async () => {
      do {
        rerun = false;
        await syncOnce();
      } while (rerun && !disposed);
    })().finally(() => {
      running = null;
    });
    return running;
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    onEvent(listener) {
      eventListeners.add(listener);
      return () => void eventListeners.delete(listener);
    },

    setDraftName(name) {
      set({ draftName: name });
    },

    start() {
      const now = Date.now();
      markSeen(now);
      changeTimer(
        (stored) =>
          // Another tab may already have started a session: keep that one.
          stored ??
          startTimer({ id: newId(), name: state.draftName, mode: state.settings.mode, settings: settingsNow(), now }),
        { draftName: "", away: null },
      );
    },

    pause() {
      changeActiveTimer((timer, now) => pauseTimer(timer, now));
      set({ away: null });
    },

    resume() {
      markSeen(Date.now());
      changeActiveTimer((timer, now) => resumeTimer(timer, now));
      set({ away: null });
    },

    skipBreak() {
      changeActiveTimer((timer, now) => skipBreak(timer, settingsNow(), now));
    },

    rename(name) {
      changeTimer((stored) => (stored ? renameTimer(stored, name) : null));
    },

    end() {
      const now = Date.now();
      const stored = loadTimer();
      if (!stored) {
        set({ timer: null, away: null });
        return null;
      }

      const session = finishTimer(completePhase(stored, settingsNow(), now), now);
      // Store the session before clearing the timer: if the tab dies in
      // between, the session is saved twice (harmless) rather than not at all.
      if (session) {
        changeSessions((data) => ({
          ...data,
          local: [...data.local.filter((existing) => existing.id !== session.id), session],
        }));
      }
      changeTimer(() => null, { away: null });

      if (session) void sync();
      return session;
    },

    tick(now = Date.now()) {
      const timer = state.timer;
      if (!timer) return;
      if (isPhaseComplete(timer, now)) changeActiveTimer((current) => current);
      watchForAbsence(now);
    },

    keepAwayTime() {
      if (!state.away) return;
      markSeen(Date.now());
      set({ away: null });
    },

    discardAwayTime() {
      const away = state.away;
      if (!away) return;
      changeTimer(
        (stored) =>
          stored && stored.runningSince !== null
            ? pauseTimer(stored, Math.max(away.since, stored.runningSince))
            : stored,
        { away: null },
      );
    },

    updateSettings(patch) {
      changeSettings((settings) => sanitizeSettings({ ...settings, ...patch }));
    },

    sync,

    syncAfresh() {
      failures = 0;
      return sync();
    },

    syncIfStale() {
      const { status } = state.sync;
      if (status === "syncing") return;

      const now = Date.now();
      const dayChanged = state.remote !== null && Date.parse(state.remote.todayStart) !== startOfDay(now);
      if (status === "idle" || status === "error" || dayChanged || now - lastAttemptAt > STALE_AFTER_MS) void sync();
    },

    async deleteSession(id) {
      // Let an upload that is in flight finish, so we know where the session lives.
      await running?.catch(() => {});

      const local = state.local.find((session) => session.id === id);
      if (local && !local.synced) {
        changeSessions((data) => ({ ...data, local: data.local.filter((session) => session.id !== id) }));
        // An earlier upload may have reached the server without us hearing back.
        if (databaseSeen) api.deleteSession(id).catch(() => {});
        return;
      }

      try {
        await api.deleteSession(id);
      } catch (err) {
        // Already gone (deleted from another device) is as good as deleted.
        if (!(err instanceof ApiError && err.status === 404)) throw err;
      }

      const removeFrom = <T extends StudySession>(sessions: T[]) => sessions.filter((session) => session.id !== id);
      changeSessions(
        ({ local: storedLocal, remote }) => {
          const counted = remote
            ? [...remote.sessions, ...(state.older?.sessions ?? [])].find((session) => session.id === id)
            : undefined;
          if (!remote || !counted) return { local: removeFrom(storedLocal), remote };

          const countedToday = Date.parse(counted.startedAt) >= Date.parse(remote.todayStart);
          return {
            local: removeFrom(storedLocal),
            remote: {
              ...remote,
              sessions: removeFrom(remote.sessions),
              stats: {
                totalSeconds: Math.max(0, remote.stats.totalSeconds - counted.durationSeconds),
                sessionCount: Math.max(0, remote.stats.sessionCount - 1),
                todaySeconds: Math.max(0, remote.stats.todaySeconds - (countedToday ? counted.durationSeconds : 0)),
              },
            },
          };
        },
        state.older ? { older: { ...state.older, sessions: removeFrom(state.older.sessions) } } : undefined,
      );
    },

    async loadOlder() {
      const cursorOf = () => (state.older ? state.older.nextCursor : (state.remote?.nextCursor ?? null));
      const cursor = cursorOf();
      if (!cursor || loadingOlder) return;

      loadingOlder = true;
      try {
        const page = await api.sessions({ limit: PAGE_SIZE, cursor });
        // A sync may have replaced the first page meanwhile; this page would no longer line up.
        if (cursorOf() !== cursor) return;
        set({
          older: {
            sessions: [...(state.older?.sessions ?? []), ...sanitizeSessions(page.sessions).map(toStudySession)],
            nextCursor: typeof page.nextCursor === "string" ? page.nextCursor : null,
          },
        });
      } finally {
        loadingOlder = false;
      }
    },

    reload(storageKey) {
      // A null key means the whole storage was cleared.
      if (storageKey === null || storageKey === STORAGE_KEYS.settings) set({ settings: loadSettings() });
      if (storageKey === null || storageKey === STORAGE_KEYS.timer) {
        const timer = loadTimer();
        // The question only makes sense for the running timer it was asked about.
        const stillRunning = timer !== null && timer.runningSince !== null && timer.id === state.timer?.id;
        set({ timer, ...(stillRunning ? {} : { away: null }) });
      }
      if (storageKey === null || storageKey === STORAGE_KEYS.sessions) {
        const data = loadSessions();
        set({ ...data, ...(samePage(state.remote, data.remote) ? {} : { older: null }) });
      }
    },

    dispose() {
      disposed = true;
      cancelRetry();
      listeners.clear();
      eventListeners.clear();
    },
  };
}

