import { randomUUID } from "node:crypto";

import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { StudySession } from "../../lib/types";
import { createApp } from "../../server/app";
import type { Db } from "../../server/db/client";
import { ensureSchema, withSchemaRepair } from "../../server/db/schema";
import { createSessionStore, type SessionStore } from "../../server/db/session-store";
import { makeSession } from "../helpers/sessions";
import { TEST_BACKENDS } from "../helpers/test-db";

describe.each(TEST_BACKENDS)("API on $name", ({ create }) => {
  let db: Db;
  let closeDb: () => Promise<void>;
  let store: SessionStore;

  beforeAll(async () => {
    ({ db, close: closeDb } = await create());
    await ensureSchema(db);
    store = createSessionStore(db);
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    await db.query("TRUNCATE study_sessions, music_playlist");
  });

  const app = () => createApp({ getStore: async () => store });
  const post = (sessions: unknown[]) => request(app()).post("/api/sessions").send({ sessions });
  const list = async (): Promise<StudySession[]> => (await request(app()).get("/api/sessions")).body.sessions;

  describe("GET /api/health", () => {
    it("reports a connected database and is never cacheable", async () => {
      const res = await request(app()).get("/api/health");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, database: "connected" });
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["x-powered-by"]).toBeUndefined();
    });

    describe("playlist", () => {
      it("stores, reads and removes a YouTube playlist", async () => {
        expect((await request(app()).get("/api/playlist")).body).toBeNull();

        const saved = await request(app())
          .put("/api/playlist")
          .send({ playlistUrl: "https://www.youtube.com/playlist?list=PL_focus_music_123" });
        expect(saved.status).toBe(200);
        expect(saved.body).toEqual({ playlistId: "PL_focus_music_123" });
        expect((await request(app()).get("/api/playlist")).body).toEqual(saved.body);

        expect((await request(app()).delete("/api/playlist")).status).toBe(204);
        expect((await request(app()).get("/api/playlist")).body).toBeNull();
      });

      it("rejects non-YouTube playlist input", async () => {
        const res = await request(app()).put("/api/playlist").send({ playlistUrl: "https://example.com/music" });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("invalid_request");
      });
    });
  });

  describe("POST /api/sessions", () => {
    it("stores sessions and returns them newest first", async () => {
      const older = makeSession({ name: "Physics", minutesAgo: 300 });
      const newer = makeSession({
        name: "Chemistry",
        minutesAgo: 30,
        minutes: 10,
        mode: "pomodoro",
        pomodorosCompleted: 2,
      });

      const saved = await post([older, newer]);
      expect(saved.status).toBe(201);
      expect(saved.body).toEqual({ saved: 2, duplicates: 0, rejected: [] });

      const listed = await request(app()).get("/api/sessions");
      expect(listed.status).toBe(200);
      expect(listed.body).toEqual({ sessions: [newer, older], nextCursor: null });
    });

    it("is idempotent: re-sending a session never creates a duplicate or changes it", async () => {
      const session = makeSession();
      expect((await post([session])).status).toBe(201);

      const again = await post([session, { ...session, name: "Changed" }, makeSession({ name: "New one" })]);
      expect(again.status).toBe(201);
      expect(again.body).toEqual({ saved: 1, duplicates: 1, rejected: [] });

      const replay = await post([session]);
      expect(replay.status).toBe(200);
      expect(replay.body).toEqual({ saved: 0, duplicates: 1, rejected: [] });

      const sessions = await list();
      expect(sessions).toHaveLength(2);
      expect(sessions.find((s) => s.id === session.id)?.name).toBe("Linear algebra");
    });

    it("saves the valid sessions of a batch and reports the others", async () => {
      const good = makeSession({ name: "Good" });
      const alsoGood = makeSession({ name: "Also good", minutesAgo: 10, minutes: 5 });
      const res = await post([good, { ...makeSession(), id: "nope", name: "" }, "not even an object", alsoGood]);

      expect(res.status).toBe(201);
      expect(res.body.saved).toBe(2);
      expect(res.body.rejected).toEqual([
        {
          index: 1,
          id: "nope",
          issues: [
            { path: "id", message: expect.any(String) },
            { path: "name", message: expect.any(String) },
          ],
        },
        { index: 2, id: null, issues: [{ path: "", message: expect.any(String) }] },
      ]);
      expect((await list()).map((s) => s.name)).toEqual(["Also good", "Good"]);
    });

    it("cleans up names: trims, repairs broken unicode and flattens control characters", async () => {
      const cases: [string, string][] = [
        ["   ગણિત · Maths 📐   ", "ગણિત · Maths 📐"],
        ["line one\r\n\tline two", "line one line two"],
        ["null\u0000byte", "null byte"],
        ["broken \ud83d surrogate", "broken \ufffd surrogate"],
        ["it's \"quoted\" \\ and 'single'; DROP TABLE study_sessions;--", "it's \"quoted\" \\ and 'single'; DROP TABLE study_sessions;--"],
      ];
      const sessions = cases.map(([name], i) => makeSession({ name, minutesAgo: 100 - i, minutes: 1 }));

      const res = await post(sessions);
      expect(res.body).toEqual({ saved: cases.length, duplicates: 0, rejected: [] });

      const stored = new Map((await list()).map((s) => [s.id, s.name]));
      sessions.forEach((session, i) => expect(stored.get(session.id)).toBe(cases[i][1]));
    });

    it("normalises timestamps to UTC with millisecond precision", async () => {
      const session = makeSession({
        startedAt: "2026-03-01T10:00:00+05:30",
        endedAt: "2026-03-01T10:30:00.123456+05:30",
        durationSeconds: 1800,
      });
      expect((await post([session])).status).toBe(201);

      const [stored] = await list();
      expect(stored.startedAt).toBe("2026-03-01T04:30:00.000Z");
      expect(stored.endedAt).toBe("2026-03-01T05:00:00.123Z");
    });

    it.each([
      ["a malformed id", { id: "not-a-uuid" }, "id"],
      ["a blank name", { name: " \n\t " }, "name"],
      ["a name that is too long", { name: "x".repeat(121) }, "name"],
      ["a name that is not a string", { name: 42 }, "name"],
      ["an unknown mode", { mode: "sprint" }, "mode"],
      ["a date without a time zone", { startedAt: "2026-01-01T10:00:00" }, "startedAt"],
      ["a date that does not exist", { startedAt: "2026-02-30T10:00:00Z" }, "startedAt"],
      ["a fractional duration", { durationSeconds: 12.5 }, "durationSeconds"],
      ["a negative duration", { durationSeconds: -1 }, "durationSeconds"],
      ["a duration longer than the session", { durationSeconds: 25 * 60 + 60 }, "durationSeconds"],
      ["a duration too large for the database", { durationSeconds: 2 ** 31 }, "durationSeconds"],
      ["a negative pomodoro count", { pomodorosCompleted: -1 }, "pomodorosCompleted"],
      ["an end before the start", { endedAt: new Date(Date.now() - 86_400_000).toISOString() }, "endedAt"],
      ["an end far in the future", { endedAt: new Date(Date.now() + 3 * 86_400_000).toISOString() }, "endedAt"],
      ["a start before the year 2000", { startedAt: "1999-12-31T23:00:00Z" }, "startedAt"],
      ["a start in the year 0", { startedAt: "0000-01-01T00:00:00Z" }, "startedAt"],
    ])("rejects %s without storing it", async (_label, overrides, path) => {
      const session = { ...makeSession(), ...overrides };
      const res = await post([session]);

      expect(res.status).toBe(200);
      expect(res.body.saved).toBe(0);
      expect(res.body.rejected).toHaveLength(1);
      expect(res.body.rejected[0].index).toBe(0);
      expect(res.body.rejected[0].issues.map((issue: { path: string }) => issue.path)).toContain(path);
      expect(await list()).toHaveLength(0);
    });

    it("accepts the longest allowed name and a session that is still in the allowed future", async () => {
      const longName = makeSession({ name: "é".repeat(120) });
      const slightlyAhead = makeSession({
        startedAt: new Date(Date.now() + 3_600_000).toISOString(),
        endedAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
        durationSeconds: 3600,
      });
      const res = await post([longName, slightlyAhead]);
      expect(res.body).toEqual({ saved: 2, duplicates: 0, rejected: [] });
    });

    it("rejects a request that is not a list of 1 to 200 sessions", async () => {
      for (const body of [{ sessions: [] }, { sessions: "x" }, {}, [makeSession()]]) {
        const res = await request(app()).post("/api/sessions").send(body);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("invalid_request");
      }
      expect((await post(Array.from({ length: 201 }, () => makeSession()))).status).toBe(400);
      expect((await request(app()).post("/api/sessions")).status).toBe(400);
    });

    it("accepts a full batch of 200 sessions", async () => {
      const sessions = Array.from({ length: 200 }, (_, i) => makeSession({ minutesAgo: 1000 + i, minutes: 1 }));
      const res = await post(sessions);
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ saved: 200, duplicates: 0, rejected: [] });

      const stats = await request(app()).get("/api/stats");
      expect(stats.body).toMatchObject({ totalSeconds: 200 * 60, sessionCount: 200 });
    });

    it("answers malformed JSON with a 400 and oversized bodies with a 413", async () => {
      const bad = await request(app()).post("/api/sessions").set("Content-Type", "application/json").send("{nope");
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe("invalid_request");

      const huge = await request(app())
        .post("/api/sessions")
        .send({ sessions: [makeSession()], padding: "x".repeat(300_000) });
      expect(huge.status).toBe(413);
      expect(huge.body.error.code).toBe("payload_too_large");
    });
  });

  describe("GET /api/sessions", () => {
    it("pages through every session exactly once, even when start times tie", async () => {
      const tie = new Date(Date.now() - 3_600_000).toISOString();
      const tieEnd = new Date(Date.now() - 3_000_000).toISOString();
      const sessions = [
        ...Array.from({ length: 4 }, () => makeSession({ startedAt: tie, endedAt: tieEnd, durationSeconds: 60 })),
        ...Array.from({ length: 3 }, (_, i) => makeSession({ minutesAgo: 200 + i * 10, minutes: 5 })),
      ];
      expect((await post(sessions)).status).toBe(201);

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res: request.Response = await request(app())
          .get("/api/sessions")
          .query(cursor ? { limit: 3, cursor } : { limit: 3 });
        expect(res.status).toBe(200);
        expect(res.body.sessions.length).toBeLessThanOrEqual(3);
        seen.push(...res.body.sessions.map((s: StudySession) => s.id));
        cursor = res.body.nextCursor;
        pages += 1;
      } while (cursor && pages < 10);

      expect(pages).toBe(3);
      expect(seen).toHaveLength(7);
      expect(new Set(seen)).toEqual(new Set(sessions.map((s) => s.id)));

      const all = await request(app()).get("/api/sessions").query({ limit: 100 });
      expect(seen).toEqual(all.body.sessions.map((s: StudySession) => s.id));
      const starts = all.body.sessions.map((s: StudySession) => Date.parse(s.startedAt));
      expect(starts).toEqual([...starts].sort((a, b) => b - a));
    });

    it("returns a null cursor when the last page is exactly full", async () => {
      await post(Array.from({ length: 3 }, (_, i) => makeSession({ minutesAgo: 100 + i, minutes: 1 })));
      const res = await request(app()).get("/api/sessions").query({ limit: 3 });
      expect(res.body.sessions).toHaveLength(3);
      expect(res.body.nextCursor).toBeNull();
    });

    it("rejects bad paging parameters", async () => {
      for (const query of [{ limit: 0 }, { limit: 101 }, { limit: "many" }, { limit: 2.5 }, { cursor: "garbage" }]) {
        const res = await request(app()).get("/api/sessions").query(query);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("invalid_request");
      }
    });
  });

  describe("GET /api/stats", () => {
    it("returns zeros for an empty database", async () => {
      const res = await request(app()).get("/api/stats");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ totalSeconds: 0, sessionCount: 0, todaySeconds: 0 });
    });

    it("sums all time, and separately the time since todayStart", async () => {
      const todayStart = new Date(Date.now() - 2 * 3_600_000).toISOString();
      await post([
        makeSession({ minutesAgo: 30, minutes: 20 }),
        makeSession({ minutesAgo: 90, minutes: 45 }),
        makeSession({ minutesAgo: 60 * 30, minutes: 100 }),
      ]);

      const withToday = await request(app()).get("/api/stats").query({ todayStart });
      expect(withToday.body).toEqual({ totalSeconds: 165 * 60, sessionCount: 3, todaySeconds: 65 * 60 });

      // The same instant written with a UTC offset, as a browser in India would send it.
      const local = new Date(Date.parse(todayStart) + 330 * 60_000).toISOString().replace("Z", "+05:30");
      const withOffset = await request(app()).get("/api/stats").query({ todayStart: local });
      expect(withOffset.body.todaySeconds).toBe(65 * 60);

      const withoutToday = await request(app()).get("/api/stats");
      expect(withoutToday.body).toEqual({ totalSeconds: 165 * 60, sessionCount: 3, todaySeconds: 0 });

      expect((await request(app()).get("/api/stats").query({ todayStart: "yesterday" })).status).toBe(400);
    });

    it("keeps totals exact beyond the range of a 32-bit integer", async () => {
      // Three sessions of ~40 years each: far-fetched, but the sum must not overflow.
      const sessions = [0, 1, 2].map(() =>
        makeSession({
          startedAt: "2001-01-01T00:00:00.000Z",
          endedAt: "2041-01-01T00:00:00.000Z",
          durationSeconds: 1_200_000_000,
        }),
      );
      vi.useFakeTimers({ now: Date.parse("2041-01-01T00:00:00Z"), toFake: ["Date"] });
      try {
        expect((await post(sessions)).body.saved).toBe(3);
      } finally {
        vi.useRealTimers();
      }
      const stats = await request(app()).get("/api/stats");
      expect(stats.body.totalSeconds).toBe(3_600_000_000);
    });
  });

  describe("DELETE /api/sessions/:id", () => {
    it("deletes a session once", async () => {
      const session = makeSession();
      await post([session, makeSession({ minutes: 10 })]);

      const res = await request(app()).delete(`/api/sessions/${session.id}`);
      expect(res.status).toBe(204);
      expect(res.text).toBe("");

      const again = await request(app()).delete(`/api/sessions/${session.id}`);
      expect(again.status).toBe(404);
      expect(again.body.error.code).toBe("not_found");

      const stats = await request(app()).get("/api/stats");
      expect(stats.body).toMatchObject({ sessionCount: 1, totalSeconds: 600 });
    });

    it("rejects an id that is not a UUID", async () => {
      const res = await request(app()).delete("/api/sessions/1%3BDROP%20TABLE%20study_sessions");
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("invalid_request");
    });
  });

  describe("schema", () => {
    it("can be set up repeatedly and concurrently without touching the data", async () => {
      await post([makeSession()]);
      await ensureSchema(db);
      await Promise.all([ensureSchema(db), ensureSchema(db), ensureSchema(db)]);
      const stats = await request(app()).get("/api/stats");
      expect(stats.body.sessionCount).toBe(1);
    });

    it("enforces the same rules as the API at the database level", async () => {
      const insert = (values: string) =>
        db.query(
          `INSERT INTO study_sessions (id, name, mode, started_at, ended_at, duration_seconds) VALUES (${values})`,
        );
      const id = () => `'${randomUUID()}'`;
      await expect(insert(`${id()}, '', 'stopwatch', now(), now(), 1`)).rejects.toThrow();
      await expect(insert(`${id()}, 'x', 'nap', now(), now(), 1`)).rejects.toThrow();
      await expect(insert(`${id()}, 'x', 'stopwatch', now(), now() - interval '1 hour', 1`)).rejects.toThrow();
      await expect(insert(`${id()}, 'x', 'stopwatch', now(), now(), -5`)).rejects.toThrow();
      await expect(insert(`${id()}, 'x', 'stopwatch', now(), now(), 5`)).resolves.toBeDefined();
    });

    it("is created again when the table disappears while the server is running", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await post([makeSession()]);
        await db.query("DROP TABLE study_sessions");

        // Without the repair, every request fails until the server restarts.
        expect((await request(app()).get("/api/sessions")).status).toBe(500);

        const repairing = createSessionStore(withSchemaRepair(db));
        const healed = createApp({ getStore: async () => repairing });
        const session = makeSession({ name: "After the reset" });
        // Several requests find the table missing at the same moment.
        const [saved, stats, listed] = await Promise.all([
          request(healed).post("/api/sessions").send({ sessions: [session] }),
          request(healed).get("/api/stats"),
          request(healed).get("/api/sessions"),
        ]);
        expect([saved.status, stats.status, listed.status]).toEqual([201, 200, 200]);
        expect(saved.body).toEqual({ saved: 1, duplicates: 0, rejected: [] });
        expect(await list()).toEqual([session]);
        expect(warn).toHaveBeenCalled();

        // Other errors are not swallowed or retried.
        await expect(withSchemaRepair(db).query("SELECT * FROM study_sessions WHERE nope = 1")).rejects.toMatchObject({
          code: "42703",
        });
      } finally {
        await ensureSchema(db);
        warn.mockRestore();
        error.mockRestore();
      }
    });
  });
});

