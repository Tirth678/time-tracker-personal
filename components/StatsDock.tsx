"use client";

import { motion } from "motion/react";
import { useMemo } from "react";

import { selectTotals } from "@/lib/client/tracker-store";
import { focusMs, isRunning } from "@/lib/timer/engine";
import { durationParts, spokenDuration, startOfDay } from "@/lib/timer/format";

import { useNow, useTracker } from "./tracker";
import { easeOut } from "./ui";

/** From a thousand hours on, the minutes are noise (and the room is needed). */
const HOURS_ONLY_FROM_SECONDS = 1000 * 3600;

const FIGURE = "text-[clamp(1.25rem,6.2vw,1.65rem)] font-light tabular-nums sm:text-[2rem] short:text-[1.6rem]";

function Duration({ seconds }: { seconds: number }) {
  const parts = durationParts(seconds);
  const shown = seconds >= HOURS_ONLY_FROM_SECONDS ? parts.slice(0, 1) : parts;
  return (
    <span className={FIGURE} aria-label={spokenDuration(seconds)}>
      {shown.map((part, index) => (
        <span key={part.unit} aria-hidden="true" className={index > 0 ? "ml-[0.28em]" : undefined}>
          {part.value}
          <span className="ml-[0.06em] text-[0.56em] font-normal text-white/50">{part.unit}</span>
        </span>
      ))}
    </span>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5 px-[clamp(0.6rem,3.6vw,1.25rem)] sm:px-8">
      <dt className="text-[10px] font-medium tracking-[clamp(0.1em,0.5vw,0.2em)] whitespace-nowrap text-white/50 uppercase">
        {label}
      </dt>
      <dd className="leading-none whitespace-nowrap text-white">{children}</dd>
    </div>
  );
}

/**
 * The dashboard: all time studied, today's share and the number of sessions.
 * The session that is running right now is already included, so the numbers
 * grow while you study and do not jump when you press End.
 */
export function StatsDock({ delay }: { delay: number }) {
  const local = useTracker((state) => state.local);
  const remote = useTracker((state) => state.remote);
  const older = useTracker((state) => state.older);
  const timer = useTracker((state) => state.timer);
  const now = useNow(timer !== null && isRunning(timer));

  const day = startOfDay(now);
  const totals = useMemo(() => selectTotals({ local, remote, older }, day), [local, remote, older, day]);

  const liveSeconds = timer ? Math.floor(focusMs(timer, now) / 1000) : 0;
  // Like finished sessions, the running one belongs to the day it started on.
  const liveToday = timer && timer.startedAt >= day ? liveSeconds : 0;

  return (
    <motion.dl
      className="glass flex max-w-full items-stretch divide-x divide-white/10 rounded-3xl py-4 sm:py-5 compact:py-3"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.9, ease: easeOut, delay }}
    >
      <Stat label="Total studied">
        <Duration seconds={totals.totalSeconds + liveSeconds} />
      </Stat>
      <Stat label="Today">
        <Duration seconds={totals.todaySeconds + liveToday} />
      </Stat>
      <Stat label="Sessions">
        <span className={FIGURE}>{totals.sessionCount.toLocaleString("en-US")}</span>
      </Stat>
    </motion.dl>
  );
}
