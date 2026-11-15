import { randomUUID } from "node:crypto";

import type { StudySession } from "../../lib/types";

/** A valid session that started `minutesAgo` minutes ago and lasted `minutes`. */
export function makeSession(
  overrides: Partial<StudySession> & { minutesAgo?: number; minutes?: number } = {},
): StudySession {
  const { minutesAgo = 60, minutes = 25, ...rest } = overrides;
  const startedMs = Date.now() - minutesAgo * 60_000;
  return {
    id: randomUUID(),
    name: "Linear algebra",
    mode: "stopwatch",
    startedAt: new Date(startedMs).toISOString(),
    endedAt: new Date(startedMs + minutes * 60_000).toISOString(),
    durationSeconds: minutes * 60,
    pomodorosCompleted: 0,
    ...rest,
  };
}
