import { createApp } from "./app";
import { getDb } from "./db/client";
import { createSessionStore } from "./db/session-store";

/**
 * The Express app wired to the real database. Next.js mounts it at /api
 * (see pages/api/[[...path]].ts), so it deploys to Vercel as one function.
 */
export const app = createApp({
  async getStore() {
    const db = await getDb();
    return db ? createSessionStore(db) : null;
  },
});