describe("API without a database", () => {
  const app = createApp({ getStore: async () => null });

  it("reports that no database is configured", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, database: "not_configured" });
  });

  it.each([
    ["get", "/api/sessions"],
    ["get", "/api/stats"],
    ["delete", `/api/sessions/${randomUUID()}`],
  ] as const)("%s %s answers 503 database_not_configured", async (method, path) => {
    const res = await request(app)[method](path);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("database_not_configured");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("never pretends to have saved a session", async () => {
    const malformed = await request(app).post("/api/sessions").send({ sessions: "x" });
    expect(malformed.status).toBe(400);

    for (const sessions of [[makeSession()], [{ id: "invalid" }]]) {
      const res = await request(app).post("/api/sessions").send({ sessions });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("database_not_configured");
    }
  });
});

describe("API when the database misbehaves", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    return () => consoleError.mockRestore();
  });

  const refused = Object.assign(new Error("connect ECONNREFUSED 10.1.2.3:5432"), { code: "ECONNREFUSED" });

  it("answers 503 for connection problems and keeps the details in the server log", async () => {
    const app = createApp({ getStore: () => Promise.reject(refused) });

    const res = await request(app).get("/api/stats");
    expect(res.status).toBe(503);
    expect(res.body.error).toEqual({
      code: "database_unavailable",
      message: "The database could not be reached.",
      details: { cause: "ECONNREFUSED" },
    });
    expect(JSON.stringify(res.body)).not.toContain("10.1.2.3");
    expect(consoleError).toHaveBeenCalled();
  });

  it("reports an unreachable database from the health check", async () => {
    const res = await request(createApp({ getStore: () => Promise.reject(refused) })).get("/api/health");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, database: "unreachable", cause: "ECONNREFUSED" });
  });

  it("answers 503 when a query fails mid-flight and 500 when the query itself is broken", async () => {
    const failing = (error: Error): SessionStore => ({
      list: () => Promise.reject(error),
      saveMany: () => Promise.reject(error),
      remove: () => Promise.reject(error),
      stats: () => Promise.reject(error),
      ping: () => Promise.reject(error),
      getPlaylist: () => Promise.reject(error),
      savePlaylist: () => Promise.reject(error),
      removePlaylist: () => Promise.reject(error),
    });

    const timeout = await request(createApp({ getStore: async () => failing(new Error("Query read timeout")) })).get(
      "/api/sessions",
    );
    expect(timeout.status).toBe(503);
    expect(timeout.body.error.code).toBe("database_unavailable");
    expect(timeout.body.error.details).toBeUndefined();

    const bug = Object.assign(new Error('relation "secret_table" does not exist'), { code: "42P01" });
    const broken = await request(createApp({ getStore: async () => failing(bug) }))
      .post("/api/sessions")
      .send({ sessions: [makeSession()] });
    expect(broken.status).toBe(500);
    expect(broken.body.error.code).toBe("internal_error");
    expect(JSON.stringify(broken.body)).not.toContain("secret_table");
  });
});

describe("API routing", () => {
  it("answers unknown routes and methods with a JSON 404", async () => {
    const app = createApp({ getStore: async () => null });
    for (const res of [
      await request(app).get("/api/nope"),
      await request(app).put("/api/sessions"),
      await request(app).get("/api"),
      await request(app).get("/api/sessions/extra/segments"),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("not_found");
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(res.headers["cache-control"]).toBe("no-store");
    }
  });
});
