"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

import {
  focusMs,
  isRunning,
  phaseElapsedMs,
  phaseProgress,
  phaseRemainingMs,
  roundProgress,
  type ActiveTimer,
  type PomodoroSettings,
} from "@/lib/timer/engine";
import { formatClock, formatDuration, spokenDuration } from "@/lib/timer/format";
import type { TimerMode } from "@/lib/types";

import { useNow, useTracker } from "./tracker";
import { easeOut } from "./ui";

/** Everything the face shows, derived from the timer and the current time. */
interface Face {
  /** `24:13` or `1:02:45`. */
  clock: string;
  /** What a screen reader says instead of the animated digits. */
  spoken: string;
  /** 0 → 1 around the ring, or `null` for the open-ended stopwatch. */
  progress: number | null;
  /** Position within the current minute (0 → 60 000), for the stopwatch's orbiting dot. */
  lapMs: number;
  label: string;
  detail: string | null;
  resting: boolean;
  running: boolean;
}

function describe(timer: ActiveTimer | null, mode: TimerMode, pomodoro: PomodoroSettings, now: number): Face {
  if (!timer) {
    const focusLength = pomodoro.focusMinutes * 60_000;
    return mode === "pomodoro"
      ? {
          clock: formatClock(focusLength, "up"),
          spoken: `Pomodoro, ${spokenDuration(focusLength / 1000)} of focus`,
          progress: 0,
          lapMs: 0,
          label: "Focus",
          detail: `${pomodoro.shortBreakMinutes} min break after`,
          resting: false,
          running: false,
        }
      : {
          clock: "00:00",
          spoken: "Stopwatch, ready",
          progress: null,
          lapMs: 0,
          label: "Stopwatch",
          detail: null,
          resting: false,
          running: false,
        };
  }

  const running = isRunning(timer);
  const elapsed = phaseElapsedMs(timer, now);

  if (timer.mode === "stopwatch") {
    return {
      clock: formatClock(elapsed),
      spoken: `${spokenDuration(elapsed / 1000)} elapsed${running ? "" : ", paused"}`,
      progress: null,
      lapMs: elapsed % 60_000,
      label: running ? "Focusing" : "Paused",
      detail: null,
      resting: false,
      running,
    };
  }

  const remaining = phaseRemainingMs(timer, now) ?? 0;
  const rounds = roundProgress(timer, pomodoro);
  const resting = timer.phase !== "focus";
  const studied = formatDuration(focusMs(timer, now) / 1000);

  let label: string;
  if (timer.phase === "shortBreak") label = "Short break";
  else if (timer.phase === "longBreak") label = "Long break";
  else if (running) label = `Focus · ${rounds.current} of ${rounds.of}`;
  else if (elapsed === 0) label = `Ready · ${rounds.current} of ${rounds.of}`;
  else label = "Paused";

  return {
    clock: formatClock(remaining, "up"),
    spoken: `${spokenDuration(Math.ceil(remaining / 1000))} left, ${label}`,
    progress: phaseProgress(timer, now),
    lapMs: 0,
    label,
    detail: `${studied} studied`,
    resting,
    running,
  };
}

