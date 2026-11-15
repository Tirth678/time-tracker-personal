import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";

import { fromPool, type Db } from "../../server/db/client";

export interface TestDb {
  db: Db;
  close: () => Promise<void>;
}

/**
 * A real Postgres (compiled to WebAssembly) running in memory, exposed through
 * the same tiny `Db` interface the production pool implements.
 */
export async function createMemoryDb(): Promise<TestDb> {
  const pg = await PGlite.create();

  const db: Db = {
    async query(text, values) {
      if (values) return (await pg.query<Record<string, unknown>>(text, values)).rows;
      // No parameters: may be a multi-statement script, like the schema setup.
      const results = await pg.exec(text);
      return (results.at(-1)?.rows ?? []) as Record<string, unknown>[];
    },
  };

  return { db, close: () => pg.close() };
}

/** A Postgres server reached through node-postgres, exactly as in production. */
export async function createServerDb(connectionString: string): Promise<TestDb> {
  const pool = new Pool({ connectionString, max: 4 });
  return { db: fromPool(pool), close: () => pool.end() };
}

/**
 * The databases the API suite runs against: always the in-memory one, plus a
 * real server when TEST_DATABASE_URL is set (its study_sessions table is wiped).
 */
export const TEST_BACKENDS: { name: string; create: () => Promise<TestDb> }[] = [
  { name: "in-memory Postgres", create: createMemoryDb },
  ...(process.env.TEST_DATABASE_URL
    ? [{ name: "Postgres server", create: () => createServerDb(process.env.TEST_DATABASE_URL!) }]
    : []),
];
