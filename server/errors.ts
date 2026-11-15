/** An error that maps directly onto an HTTP response. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function notConfiguredError(): HttpError {
  return new HttpError(
    503,
    "database_not_configured",
    "No database is connected yet. Set DATABASE_URL to start syncing sessions.",
  );
}

/**
 * SQLSTATE classes that mean "the query itself is wrong" rather than "the
 * database cannot be reached": data exceptions, constraint violations and
 * syntax / access-rule errors. Those are bugs, so they surface as a 500.
 */
const QUERY_ERROR_CLASSES = new Set(["22", "23", "42"]);

/** A short machine-readable reason, e.g. `ECONNREFUSED` or `28P01`. Never a message. */
export function errorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Za-z0-9_]{1,64}$/.test(code) ? code : undefined;
}

/** Wraps anything thrown by the database layer in an HttpError safe to send to clients. */
export function toDatabaseError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;

  const code = errorCode(err);
  const isQueryBug = code !== undefined && code.length === 5 && QUERY_ERROR_CLASSES.has(code.slice(0, 2));

  // The real error (which can contain hostnames) only goes to the server log.
  console.error("[api] database error:", err);

  return isQueryBug
    ? new HttpError(500, "internal_error", "Something went wrong while talking to the database.")
    : new HttpError(503, "database_unavailable", "The database could not be reached.", code ? { cause: code } : undefined);
}
