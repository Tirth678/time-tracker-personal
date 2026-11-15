/**
 * The timer, as pure functions over a plain object.
 *
 * Nothing in here reads the clock: every function receives `now` (epoch
 * milliseconds). Elapsed time is always derived from stored timestamps rather
 * than counted in ticks, so the timer stays exact while the tab is in the
 * background, throttled, or closed and reopened.
 */

import {
  DEFAULT_SESSION_NAME,
  SESSION_NAME_MAX_LENGTH,
  type StudySession,
  type TimerMode,
} from "../types";

export type Phase = "focus" | "shortBreak" | "longBreak";

export interface PomodoroSettings {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  /** Focus rounds before a long break replaces the short one. */
  roundsBeforeLongBreak: number;
  /** Start the next focus round by itself when a break ends. */
  autoStartFocus: boolean;
}

export const DEFAULT_POMODORO: PomodoroSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  roundsBeforeLongBreak: 4,
  autoStartFocus: false,
};

/** A session that is in progress (running or paused). */
export interface ActiveTimer {
  id: string;
  name: string;
  mode: TimerMode;
  /** When the session was started. */
  startedAt: number;
  phase: Phase;
  /** Length of the current phase; `null` for the open-ended stopwatch. */
  phaseDurationMs: number | null;
  /** Time counted in the current phase before the segment that is running now. */
  phaseElapsedMs: number;
  /** When the running segment began; `null` while paused. */
  runningSince: number | null;
  /** The last instant at which time was being counted (kept up to date while paused). */
  lastActiveAt: number;
  /** Focus time from phases that have already finished. */
  focusMs: number;
  pomodorosCompleted: number;
}

const MINUTE_MS = 60_000;

function phaseDuration(phase: Phase, settings: PomodoroSettings): number {
  const minutes =
    phase === "focus"
      ? settings.focusMinutes
      : phase === "shortBreak"
        ? settings.shortBreakMinutes
        : settings.longBreakMinutes;
  return minutes * MINUTE_MS;
}

export function startTimer(options: {
  id: string;
  name: string;
  mode: TimerMode;
  settings: PomodoroSettings;
  now: number;
}): ActiveTimer {
  const { id, name, mode, settings, now } = options;
  return {
    id,
    name,
    mode,
    startedAt: now,
    phase: "focus",
    phaseDurationMs: mode === "pomodoro" ? phaseDuration("focus", settings) : null,
    phaseElapsedMs: 0,
    runningSince: now,
    lastActiveAt: now,
    focusMs: 0,
    pomodorosCompleted: 0,
  };
}

export function isRunning(timer: ActiveTimer): boolean {
  return timer.runningSince !== null;
}

export function isBreak(timer: ActiveTimer): boolean {
  return timer.phase !== "focus";
}

/** Time counted so far in the current phase, capped at the phase length. */
export function phaseElapsedMs(timer: ActiveTimer, now: number): number {
  // A clock that jumps backwards must never produce negative time.
  const live = timer.runningSince === null ? 0 : Math.max(0, now - timer.runningSince);
  const elapsed = timer.phaseElapsedMs + live;
  return timer.phaseDurationMs === null ? elapsed : Math.min(elapsed, timer.phaseDurationMs);
}

/** Time left in the current phase, or `null` for the stopwatch. */
export function phaseRemainingMs(timer: ActiveTimer, now: number): number | null {
  return timer.phaseDurationMs === null ? null : timer.phaseDurationMs - phaseElapsedMs(timer, now);
}

/** 0 → 1 through the current phase, or `null` for the stopwatch. */
export function phaseProgress(timer: ActiveTimer, now: number): number | null {
  if (timer.phaseDurationMs === null) return null;
  return timer.phaseDurationMs === 0 ? 1 : phaseElapsedMs(timer, now) / timer.phaseDurationMs;
}

export function isPhaseComplete(timer: ActiveTimer, now: number): boolean {
  return timer.phaseDurationMs !== null && phaseElapsedMs(timer, now) >= timer.phaseDurationMs;
}

/** Total time studied in this session: breaks and pauses do not count. */
export function focusMs(timer: ActiveTimer, now: number): number {
  return timer.focusMs + (timer.phase === "focus" ? phaseElapsedMs(timer, now) : 0);
}

