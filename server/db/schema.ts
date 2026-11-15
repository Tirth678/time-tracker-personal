import { errorCode } from "../errors";
import type { Db } from "./client";

/** Arbitrary constant identifying this app's schema setup to pg_advisory_xact_lock. */
const SCHEMA_LOCK_KEY = 7_364_219_581;

/**
 * Everything the app stores, written so it is safe to run on every cold start:
 * each statement is a no-op once it has been applied.
 *
 * To change the schema later, append idempotent statements such as
 * `ALTER TABLE study_sessions ADD COLUMN IF NOT EXISTS …` to this script.
 *
 * The constraints are deliberately independent of the database's encoding and
 * locale; limits such as the maximum name length are enforced by the API.
 */
export const SCHEMA_SQL = `
  SELECT pg_advisory_xact_lock(${SCHEMA_LOCK_KEY});

  CREATE TABLE IF NOT EXISTS study_sessions (
    id                  uuid        PRIMARY KEY,
    name                text        NOT NULL CHECK (name <> ''),
    mode                text        NOT NULL CHECK (mode IN ('stopwatch', 'pomodoro')),
    started_at          timestamptz NOT NULL,
    ended_at            timestamptz NOT NULL,
    duration_seconds    integer     NOT NULL CHECK (duration_seconds >= 0),
    pomodoros_completed integer     NOT NULL DEFAULT 0 CHECK (pomodoros_completed >= 0),
    created_at          timestamptz NOT NULL DEFAULT now(),
    CHECK (ended_at >= started_at)
  );

  CREATE INDEX IF NOT EXISTS study_sessions_started_at_idx
    ON study_sessions (started_at DESC, id DESC);
`;

/**
 * Creates the tables if they do not exist yet.
 *
 * The statements are sent as a single query, which Postgres runs as one
 * implicit transaction. The advisory lock at the top therefore serialises
 * concurrent cold starts, so two instances can never race to create the table.
 */
export async function ensureSchema(db: Db): Promise<void> {
  await db.query(SCHEMA_SQL);
}

/** SQLSTATE of "relation does not exist". */
const UNDEFINED_TABLE = "42P01";

/**
 * Wraps a database handle so that a missing table is created again, instead of
 * failing every request until the server restarts. The table goes missing when
 * the database is reset, or the table dropped, while an instance is running.
 *
 * Repeating the query is safe: one that failed this way has changed nothing.
 */
export function withSchemaRepair(db: Db): Db {
  let repair: Promise<void> | null = null;

  return {
    async query(text, values) {
      try {
        return await db.query(text, values);
      } catch (err) {
        if (errorCode(err) !== UNDEFINED_TABLE) throw err;

        if (!repair) {
          console.warn("[db] The study_sessions table is missing. Creating it again.");
          repair = ensureSchema(db).finally(() => {
            repair = null;
          });
        }
        await repair;
        return db.query(text, values);
      }
    },
  };
}
