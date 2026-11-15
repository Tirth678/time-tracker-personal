import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";

import { errorCode } from "../errors";
import { ensureSchema, withSchemaRepair } from "./schema";

export type Row = Record<string, unknown>;

/**
 * The only thing the data layer needs from a database driver. Keeping it this
 * small lets the tests run the exact same SQL against an in-memory Postgres.
 */
export interface Db {
  query(text: string, values?: unknown[]): Promise<Row[]>;
}

/** `DATABASE_URL`, or the `POSTGRES_URL` that Vercel's Postgres integrations provide. */
export function databaseUrl(): string | null {
  const url = (process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim();
  return url === "" ? null : url;
}

/**
 * How to connect when the URL says `sslmode=require`.
 *
 * To Postgres, `require` means "encrypt, but don't insist on a verifiable
 * certificate". node-postgres 8 instead treats it as `verify-full`, which is
 * why hosts that sign certificates with their own CA (Supabase, Aiven, RDS…)
 * fail with "self-signed certificate in certificate chain".
 *
 * We get the best of both: verify the certificate first, and only when the
 * chain cannot be verified fall back to the encrypted-but-unverified
 * connection that `require` asks for. Every other sslmode is left untouched.
 */
export function connectionPlan(connectionString: string): { preferred: string; fallback: string | null } {
  const usesRequire = /[?&]sslmode=require(?=&|#|$)/.test(connectionString);
  const optedIntoLibpq = /[?&]uselibpqcompat=/.test(connectionString);
  if (!usesRequire || optedIntoLibpq) return { preferred: connectionString, fallback: null };

  return {
    preferred: connectionString.replace(/([?&])sslmode=require(?=&|#|$)/, "$1sslmode=verify-full"),
    fallback: connectionString.replace(/([?&])sslmode=require(?=&|#|$)/, "$1sslmode=require&uselibpqcompat=true"),
  };
}

/** TLS failures that mean "this certificate is not signed by a CA we trust". */
const UNVERIFIABLE_CERTIFICATE = new Set([
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

function createPool(connectionString: string): Pool {
  const pool = new Pool({
    connectionString,
    // A serverless instance only ever needs a handful of connections; point
    // DATABASE_URL at your provider's *pooled* endpoint when it offers one.
    max: 5,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
    query_timeout: 15_000,
  });

  // Without a listener, an error on an idle connection (e.g. the database
  // restarting) would be thrown as an uncaught exception and kill the process.
  pool.on("error", (err) => {
    console.error("[db] idle connection error:", err.message);
  });

  // On Vercel this keeps a function instance alive just long enough to close
  // its idle connections before it is suspended. It is a no-op everywhere else.
  attachDatabasePool(pool);

  return pool;
}

export function fromPool(pool: Pool): Db {
  return {
    async query(text, values) {
      const result = await pool.query(text, values);
      // A multi-statement query resolves to one result per statement.
      const last = Array.isArray(result) ? result.at(-1) : result;
      return last?.rows ?? [];
    },
  };
}

/** Opens a pool and makes sure the schema exists, closing the pool again on failure. */
async function open(connectionString: string): Promise<{ pool: Pool; db: Db }> {
  const pool = createPool(connectionString);
  const db = withSchemaRepair(fromPool(pool));
  try {
    await ensureSchema(db);
    return { pool, db };
  } catch (err) {
    await pool.end().catch(() => {});
    throw err;
  }
}

async function connect(url: string): Promise<{ pool: Pool; db: Db }> {
  const plan = connectionPlan(url);
  try {
    return await open(plan.preferred);
  } catch (err) {
    const code = errorCode(err);
    if (!plan.fallback || !code || !UNVERIFIABLE_CERTIFICATE.has(code)) throw err;

    console.warn(
      `[db] The database certificate could not be verified (${code}). Continuing with an encrypted, ` +
        "unverified connection, which is what sslmode=require permits. " +
        "Use sslmode=verify-full with sslrootcert to enforce verification.",
    );
    return open(plan.fallback);
  }
}

interface DbState {
  url: string;
  connection: Promise<{ pool: Pool; db: Db }>;
}

// Stored on globalThis so that hot reloads in development reuse one pool
// instead of leaking a new set of connections on every code change.
const globalState = globalThis as typeof globalThis & { __timeTrackerDb?: DbState };

/**
 * Returns a ready-to-use database handle, or `null` when no database has been
 * configured. The first call per process connects and creates the schema.
 */
export async function getDb(): Promise<Db | null> {
  const url = databaseUrl();
  if (!url) return null;

  let state = globalState.__timeTrackerDb;
  if (state?.url !== url) {
    // The connection string changed (e.g. .env.local was edited): start over.
    state?.connection.then(({ pool }) => pool.end()).catch(() => {});

    const created: DbState = { url, connection: connect(url) };
    created.connection.catch(() => {
      // Don't cache a failure: the next request should try to connect again.
      if (globalState.__timeTrackerDb === created) globalState.__timeTrackerDb = undefined;
    });
    globalState.__timeTrackerDb = state = created;
  }

  return (await state.connection).db;
}

/** Closes the pool. Only needed by scripts and tests; servers keep it open. */
export async function closeDb(): Promise<void> {
  const state = globalState.__timeTrackerDb;
  globalState.__timeTrackerDb = undefined;
  await state?.connection.then(({ pool }) => pool.end()).catch(() => {});
}