/** The instant up to which time has been counted (earlier than `now` once a phase is capped). */
function countedUntil(timer: ActiveTimer, now: number): number {
  if (timer.runningSince === null) return timer.lastActiveAt;
  return timer.runningSince + (phaseElapsedMs(timer, now) - timer.phaseElapsedMs);
}

export function pauseTimer(timer: ActiveTimer, now: number): ActiveTimer {
  if (timer.runningSince === null) return timer;
  return {
    ...timer,
    phaseElapsedMs: phaseElapsedMs(timer, now),
    lastActiveAt: countedUntil(timer, now),
    runningSince: null,
  };
}

export function resumeTimer(timer: ActiveTimer, now: number): ActiveTimer {
  if (timer.runningSince !== null) return timer;
  return { ...timer, runningSince: now };
}

export function renameTimer(timer: ActiveTimer, name: string): ActiveTimer {
  return { ...timer, name };
}

function enterPhase(
  timer: ActiveTimer,
  phase: Phase,
  settings: PomodoroSettings,
  now: number,
  start: boolean,
): ActiveTimer {
  return {
    ...timer,
    phase,
    phaseDurationMs: phaseDuration(phase, settings),
    phaseElapsedMs: 0,
    lastActiveAt: countedUntil(timer, now),
    runningSince: start ? now : null,
  };
}

/**
 * Moves a Pomodoro timer whose phase has run out on to the next phase:
 * a break starts right away, the next focus round only if `autoStartFocus`.
 *
 * The next phase begins at `now`, not at the moment the previous one ran out:
 * if the laptop slept through the end of a focus round, the break starts when
 * it wakes up instead of having silently passed.
 */
export function completePhase(timer: ActiveTimer, settings: PomodoroSettings, now: number): ActiveTimer {
  if (!isPhaseComplete(timer, now)) return timer;

  if (timer.phase === "focus") {
    const pomodorosCompleted = timer.pomodorosCompleted + 1;
    const rounds = Math.max(1, settings.roundsBeforeLongBreak);
    const next: Phase = pomodorosCompleted % rounds === 0 ? "longBreak" : "shortBreak";
    return enterPhase(
      { ...timer, focusMs: timer.focusMs + phaseElapsedMs(timer, now), pomodorosCompleted },
      next,
      settings,
      now,
      true,
    );
  }

  return enterPhase(timer, "focus", settings, now, settings.autoStartFocus);
}

/** Ends a break early and starts the next focus round immediately. */
export function skipBreak(timer: ActiveTimer, settings: PomodoroSettings, now: number): ActiveTimer {
  if (timer.phase === "focus") return timer;
  return enterPhase(timer, "focus", settings, now, true);
}

/**
 * Where the timer is within the current set of rounds.
 * `done` counts the finished rounds of the set; `current` is the 1-based round
 * that is in progress (or `null` during a break).
 */
export function roundProgress(
  timer: ActiveTimer,
  settings: PomodoroSettings,
): { done: number; current: number | null; of: number } {
  const of = Math.max(1, settings.roundsBeforeLongBreak);
  const inSet = timer.pomodorosCompleted % of;
  if (timer.phase === "focus") return { done: inSet, current: inSet + 1, of };
  // A long break follows the last round of a set, so the whole set is done.
  return { done: timer.phase === "longBreak" ? of : inSet, current: null, of };
}

/** Trims a name to the stored maximum without cutting an emoji in half. */
export function clampName(name: string): string {
  let clamped = name.trim().slice(0, SESSION_NAME_MAX_LENGTH);
  const last = clamped.charCodeAt(clamped.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) clamped = clamped.slice(0, -1);
  return clamped.trim();
}

/**
 * Turns the timer into the record that gets stored, or `null` when less than
 * a second was studied (an accidental start is not worth keeping).
 */
export function finishTimer(timer: ActiveTimer, now: number): StudySession | null {
  const studiedMs = focusMs(timer, now);
  const durationSeconds = Math.floor(studiedMs / 1000);
  if (durationSeconds < 1) return null;

  // The session can never be shorter than the time studied in it, even if the
  // device clock was moved backwards while it was running.
  const endedAt = Math.max(countedUntil(timer, now), timer.startedAt + studiedMs);

  return {
    id: timer.id,
    name: clampName(timer.name) || DEFAULT_SESSION_NAME,
    mode: timer.mode,
    startedAt: new Date(timer.startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    durationSeconds,
    pomodorosCompleted: timer.pomodorosCompleted,
  };
}
