import { z } from "zod";

import {
  EARLIEST_SESSION_START_MS,
  MAX_POMODOROS_COMPLETED,
  SESSION_NAME_MAX_LENGTH,
  TIMER_MODES,
  type StudySession,
} from "../lib/types";
import { HttpError } from "./errors";

/** Most sessions accepted by a single POST /api/sessions request. */
export const MAX_SESSIONS_PER_REQUEST = 200;

/** Tolerance for devices whose clock runs ahead of the server's. */
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;
/** Tolerance for rounding between the wall-clock span and the counted seconds. */
const DURATION_TOLERANCE_MS = 2_000;
/** Largest value of a Postgres `integer` column. */
const MAX_INT32 = 2_147_483_647;

/**
 * Makes a name safe to store and display on one line: repairs broken UTF-16
 * (which Postgres rejects), turns control characters into spaces and trims.
 */
export function cleanName(name: string): string {
  return name
    .toWellFormed()
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .trim();
}

/** An ISO 8601 instant with a time zone, normalised to `YYYY-MM-DDTHH:mm:ss.sssZ`. */
const instant = z.iso.datetime({ offset: true }).transform((value, ctx) => {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    ctx.addIssue({ code: "custom", message: "Invalid ISO datetime" });
    return z.NEVER;
  }
  return new Date(ms).toISOString();
});

export const sessionSchema = z
  .object({
    id: z.uuid(),
    name: z.string().overwrite(cleanName).min(1).max(SESSION_NAME_MAX_LENGTH),
    mode: z.enum(TIMER_MODES),
    startedAt: instant,
    endedAt: instant,
    durationSeconds: z.number().int().min(0).max(MAX_INT32),
    pomodorosCompleted: z.number().int().min(0).max(MAX_POMODOROS_COMPLETED).default(0),
  })
  .superRefine((session, ctx) => {
    const startedMs = Date.parse(session.startedAt);
    const endedMs = Date.parse(session.endedAt);

    if (startedMs < EARLIEST_SESSION_START_MS) {
      ctx.addIssue({ code: "custom", path: ["startedAt"], message: "startedAt is too far in the past" });
    }
    if (endedMs > Date.now() + FUTURE_TOLERANCE_MS) {
      ctx.addIssue({ code: "custom", path: ["endedAt"], message: "endedAt is in the future" });
    }
    if (endedMs < startedMs) {
      ctx.addIssue({ code: "custom", path: ["endedAt"], message: "endedAt must not be before startedAt" });
    } else if (session.durationSeconds * 1000 > endedMs - startedMs + DURATION_TOLERANCE_MS) {
      ctx.addIssue({
        code: "custom",
        path: ["durationSeconds"],
        message: "durationSeconds cannot be longer than the time between startedAt and endedAt",
      });
    }
  });

/** The request body of POST /api/sessions. Each session is validated on its own. */
export const saveSessionsSchema = z.object({
  sessions: z.array(z.unknown()).min(1).max(MAX_SESSIONS_PER_REQUEST),
});

export const listSessionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().min(1).max(200).optional(),
});

export const statsQuerySchema = z.object({
  todayStart: instant.optional(),
});

export const sessionIdSchema = z.uuid();

export interface ValidationIssue {
  path: string;
  message: string;
}

function toIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

/** Parses `input` with `schema`, turning failures into a 400 the client can display. */
export function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new HttpError(400, "invalid_request", "The request did not pass validation.", toIssues(result.error));
}

export type SessionCheck =
  | { ok: true; session: StudySession }
  | { ok: false; id: string | null; issues: ValidationIssue[] };

/** Validates one session without throwing, so a bad one cannot block the rest of a batch. */
export function checkSession(input: unknown): SessionCheck {
  const result = sessionSchema.safeParse(input);
  if (result.success) return { ok: true, session: result.data };

  const id = typeof input === "object" && input !== null ? (input as { id?: unknown }).id : undefined;
  return { ok: false, id: typeof id === "string" ? id.slice(0, 64) : null, issues: toIssues(result.error) };
}

// Compile-time guarantee that the validated payload is exactly a StudySession.
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const sessionShapeMatches: Equal<z.infer<typeof sessionSchema>, StudySession> = true;
void sessionShapeMatches;
