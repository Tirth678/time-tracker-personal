import { describe, expect, it } from "vitest";

import {
  clampName,
  completePhase,
  DEFAULT_POMODORO,
  finishTimer,
  focusMs,
  isPhaseComplete,
  isRunning,
  pauseTimer,
  phaseElapsedMs,
  phaseProgress,
  phaseRemainingMs,
  renameTimer,
  resumeTimer,
  roundProgress,
  skipBreak,
  startTimer,
  type ActiveTimer,
  type PomodoroSettings,
} from "../../lib/timer/engine";
import { sessionSchema } from "../../server/validation";

const T0 = Date.parse("2026-11-15T09:00:00.000Z");
const SEC = 1000;
const MIN = 60 * SEC;
const ID = "3f2b8c1e-5d4a-4f6b-9a7c-0e1d2c3b4a59";

const settings: PomodoroSettings = { ...DEFAULT_POMODORO };

function stopwatch(name = "Maths", now = T0): ActiveTimer {
  return startTimer({ id: ID, name, mode: "stopwatch", settings, now });
}

function pomodoro(overrides: Partial<PomodoroSettings> = {}, now = T0): ActiveTimer {
  return startTimer({ id: ID, name: "Maths", mode: "pomodoro", settings: { ...settings, ...overrides }, now });
}

/** Runs a Pomodoro timer through one phase: waits until it is over, then advances. */
function finishPhase(timer: ActiveTimer, now: number, s: PomodoroSettings = settings): [ActiveTimer, number] {
  const running = isRunning(timer) ? timer : resumeTimer(timer, now);
  const end = now + (phaseRemainingMs(running, now) ?? 0);
  return [completePhase(running, s, end), end];
}

describe("stopwatch", () => {
  it("counts up from the moment it starts", () => {
    const timer = stopwatch();
    expect(isRunning(timer)).toBe(true);
    expect(phaseElapsedMs(timer, T0)).toBe(0);
    expect(phaseElapsedMs(timer, T0 + 90 * SEC)).toBe(90 * SEC);
    expect(phaseRemainingMs(timer, T0 + 90 * SEC)).toBeNull();
    expect(phaseProgress(timer, T0 + 90 * SEC)).toBeNull();
    expect(isPhaseComplete(timer, T0 + 99 * 3600 * SEC)).toBe(false);
  });

  it("does not count paused time", () => {
    let timer = stopwatch();
    timer = pauseTimer(timer, T0 + 10 * MIN);
    expect(isRunning(timer)).toBe(false);
    expect(focusMs(timer, T0 + 3 * 3600 * SEC)).toBe(10 * MIN);

    timer = resumeTimer(timer, T0 + 40 * MIN);
    expect(focusMs(timer, T0 + 45 * MIN)).toBe(15 * MIN);

    timer = pauseTimer(timer, T0 + 45 * MIN);
    timer = resumeTimer(timer, T0 + 50 * MIN);
    expect(focusMs(timer, T0 + 51 * MIN)).toBe(16 * MIN);
  });

  it("ignores a second pause or a second resume", () => {
    const running = stopwatch();
    expect(resumeTimer(running, T0 + MIN)).toBe(running);
    const paused = pauseTimer(running, T0 + MIN);
    expect(pauseTimer(paused, T0 + 2 * MIN)).toBe(paused);
  });

  it("never goes backwards when the device clock does", () => {
    const timer = stopwatch();
    expect(phaseElapsedMs(timer, T0 - 5 * MIN)).toBe(0);
    const paused = pauseTimer(timer, T0 - 5 * MIN);
    expect(focusMs(paused, T0)).toBe(0);
  });

  it("does nothing when asked to advance or skip", () => {
    const timer = stopwatch();
    expect(completePhase(timer, settings, T0 + 5 * 3600 * SEC)).toBe(timer);
    expect(skipBreak(timer, settings, T0 + MIN)).toBe(timer);
  });
});