/** One character of the clock. A digit that changes rolls upwards into place. */
function Digit({ char }: { char: string }) {
  return (
    <span className="relative inline-block">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={char}
          className="inline-block"
          initial={{ y: "0.34em", opacity: 0, filter: "blur(0.07em)" }}
          animate={{ y: 0, opacity: 1, filter: "blur(0em)" }}
          exit={{ y: "-0.34em", opacity: 0, filter: "blur(0.07em)" }}
          transition={{ duration: 0.42, ease: easeOut }}
        >
          {char}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function RollingClock({ text }: { text: string }) {
  const chars = [...text];
  // Longer readings (hours) shrink a little to stay inside the ring.
  const scale = chars.length <= 5 ? 1 : chars.length <= 7 ? 0.76 : chars.length === 8 ? 0.67 : 0.58;

  return (
    <span
      aria-hidden="true"
      className="flex items-baseline justify-center leading-none font-extralight tracking-[-0.045em] tabular-nums transition-[font-size] duration-500 ease-out-expo"
      style={{ fontSize: `calc(var(--ring) * ${0.25 * scale})` }}
    >
      {chars.map((char, index) => {
        // Keyed from the right, so the seconds stay the seconds when hours appear.
        const position = chars.length - index;
        return char === ":" ? (
          <span key={position} className="mx-[0.02em] -translate-y-[0.07em] opacity-45">
            :
          </span>
        ) : (
          <Digit key={position} char={char} />
        );
      })}
    </span>
  );
}

/**
 * The stopwatch's second hand: a dot that circles the ring once a minute.
 * It is a CSS animation, so it costs nothing while it runs; the negative
 * delay starts it at the right angle.
 */
function OrbitDot({ lapMs, running }: { lapMs: number; running: boolean }) {
  // Only the first value matters: afterwards the animation keeps time itself.
  const [startAt] = useState(lapMs);
  return (
    <div
      className="absolute inset-0 animate-orbit will-change-transform"
      style={{ animationDelay: `-${startAt}ms`, animationPlayState: running ? "running" : "paused" }}
    >
      <span className="absolute top-[1.5%] left-1/2 size-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_14px_2px_rgb(255_255_255/0.65)]" />
    </div>
  );
}

/** Counts how often the page has come back into view, to re-synchronise animations. */
function useVisits(): number {
  const [visits, setVisits] = useState(0);
  useEffect(() => {
    const onChange = () => {
      if (!document.hidden) setVisits((count) => count + 1);
    };
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visits;
}

export function TimerFace() {
  const timer = useTracker((state) => state.timer);
  const mode = useTracker((state) => state.settings.mode);
  const pomodoro = useTracker((state) => state.settings.pomodoro);
  const now = useNow(timer !== null && isRunning(timer));
  const visits = useVisits();

  const face = describe(timer, mode, pomodoro, now);
  const tone = face.resting ? "text-emerald-200" : "text-white";

  return (
    <div
      // The ring takes the height the rest of the page leaves over, so that
      // everything fits on one screen where that is possible at all. The rem
      // figures are the height of everything else in each layout, plus a margin.
      className={[
        "relative grid place-items-center",
        "[--ring:clamp(13rem,min(74vw,100dvh_-_26rem),25rem)]",
        "sm:[--ring:clamp(13rem,min(74vw,100dvh_-_31rem),25rem)]",
        "compact:[--ring:clamp(10rem,min(74vw,100dvh_-_21.5rem),25rem)]",
        "compact:sm:[--ring:clamp(10rem,min(74vw,100dvh_-_23rem),25rem)]",
        "short:[--ring:clamp(10rem,min(40vw,100dvh_-_10.5rem),25rem)]",
      ].join(" ")}
      style={{ width: "var(--ring)", height: "var(--ring)" }}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r="48.5" fill="none" stroke="currentColor" strokeOpacity="0.14" strokeWidth="0.35" />
        {face.progress !== null && (
          <circle
            cx="50"
            cy="50"
            r="48.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.7"
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray="1 1"
            // A hair short of empty, so the round cap never shows as a stray dot.
            strokeDashoffset={1 - Math.max(0, face.progress - 0.0001)}
            className={`${tone} transition-[stroke-dashoffset,color] duration-300 ease-linear`}
            style={{ opacity: face.progress > 0 ? 1 : 0 }}
          />
        )}
      </svg>

      {timer?.mode === "stopwatch" && (
        <OrbitDot key={`${timer.id}:${visits}`} lapMs={face.lapMs} running={face.running} />
      )}

      <div className="on-media relative flex flex-col items-center">
        <div
          role="timer"
          aria-live="off"
          aria-label={face.spoken}
          className={`transition-opacity duration-500 ${timer && !face.running && !face.resting ? "opacity-60" : ""}`}
        >
          <RollingClock text={face.clock} />
        </div>

        <div className="mt-[calc(var(--ring)*0.045)] flex h-9 flex-col items-center gap-1 text-center">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.p
              key={face.label}
              className={`text-[11px] font-medium tracking-[0.2em] uppercase ${face.resting ? "text-emerald-200/90" : "text-white/60"}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.35, ease: easeOut }}
            >
              {face.label}
            </motion.p>
          </AnimatePresence>
          {face.detail && <p className="text-xs text-white/40 tabular-nums">{face.detail}</p>}
        </div>
      </div>
    </div>
  );
}
