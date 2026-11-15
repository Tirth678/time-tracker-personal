import { z } from "zod";

import type { MusicPlaylist, SessionPage, StudySession, StudyStats } from "../../lib/types";
import { HttpError } from "../errors";
import type { Db, Row } from "./client";

export interface SessionStore {
  list(options: { limit: number; cursor?: string }): Promise<SessionPage>;
  /** Inserts the sessions that are not stored yet and returns how many were new. */
  saveMany(sessions: StudySession[]): Promise<number>;
  /** Returns false when no session with that id exists. */
  remove(id: string): Promise<boolean>;
  stats(todayStart?: string): Promise<StudyStats>;
  ping(): Promise<void>;
  getPlaylist(): Promise<MusicPlaylist | null>;
  savePlaylist(playlistId: string): Promise<MusicPlaylist>;
  removePlaylist(): Promise<boolean>;
}

/*
 * Notes on the SQL below:
 *  - Timestamps are formatted by Postgres into the exact string that
 *    `Date#toISOString()` produces, so no driver-specific date parsing happens.
 *  - Parameters are cast through `text` (`$1::text::timestamptz`), which makes
 *    every Postgres driver send them the same way.
 */
const ISO_MS = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const ISO_US = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

const SESSION_COLUMNS = `
  id,
  name,
  mode,
  to_char(started_at AT TIME ZONE 'UTC', ${ISO_MS}) AS started_at,
  to_char(ended_at   AT TIME ZONE 'UTC', ${ISO_MS}) AS ended_at,
  duration_seconds,
  pomodoros_completed,
  to_char(started_at AT TIME ZONE 'UTC', ${ISO_US}) AS cursor_at
`;

function toSession(row: Row): StudySession {
  return {
    id: String(row.id),
    name: String(row.name),
    mode: row.mode === "pomodoro" ? "pomodoro" : "stopwatch",
    startedAt: String(row.started_at),
    endedAt: String(row.ended_at),
    durationSeconds: Number(row.duration_seconds),
    pomodorosCompleted: Number(row.pomodoros_completed),
  };
}

// Keyset pagination: the cursor is the (started_at, id) of the last row served.
const cursorSchema = z.tuple([z.iso.datetime(), z.uuid()]);

function encodeCursor(row: Row): string {
  return Buffer.from(JSON.stringify([row.cursor_at, row.id])).toString("base64url");
}

function decodeCursor(cursor: string): [startedAt: string, id: string] {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch {
    throw new HttpError(400, "invalid_request", "The cursor is not valid.");
  }
}

export function createSessionStore(db: Db): SessionStore {
  return {
    async list({ limit, cursor }) {
      // One extra row tells us whether another page exists.
      const rows = cursor
        ? await db.query(
            `SELECT ${SESSION_COLUMNS}
               FROM study_sessions
              WHERE (started_at, id) < ($1::text::timestamptz, $2::text::uuid)
              ORDER BY started_at DESC, id DESC
              LIMIT $3::int`,
            [...decodeCursor(cursor), limit + 1],
          )
        : await db.query(
            `SELECT ${SESSION_COLUMNS}
               FROM study_sessions
              ORDER BY started_at DESC, id DESC
              LIMIT $1::int`,
            [limit + 1],
          );

      const page = rows.slice(0, limit);
      return {
        sessions: page.map(toSession),
        nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null,
      };
    },

    async saveMany(sessions) {
      if (sessions.length === 0) return 0;

      const payload = sessions.map((s) => ({
        id: s.id,
        name: s.name,
        mode: s.mode,
        started_at: s.startedAt,
        ended_at: s.endedAt,
        duration_seconds: s.durationSeconds,
        pomodoros_completed: s.pomodorosCompleted,
      }));

      // ON CONFLICT DO NOTHING is what makes saving idempotent: a browser that
      // retries after a dropped response can never create a duplicate row.
      const inserted = await db.query(
        `INSERT INTO study_sessions
                (id, name, mode, started_at, ended_at, duration_seconds, pomodoros_completed)
         SELECT id, name, mode, started_at, ended_at, duration_seconds, pomodoros_completed
           FROM jsonb_to_recordset($1::text::jsonb) AS incoming (
                  id uuid,
                  name text,
                  mode text,
                  started_at timestamptz,
                  ended_at timestamptz,
                  duration_seconds integer,
                  pomodoros_completed integer
                )
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [JSON.stringify(payload)],
      );
      return inserted.length;
    },

    async remove(id) {
      const deleted = await db.query(
        `DELETE FROM study_sessions WHERE id = $1::text::uuid RETURNING id`,
        [id],
      );
      return deleted.length > 0;
    },

    async stats(todayStart) {
      const [row] = await db.query(
        `SELECT COALESCE(SUM(duration_seconds), 0)::float8 AS total_seconds,
                COUNT(*)::int AS session_count,
                COALESCE(
                  SUM(duration_seconds) FILTER (WHERE started_at >= $1::text::timestamptz),
                  0
                )::float8 AS today_seconds
           FROM study_sessions`,
        [todayStart ?? null],
      );
      return {
        totalSeconds: Number(row?.total_seconds ?? 0),
        sessionCount: Number(row?.session_count ?? 0),
        todaySeconds: Number(row?.today_seconds ?? 0),
      };
    },

    async ping() {
      await db.query("SELECT 1");
    },

    async getPlaylist() {
      const [row] = await db.query("SELECT playlist_id FROM music_playlist WHERE id = 1");
      return row ? { playlistId: String(row.playlist_id) } : null;
    },

    async savePlaylist(playlistId) {
      await db.query(
        `INSERT INTO music_playlist (id, playlist_id)
         VALUES (1, $1::text)
         ON CONFLICT (id) DO UPDATE SET playlist_id = EXCLUDED.playlist_id, updated_at = now()`,
        [playlistId],
      );
      return { playlistId };
    },

    async removePlaylist() {
      const deleted = await db.query("DELETE FROM music_playlist WHERE id = 1 RETURNING id");
      return deleted.length > 0;
    },
  };
}