describe("finishTimer", () => {
  it("produces the session that gets stored", () => {
    let timer = stopwatch("  Linear algebra  ");
    timer = pauseTimer(timer, T0 + 10 * MIN);
    timer = resumeTimer(timer, T0 + 15 * MIN);

    expect(finishTimer(timer, T0 + 25 * MIN + 999)).toEqual({
      id: ID,
      name: "Linear algebra",
      mode: "stopwatch",
      startedAt: "2026-11-15T09:00:00.000Z",
      endedAt: "2026-11-15T09:25:00.999Z",
      durationSeconds: 20 * 60,
      pomodorosCompleted: 0,
    });
  });

  it("ends a paused session at the moment it was paused", () => {
    const timer = pauseTimer(stopwatch(), T0 + 10 * MIN);
    const session = finishTimer(timer, T0 + 8 * 3600 * SEC);
    expect(session?.endedAt).toBe("2026-11-15T09:10:00.000Z");
    expect(session?.durationSeconds).toBe(600);
  });

  it("discards sessions shorter than a second", () => {
    expect(finishTimer(stopwatch(), T0)).toBeNull();
    expect(finishTimer(stopwatch(), T0 + 999)).toBeNull();
    expect(finishTimer(stopwatch(), T0 + 1000)?.durationSeconds).toBe(1);
  });

  it("falls back to a default name", () => {
    expect(finishTimer(stopwatch("   "), T0 + MIN)?.name).toBe("Untitled session");
    expect(finishTimer(renameTimer(stopwatch(""), "Renamed"), T0 + MIN)?.name).toBe("Renamed");
  });

  it("keeps the session at least as long as the time studied when the clock moved back", () => {
    let timer = stopwatch();
    timer = pauseTimer(timer, T0 + 30 * MIN);
    // The clock is set back an hour, then the session continues for 10 minutes.
    timer = resumeTimer(timer, T0 - 30 * MIN);
    const session = finishTimer(timer, T0 - 20 * MIN)!;
    expect(session.durationSeconds).toBe(40 * 60);
    expect(Date.parse(session.endedAt) - Date.parse(session.startedAt)).toBe(40 * MIN);
  });

  it.each([
    ["a stopwatch session", () => finishTimer(stopwatch("Maths"), T0 + 37 * MIN + 123)],
    ["a paused session", () => finishTimer(pauseTimer(stopwatch("x".repeat(500)), T0 + 5 * SEC), T0 + MIN)],
    [
      "a pomodoro session ended during a break",
      () => {
        const [onBreak, t] = finishPhase(pomodoro(), T0);
        return finishTimer(onBreak, t + 2 * MIN);
      },
    ],
    ["a session with an emoji name at the length limit", () => finishTimer(stopwatch("😀".repeat(100)), T0 + MIN)],
  ])("always passes the API's validation: %s", (_label, make) => {
    const session = make();
    expect(session).not.toBeNull();
    // Validation compares against the real clock, so sessions dated in the past are fine.
    const result = sessionSchema.safeParse(session);
    expect(result.error?.issues).toBeUndefined();
    expect(result.data).toEqual(session);
  });
});

describe("clampName", () => {
  it("trims and limits the length without splitting a surrogate pair", () => {
    expect(clampName("  hello  ")).toBe("hello");
    expect(clampName("a".repeat(200))).toHaveLength(120);
    const emoji = clampName("a" + "😀".repeat(100)); // 201 UTF-16 units
    expect(emoji.length).toBe(119);
    expect(emoji.isWellFormed()).toBe(true);
    expect(clampName("x".repeat(119) + " y")).toBe("x".repeat(119));
  });
});

