import express, { type ErrorRequestHandler, type Express, type RequestHandler } from "express";

import type { ApiErrorBody, HealthStatus, RejectedSession, SaveSessionsResult, StudySession } from "../lib/types";
import type { SessionStore } from "./db/session-store";
import { errorCode, HttpError, notConfiguredError, toDatabaseError } from "./errors";
import {
  checkSession,
  listSessionsQuerySchema,
  parseOrThrow,
  saveSessionsSchema,
  sessionIdSchema,
  statsQuerySchema,
} from "./validation";

export interface AppDependencies {
  /** Resolves the session store, or `null` while no database is configured. */
  getStore: () => Promise<SessionStore | null>;
}

/**
 * The Express application that owns every database interaction.
 *
 *   GET    /api/health         is the API up, and is a database connected?
 *   GET    /api/stats          total time studied (+ today, with ?todayStart=)
 *   GET    /api/sessions       finished sessions, newest first (?limit=&cursor=)
 *   POST   /api/sessions       save finished sessions (idempotent, per-session result)
 *   DELETE /api/sessions/:id   delete a session
 */
export function createApp({ getStore }: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("etag", false);

  /** Runs `work` against the store, mapping every failure onto an HTTP error. */
  async function withStore<T>(work: (store: SessionStore) => Promise<T>): Promise<T> {
    let store: SessionStore | null;
    try {
      store = await getStore();
    } catch (err) {
      throw toDatabaseError(err);
    }
    if (!store) throw notConfiguredError();

    try {
      return await work(store);
    } catch (err) {
      throw toDatabaseError(err);
    }
  }

  const api = express.Router();

  // Everything here is live, per-user data: never let a browser or CDN cache it.
  api.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  api.use(express.json({ limit: "256kb" }));

  api.get("/health", async (_req, res) => {
    let status: HealthStatus;
    try {
      const store = await getStore();
      await store?.ping();
      status = { ok: true, database: store ? "connected" : "not_configured" };
    } catch (err) {
      console.error("[api] health check failed:", err);
      status = { ok: false, database: "unreachable", cause: errorCode(err) };
    }
    res.status(status.ok ? 200 : 503).json(status);
  });

  api.get("/stats", async (req, res) => {
    const { todayStart } = parseOrThrow(statsQuerySchema, req.query);
    res.json(await withStore((store) => store.stats(todayStart)));
  });

  api.get("/sessions", async (req, res) => {
    const options = parseOrThrow(listSessionsQuerySchema, req.query);
    res.json(await withStore((store) => store.list(options)));
  });

  api.post("/sessions", async (req, res) => {
    const { sessions } = parseOrThrow(saveSessionsSchema, req.body);

    // Sessions are independent records, so each one is validated on its own:
    // a single bad session must never stop the others from being saved.
    const accepted = new Map<string, StudySession>();
    const rejected: RejectedSession[] = [];
    sessions.forEach((input, index) => {
      const check = checkSession(input);
      if (!check.ok) rejected.push({ index, id: check.id, issues: check.issues });
      // The same id twice in one request means the same session: keep the first.
      else if (!accepted.has(check.session.id)) accepted.set(check.session.id, check.session);
    });

    const saved = await withStore(async (store) =>
      accepted.size > 0 ? store.saveMany([...accepted.values()]) : 0,
    );

    const result: SaveSessionsResult = { saved, duplicates: accepted.size - saved, rejected };
    res.status(saved > 0 ? 201 : 200).json(result);
  });

  api.delete("/sessions/:id", async (req, res) => {
    const id = parseOrThrow(sessionIdSchema, req.params.id);
    const removed = await withStore((store) => store.remove(id));
    if (!removed) throw new HttpError(404, "not_found", "No session with that id exists.");
    res.status(204).end();
  });

  app.use("/api", api);

  const notFound: RequestHandler = (_req, _res, next) => {
    next(new HttpError(404, "not_found", "This API route does not exist."));
  };

  // Express identifies error handlers by their four parameters.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleError: ErrorRequestHandler = (err, _req, res, _next) => {
    const error = toHttpError(err);
    const body: ApiErrorBody = {
      error: { code: error.code, message: error.message, details: error.details },
    };
    res.setHeader("Cache-Control", "no-store");
    res.status(error.status).json(body);
  };

  app.use(notFound);
  app.use(handleError);

  return app;
}

function toHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;

  // Errors raised by express.json() carry a `type` describing what went wrong.
  const type = typeof err === "object" && err !== null ? (err as { type?: unknown }).type : undefined;
  if (type === "entity.too.large") {
    return new HttpError(413, "payload_too_large", "The request body is too large.");
  }
  if (type === "entity.parse.failed" || type === "encoding.unsupported" || type === "charset.unsupported") {
    return new HttpError(400, "invalid_request", "The request body is not valid JSON.");
  }

  console.error("[api] unexpected error:", err);
  return new HttpError(500, "internal_error", "Something went wrong.");
}
