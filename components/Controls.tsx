"use client";

import { Pause, Play, SkipForward, Square } from "lucide-react";
import { AnimatePresence } from "motion/react";

import { isRunning, type ActiveTimer } from "@/lib/timer/engine";

import { useTracker } from "./tracker";
import { PillButton, softSpring } from "./ui";

export type PrimaryAction = "start" | "pause" | "resume" | "skip-break";

/** What the main button does right now. The Space key does the same. */
export function primaryActionFor(timer: ActiveTimer | null): PrimaryAction {
  if (!timer) return "start";
  if (!isRunning(timer)) return "resume";
  return timer.phase === "focus" ? "pause" : "skip-break";
}

const PRIMARY = {
  start: { label: "Start", icon: Play, solid: true },
  pause: { label: "Pause", icon: Pause, solid: false },
  resume: { label: "Resume", icon: Play, solid: true },
  "skip-break": { label: "Skip break", icon: SkipForward, solid: false },
} as const;

export function Controls({
  onPrimary,
  onEnd,
  delay,
}: {
  onPrimary: (action: PrimaryAction) => void;
  onEnd: () => void;
  /** Holds the buttons back while the page makes its entrance. */
  delay: number;
}) {
  const timer = useTracker((state) => state.timer);
  const action = primaryActionFor(timer);
  const { icon: Icon, solid } = PRIMARY[action];
  // A round that has not begun yet reads better as "Start" than as "Resume".
  const waiting = timer !== null && timer.phase === "focus" && timer.phaseElapsedMs === 0 && !isRunning(timer);
  const label = waiting ? "Start round" : PRIMARY[action].label;
  const outlined = action === "skip-break";

  return (
    <div className="flex h-13 items-center justify-center gap-3">
      <AnimatePresence mode="popLayout">
        <PillButton
          key={action}
          layout
          variant={solid ? "solid" : "glass"}
          onClick={() => onPrimary(action)}
          aria-keyshortcuts={outlined ? undefined : "Space"}
          className="min-w-36"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ ...softSpring, delay }}
        >
          <Icon
            className="size-4"
            fill={outlined ? "none" : "currentColor"}
            strokeWidth={outlined ? 2 : 0}
            aria-hidden="true"
          />
          {label}
        </PillButton>

        {timer && (
          <PillButton
            key="end"
            layout
            onClick={onEnd}
            initial={{ opacity: 0, scale: 0.9, x: -16 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.9, x: -16 }}
            transition={{ ...softSpring, delay }}
          >
            <Square className="size-3.5" fill="currentColor" strokeWidth={0} aria-hidden="true" />
            End
          </PillButton>
        )}
      </AnimatePresence>
    </div>
  );
}
