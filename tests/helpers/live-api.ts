import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { ApiError, createApi, type TrackerApi } from "../../lib/client/api";
import { createApp } from "../../server/app";
import { ensureSchema } from "../../server/db/schema";
import { createSessionStore, type SessionStore } from "../../server/db/session-store";
import { createMemoryDb } from "./test-db";

export type DatabaseMode = "connected" | "not_configured" | "down";

export interface HeldAnswer {
  /** Resolves once the server has answered and the answer is being held back. */
  reached: Promise<void>;
  /** Delivers the answer to the caller. */
  release(): void;
}

export interface LiveApi {
  /** The real browser client, talking HTTP to the real Express app. */
  api: TrackerApi;
  /** Every call made through `api`, in order, e.g. `saveSessions`. */
  calls: string[];
  /** How the server's database behaves from now on. */
  setDatabase(mode: DatabaseMode): void;
  /** Whether the "network" between client and server works. */
  setOnline(online: boolean): void;
  /** Holds back the server's answer to the next `method` call, like a slow connection. */
  hold(method: keyof TrackerApi): HeldAnswer;
  /** Loses the server's answer to the next `method` call: the server did the work, the caller sees a network error. */
  dropNextAnswer(method: keyof TrackerApi): void;
  /** Resolves once no call is in flight any more. */
  idle(): Promise<void>;
  /** Direct access to what the database contains. */
  store: SessionStore;
  reset(): Promise<void>;
  close(): Promise<void>;
}

const networkError = () => new ApiError(0, "network_error", "The server could not be reached.");

/** Starts the Express API on a free port with an in-memory Postgres behind it. */
export async function startLiveApi(): Promise<LiveApi> {
  const { db, close: closeDb } = await createMemoryDb();
  await ensureSchema(db);
  const store = createSessionStore(db);

  let database: DatabaseMode = "connected";
  let online = true;
  let inFlight = 0;
  const calls: string[] = [];
  const holds = new Map<string, { reached: () => void; released: Promise<void> }>();
  const drops = new Set<string>();

  const app = createApp({
    getStore: async () => {
      if (database === "down") {
        throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
      }
      return database === "connected" ? store : null;
    },
  });

  const server: Server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const real = createApi(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);

  function wrap<K extends keyof TrackerApi>(method: K): TrackerApi[K] {
    return (async (...args: unknown[]) => {
      calls.push(method);
      inFlight += 1;
      try {
        if (!online) throw networkError();
        const result = await (real[method] as (...a: unknown[]) => Promise<unknown>)(...args);

        const hold = holds.get(method);
        if (hold) {
          holds.delete(method);
          hold.reached();
          await hold.released;
        }
        if (drops.delete(method)) throw networkError();
        return result;
      } finally {
        inFlight -= 1;
      }
    }) as TrackerApi[K];
  }

  async function idle(): Promise<void> {
    // A finished call may be followed by the next one a few microtasks later.
    for (let quiet = 0; quiet < 3; quiet = inFlight === 0 ? quiet + 1 : 0) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  }

  return {
    api: {
      health: wrap("health"),
      stats: wrap("stats"),
      sessions: wrap("sessions"),
      saveSessions: wrap("saveSessions"),
      deleteSession: wrap("deleteSession"),
    },
    calls,
    store,
    idle,
    setDatabase(mode) {
      database = mode;
    },
    setOnline(value) {
      online = value;
    },
    hold(method) {
      let reached!: () => void;
      let release!: () => void;
      const reachedPromise = new Promise<void>((resolve) => (reached = resolve));
      const released = new Promise<void>((resolve) => (release = resolve));
      holds.set(method, { reached, released });
      return { reached: reachedPromise, release };
    },
    dropNextAnswer(method) {
      drops.add(method);
    },
    async reset() {
      await idle();
      await db.query("TRUNCATE study_sessions");
      database = "connected";
      online = true;
      holds.clear();
      drops.clear();
      calls.length = 0;
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await closeDb();
    },
  };
}
