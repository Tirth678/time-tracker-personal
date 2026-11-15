/**
 * Types shared by the browser app and the Express API.
 * Keep this file free of runtime dependencies so both sides can import it.
 */

export const TIMER_MODES = ["stopwatch", "pomodoro"] as const;
export type TimerMode = (typeof TIMER_MODES)[number];

export const SESSION_NAME_MAX_LENGTH = 120;
export const DEFAULT_SESSION_NAME = "Untitled session";

/** No session can have started before this: a guard against broken clocks and damaged data. */
export const EARLIEST_SESSION_START_MS = Date.UTC(2000, 0, 1);
/** Most focus rounds a single session can claim. */
export const MAX_POMODOROS_COMPLETED = 100_000;

/** A finished study session — the record that is stored in the database. */
export interface StudySession {
  /** UUID generated in the browser, which makes saving idempotent. */
  id: string;
  name: string;
  mode: TimerMode;
  /** ISO 8601 instant at which the session was started. */
  startedAt: string;
  /** ISO 8601 instant at which time was last counted for the session. */
  endedAt: string;
  /** Time actually studied: pauses and Pomodoro breaks are excluded. */
  durationSeconds: number;
  /** Full focus rounds finished (always 0 for stopwatch sessions). */
  pomodorosCompleted: number;
}

/** GET /api/stats */
export interface StudyStats {
  totalSeconds: number;
  sessionCount: number;
  /** Seconds studied in sessions that started at or after `todayStart`. */
  todaySeconds: number;
}

/** GET /api/sessions */
export interface SessionPage {
  sessions: StudySession[];
  /** Pass back as `cursor` to fetch the next (older) page; null on the last page. */
  nextCursor: string | null;
}

/** POST /api/sessions */
export interface SaveSessionsResult {
  /** Sessions stored by this request. */
  saved: number;
  /** Valid sessions that had already been stored by an earlier request. */
  duplicates: number;
  /** Sessions that failed validation and were not stored. */
  rejected: RejectedSession[];
}

export interface RejectedSession {
  /** Position of the session in the request's `sessions` array. */
  index: number;
  id: string | null;
  issues: { path: string; message: string }[];
}

/** GET /api/health */
export interface HealthStatus {
  ok: boolean;
  database: "connected" | "not_configured" | "unreachable";
  cause?: string;
}

export interface MusicPlaylist {
  playlistId: string;
}

/** Shape of every other non-2xx JSON response from the API. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
