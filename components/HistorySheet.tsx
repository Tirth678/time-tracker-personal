"use client";

import { CloudOff, Hourglass, Timer, Trash2, TriangleAlert } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";

import { selectHasOlder, selectHistory, type HistoryItem } from "@/lib/client/tracker-store";
import { dayLabel, formatDuration, spokenDuration, startOfDay, timeOfDay } from "@/lib/timer/format";

import { Sheet } from "./Sheet";
import { useNow, useStore, useTracker } from "./tracker";
import { easeOut } from "./ui";

interface Day {
  start: number;
  seconds: number;
  sessions: HistoryItem[];
}

function groupByDay(sessions: HistoryItem[]): Day[] {
  const days: Day[] = [];
  for (const session of sessions) {
    const start = startOfDay(Date.parse(session.startedAt));
    const last = days.at(-1);
    if (last && last.start === start) {
      last.sessions.push(session);
      last.seconds += session.durationSeconds;
    } else {
      days.push({ start, seconds: session.durationSeconds, sessions: [session] });
    }
  }
  return days;
}

function Row({ session, flagPending }: { session: HistoryItem; flagPending: boolean }) {
  const store = useStore();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const Icon = session.mode === "pomodoro" ? Hourglass : Timer;

  async function remove() {
    setBusy(true);
    setFailed(false);
    try {
      await store.deleteSession(session.id);
    } catch {
      setFailed(true);
      setBusy(false);
      setConfirming(false);
    }
  }

  const started = Date.parse(session.startedAt);
  const ended = Date.parse(session.endedAt);

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginTop: 0, marginBottom: 0 }}
      transition={{ duration: 0.3, ease: easeOut }}
      className="group overflow-hidden"
    >
      <div className="flex items-center gap-3.5 rounded-2xl px-3 py-3 transition-colors duration-200 hover:bg-white/[0.06]">
        <Icon className="size-4 shrink-0 text-white/35" strokeWidth={1.6} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] text-white/90">{session.name}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-white/45 tabular-nums">
            <span>
              {timeOfDay(started)} – {timeOfDay(ended)}
            </span>
            {session.pomodorosCompleted > 0 && (
              <span>
                · {session.pomodorosCompleted} {session.pomodorosCompleted === 1 ? "round" : "rounds"}
              </span>
            )}
            {session.rejected ? (
              <span className="inline-flex items-center gap-1 text-amber-200/80" title="The server did not accept this session. It is kept on this device.">
                · <TriangleAlert className="size-3" aria-hidden="true" /> Only on this device
              </span>
            ) : (
              flagPending &&
              session.pending && (
                <span className="inline-flex items-center gap-1" title="Not uploaded to the database yet">
                  · <CloudOff className="size-3" aria-hidden="true" /> Not synced yet
                </span>
              )
            )}
          </p>
          {failed && (
            <p role="alert" className="mt-1 text-xs text-rose-300">
              Couldn’t delete this session. Check your connection and try again.
            </p>
          )}
        </div>

        {confirming ? (
          <div className="flex shrink-0 items-center gap-1 text-xs">
            <button
              type="button"
              className="rounded-full bg-rose-400/90 px-3 py-1.5 font-medium text-ink transition-colors hover:bg-rose-300 disabled:opacity-60"
              disabled={busy}
              onClick={remove}
            >
              {busy ? "Deleting…" : "Delete"}
            </button>
            <button
              type="button"
              className="rounded-full px-2.5 py-1.5 text-white/60 transition-colors hover:text-white"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Keep
            </button>
          </div>
        ) : (
          <>
            <span className="shrink-0 text-sm text-white/75 tabular-nums" aria-label={spokenDuration(session.durationSeconds)}>
              {formatDuration(session.durationSeconds)}
            </span>
            <button
              type="button"
              aria-label={`Delete session ${session.name}`}
              title="Delete"
              className="-mr-1 grid size-8 shrink-0 place-items-center rounded-full text-white/30 transition-all duration-200 hover:bg-white/10 hover:text-rose-200 focus-visible:text-white sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
              onClick={() => setConfirming(true)}
            >
              <Trash2 className="size-[15px]" strokeWidth={1.7} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </motion.li>
  );
}

export function HistorySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useStore();
  const local = useTracker((state) => state.local);
  const remote = useTracker((state) => state.remote);
  const older = useTracker((state) => state.older);
  const usesDatabase = useTracker((state) => state.sync.status !== "local" && state.sync.status !== "idle");
  const now = useNow(false);

  const days = useMemo(() => groupByDay(selectHistory({ local, remote, older })), [local, remote, older]);
  const hasOlder = selectHasOlder({ remote, older });

  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  async function loadOlder() {
    setLoading(true);
    setLoadFailed(false);
    try {
      await store.loadOlder();
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="History">
      {days.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-16 text-center">
          <Timer className="size-7 text-white/25" strokeWidth={1.4} aria-hidden="true" />
          <p className="mt-4 font-serif text-xl text-white/80 italic">Nothing here yet</p>
          <p className="mt-1.5 max-w-60 text-sm leading-relaxed text-white/45">
            Finished sessions appear here. Name one, press Start, and End it when you are done.
          </p>
        </div>
      ) : (
        <div className="-mx-3 space-y-6">
          {days.map((day) => (
            <section key={day.start} aria-label={dayLabel(day.start, now)}>
              <div className="flex items-baseline justify-between px-3 pb-1.5">
                <h3 className="text-[11px] font-medium tracking-[0.18em] text-white/50 uppercase">
                  {dayLabel(day.start, now)}
                </h3>
                <span className="text-xs text-white/45 tabular-nums">{formatDuration(day.seconds)}</span>
              </div>
              <ul>
                <AnimatePresence initial={false}>
                  {day.sessions.map((session) => (
                    <Row key={session.id} session={session} flagPending={usesDatabase} />
                  ))}
                </AnimatePresence>
              </ul>
            </section>
          ))}

          {hasOlder && (
            <div className="flex flex-col items-center gap-2 px-3 pt-1">
              <button
                type="button"
                className="rounded-full border border-white/12 px-5 py-2 text-[13px] text-white/75 transition-colors hover:bg-white/8 hover:text-white disabled:opacity-50"
                disabled={loading}
                onClick={loadOlder}
              >
                {loading ? "Loading…" : "Show older sessions"}
              </button>
              {loadFailed && (
                <p role="alert" className="text-xs text-rose-300">
                  Couldn’t load older sessions. Try again in a moment.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