describe("pomodoro", () => {
  it("counts down the focus round", () => {
    const timer = pomodoro();
    expect(phaseRemainingMs(timer, T0)).toBe(25 * MIN);
    expect(phaseRemainingMs(timer, T0 + 10 * MIN)).toBe(15 * MIN);
    expect(phaseProgress(timer, T0 + 10 * MIN)).toBeCloseTo(0.4);
    expect(isPhaseComplete(timer, T0 + 25 * MIN - 1)).toBe(false);
    expect(isPhaseComplete(timer, T0 + 25 * MIN)).toBe(true);
    expect(completePhase(timer, settings, T0 + 25 * MIN - 1)).toBe(timer);
  });

  it("starts a short break by itself when a focus round ends", () => {
    const timer = completePhase(pomodoro(), settings, T0 + 25 * MIN);
    expect(timer.phase).toBe("shortBreak");
    expect(isRunning(timer)).toBe(true);
    expect(timer.pomodorosCompleted).toBe(1);
    expect(phaseRemainingMs(timer, T0 + 25 * MIN)).toBe(5 * MIN);
    expect(focusMs(timer, T0 + 28 * MIN)).toBe(25 * MIN); // breaks are not study time
  });

  it("waits for Start after a break unless auto-start is on", () => {
    const [onBreak, t1] = finishPhase(pomodoro(), T0);

    const waiting = completePhase(onBreak, settings, t1 + 5 * MIN);
    expect(waiting.phase).toBe("focus");
    expect(isRunning(waiting)).toBe(false);
    expect(phaseRemainingMs(waiting, t1 + 60 * MIN)).toBe(25 * MIN);

    const auto = completePhase(onBreak, { ...settings, autoStartFocus: true }, t1 + 5 * MIN);
    expect(auto.phase).toBe("focus");
    expect(isRunning(auto)).toBe(true);
    expect(phaseRemainingMs(auto, t1 + 6 * MIN)).toBe(24 * MIN);
  });

  it("takes a long break after every fourth round", () => {
    let timer = pomodoro();
    let now = T0;
    const phases: string[] = [];
    for (let i = 0; i < 16; i += 1) {
      [timer, now] = finishPhase(timer, now);
      phases.push(timer.phase);
    }
    expect(phases).toEqual([
      "shortBreak", "focus", "shortBreak", "focus", "shortBreak", "focus", "longBreak", "focus",
      "shortBreak", "focus", "shortBreak", "focus", "shortBreak", "focus", "longBreak", "focus",
    ]);
    expect(timer.pomodorosCompleted).toBe(8);
    expect(focusMs(timer, now)).toBe(8 * 25 * MIN);
  });

  it("reports the position within the set of rounds", () => {
    let timer = pomodoro();
    let now = T0;
    const seen: unknown[] = [roundProgress(timer, settings)];
    for (let i = 0; i < 8; i += 1) {
      [timer, now] = finishPhase(timer, now);
      seen.push(roundProgress(timer, settings));
    }
    expect(seen).toEqual([
      { done: 0, current: 1, of: 4 },
      { done: 1, current: null, of: 4 },
      { done: 1, current: 2, of: 4 },
      { done: 2, current: null, of: 4 },
      { done: 2, current: 3, of: 4 },
      { done: 3, current: null, of: 4 },
      { done: 3, current: 4, of: 4 },
      { done: 4, current: null, of: 4 }, // long break: the set is complete
      { done: 0, current: 1, of: 4 },
    ]);
  });

  it("caps a phase the device slept through, and starts the next one on wake-up", () => {
    const wake = T0 + 3 * 3600 * SEC;
    const timer = pomodoro();
    expect(phaseElapsedMs(timer, wake)).toBe(25 * MIN);
    expect(focusMs(timer, wake)).toBe(25 * MIN);

    const onBreak = completePhase(timer, settings, wake);
    expect(onBreak.phase).toBe("shortBreak");
    expect(phaseRemainingMs(onBreak, wake)).toBe(5 * MIN);
    expect(onBreak.pomodorosCompleted).toBe(1);

    // Only the 25 minutes count, however long the device was asleep.
    const session = finishTimer(onBreak, wake + 2 * MIN)!;
    expect(session.durationSeconds).toBe(25 * 60);
    expect(session.pomodorosCompleted).toBe(1);
    expect(session.endedAt).toBe(new Date(wake + 2 * MIN).toISOString());
  });

  it("pauses and resumes within a focus round", () => {
    let timer = pomodoro();
    timer = pauseTimer(timer, T0 + 10 * MIN);
    expect(phaseRemainingMs(timer, T0 + 50 * MIN)).toBe(15 * MIN);
    expect(isPhaseComplete(timer, T0 + 50 * MIN)).toBe(false);

    timer = resumeTimer(timer, T0 + 60 * MIN);
    expect(isPhaseComplete(timer, T0 + 75 * MIN - 1)).toBe(false);
    expect(isPhaseComplete(timer, T0 + 75 * MIN)).toBe(true);
  });

  it("lets Start skip the rest of a break", () => {
    const [onBreak, t1] = finishPhase(pomodoro(), T0);
    const focusing = skipBreak(onBreak, settings, t1 + MIN);
    expect(focusing.phase).toBe("focus");
    expect(isRunning(focusing)).toBe(true);
    expect(focusing.pomodorosCompleted).toBe(1);
    expect(focusMs(focusing, t1 + 11 * MIN)).toBe(35 * MIN);
    expect(skipBreak(focusing, settings, t1 + 12 * MIN)).toBe(focusing);
  });

  it("counts a partial round as study time but not as a finished pomodoro", () => {
    const [onBreak, t1] = finishPhase(pomodoro(), T0);
    const focusing = skipBreak(onBreak, settings, t1 + MIN);
    const session = finishTimer(focusing, t1 + 11 * MIN + 30 * SEC)!;
    expect(session).toMatchObject({ mode: "pomodoro", durationSeconds: 35 * 60 + 30, pomodorosCompleted: 1 });
    expect(session.endedAt).toBe(new Date(t1 + 11 * MIN + 30 * SEC).toISOString());
  });

  it("uses changed durations from the next phase on", () => {
    const timer = pomodoro();
    const changed: PomodoroSettings = { ...settings, focusMinutes: 50, shortBreakMinutes: 10 };
    expect(phaseRemainingMs(timer, T0)).toBe(25 * MIN); // the running round keeps its length

    const onBreak = completePhase(timer, changed, T0 + 25 * MIN);
    expect(phaseRemainingMs(onBreak, T0 + 25 * MIN)).toBe(10 * MIN);
    const next = skipBreak(onBreak, changed, T0 + 26 * MIN);
    expect(phaseRemainingMs(next, T0 + 26 * MIN)).toBe(50 * MIN);
  });

  it("supports a set of a single round", () => {
    const single = { ...settings, roundsBeforeLongBreak: 1 };
    const [onBreak] = finishPhase(pomodoro(single), T0, single);
    expect(onBreak.phase).toBe("longBreak");
    expect(roundProgress(onBreak, single)).toEqual({ done: 1, current: null, of: 1 });
  });
});
