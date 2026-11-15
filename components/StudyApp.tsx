"use client";

import {
  CloudCheck,
  CloudOff,
  HardDrive,
  History,
  LoaderCircle,
  SlidersHorizontal,
  TriangleAlert,
  Volume2,
  VolumeX,
} from "lucide-react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { use, useCallback, useEffect, useState } from "react";
import { browser } from "react-dom";

import { createApi } from "@/lib/client/api";
import { playChime, prepareChime } from "@/lib/client/chime";
import { clock } from "@/lib/client/clock";
import { browserStorage } from "@/lib/client/storage";
import { createTrackerStore, selectUnsyncedCount } from "@/lib/client/tracker-store";
import { clampName, isRunning, phaseElapsedMs, phaseRemainingMs } from "@/lib/timer/engine";
import { formatClock, formatDuration, timeOfDay } from "@/lib/timer/format";
import { TIMER_MODES } from "@/lib/types";

import { Background } from "./Background";
import { Brand } from "./Brand";
import { Controls, primaryActionFor, type PrimaryAction } from "./Controls";
import { HistorySheet } from "./HistorySheet";
import { SessionName } from "./SessionName";
import { SettingsSheet } from "./SettingsSheet";
import { StatsDock } from "./StatsDock";
import { TimerFace } from "./TimerFace";
import { TrackerProvider, useNow, useStore, useTracker } from "./tracker";
import { easeOut, IconButton, Segmented, softSpring } from "./ui";

const APP_TITLE = "Study Tracker";
const MODE_LABELS = { stopwatch: "Stopwatch", pomodoro: "Pomodoro" } as const;
const MODE_OPTIONS = TIMER_MODES.map((value) => ({ value, label: MODE_LABELS[value] }));

/** Shows the running time in the browser tab, where it is visible from other tabs. */
function TabTitle() {
  const timer = useTracker((state) => state.timer);
  const now = useNow(timer !== null && isRunning(timer));

  let title = APP_TITLE;
  if (timer) {
    const reading =
      timer.mode === "stopwatch"
        ? formatClock(phaseElapsedMs(timer, now))
        : formatClock(phaseRemainingMs(timer, now) ?? 0, "up");
    let what = clampName(timer.name) || "Focus";
    if (timer.phase !== "focus") what = "Break";
    else if (!isRunning(timer)) what = timer.phaseElapsedMs === 0 ? "Ready" : "Paused";
    title = `${reading} · ${what}`;
  }

  useEffect(() => {
    document.title = title;
  }, [title]);
  useEffect(() => () => void (document.title = APP_TITLE), []);

  return null;
}

/** Where the sessions are stored right now. Opens the settings for details. */
function SyncBadge({ onClick }: { onClick: () => void }) {
  const sync = useTracker((state) => state.sync);
  const local = useTracker((state) => state.local);
  const storageOk = useTracker((state) => state.storageOk);
  const waiting = selectUnsyncedCount({ local });

  let icon = <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />;
  let text = "Syncing";
  let warn = false;

  if (!storageOk) {
    icon = <TriangleAlert className="size-3.5" aria-hidden="true" />;
    text = "Not being saved";
    warn = true;
  } else if (sync.status === "idle") {
    return null;
  } else if (sync.status === "local") {
    icon = <HardDrive className="size-3.5" strokeWidth={1.7} aria-hidden="true" />;
    text = "On this device";
  } else if (sync.status === "synced") {
    icon = <CloudCheck className="size-3.5" strokeWidth={1.7} aria-hidden="true" />;
    text = "Synced";
  } else if (sync.status === "error") {
    icon = <CloudOff className="size-3.5" strokeWidth={1.7} aria-hidden="true" />;
    text = waiting > 0 ? `${waiting} to sync` : sync.reason === "offline" ? "Offline" : "Can’t sync";
    warn = true;
  }

  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6 }}
      title="Where your sessions are stored"
      className={`mr-1 inline-flex h-8 items-center gap-2 rounded-full px-3 text-xs transition-colors duration-200 hover:bg-white/10 ${
        warn ? "text-amber-200/90 hover:text-amber-100" : "text-white/55 hover:text-white"
      }`}
    >
      {icon}
      <span className="max-sm:sr-only">{text}</span>
    </motion.button>
  );
}

/**
 * Shown in place of the buttons when the stopwatch ran for a long time with
 * nobody watching — the usual sign that End was forgotten. The user decides
 * whether that time counts.
 */
function AwayPrompt() {
  const store = useStore();
  const away = useTracker((state) => state.away);
  const now = useNow(away !== null);

  return (
    <AnimatePresence mode="popLayout">
      {away && (
        <motion.div
          role="group"
          aria-label="The timer kept running while you were away"
          className="glass w-[23rem] max-w-full rounded-3xl p-4 text-center"
          initial={{ opacity: 0, y: 10, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={softSpring}
        >
          <p className="text-sm leading-relaxed text-white/90" role="status">
            The timer kept running while you were away —{" "}
            <span className="whitespace-nowrap tabular-nums">{formatDuration(Math.max(0, now - away.since) / 1000)}</span>{" "}
            since {timeOfDay(away.since)}.
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2 text-[13px] font-medium whitespace-nowrap">
            <button
              type="button"
              className="rounded-full bg-white px-4 py-2 text-ink transition-colors hover:bg-white/90"
              onClick={() => store.discardAwayTime()}
            >
              Stop it at {timeOfDay(away.since)}
            </button>
            <button
              type="button"
              className="rounded-full border border-white/15 px-4 py-2 text-white/85 transition-colors hover:bg-white/10"
              onClick={() => store.keepAwayTime()}
            >
              Keep the time
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface Notice {
  id: number;
  text: string;
}

function NoticeToast({ notice, onDone }: { notice: Notice | null; onDone: () => void }) {
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(onDone, 4500);
    return () => clearTimeout(timeout);
  }, [notice, onDone]);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-3 z-30 flex justify-center px-4 max-sm:top-[4.25rem]"
      role="status"
      aria-live="polite"
    >
      <AnimatePresence mode="popLayout">
        {notice && (
          <motion.p
            key={notice.id}
            className="glass max-w-full truncate rounded-full px-5 py-2.5 text-[13px] text-white/90"
            initial={{ opacity: 0, y: -14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={softSpring}
          >
            {notice.text}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

const KEY_HINTS: Record<PrimaryAction, string | null> = {
  start: "to start",
  pause: "to pause",
  resume: "to resume",
  "skip-break": null,
};

function Shell() {
  const store = useStore();
  const timer = useTracker((state) => state.timer);
  const awayPending = useTracker((state) => state.away !== null);
  const mode = useTracker((state) => state.settings.mode);
  const muted = useTracker((state) => state.settings.muted);
  const videoBackground = useTracker(
    (state) => state.settings.background.kind !== "preset" && state.settings.background.media === "video",
  );

  const [panel, setPanel] = useState<"history" | "settings" | null>(null);
  const [backgroundFailed, setBackgroundFailed] = useState(false);
  const [backgroundAttempt, setBackgroundAttempt] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  // The page makes a short entrance; afterwards everything responds at once.
  const [entering, setEntering] = useState(true);

  const active = timer !== null;
  const ticking = timer !== null && isRunning(timer);
  const action = primaryActionFor(timer);
  const closePanel = useCallback(() => setPanel(null), []);
  const clearNotice = useCallback(() => setNotice(null), []);
  const notify = useCallback((text: string) => setNotice({ id: Date.now(), text }), []);

  useEffect(() => {
    const timeout = setTimeout(() => setEntering(false), 1500);
    return () => clearTimeout(timeout);
  }, []);

  // Keep the data in step with the server and with other tabs.
  useEffect(() => {
    void store.sync();

    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith("study-tracker:")) store.reload(event.key);
    };
    // "Online" can come a moment before the connection really works; if this
    // attempt fails, the next ones follow quickly instead of after a long wait.
    const onOnline = () => void store.syncAfresh();
    const onReturn = () => {
      if (document.hidden) return;
      store.tick();
      store.syncIfStale();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [store]);

  // While the timer runs, let it notice the end of a Pomodoro phase.
  useEffect(() => {
    if (!ticking) return;
    store.tick();
    return clock.subscribeFast(() => store.tick(clock.getNow()));
  }, [store, ticking]);

  useEffect(
    () =>
      store.onEvent((event) => {
        if (store.getState().settings.chime) playChime(event.to === "focus" ? "focus" : "rest");
        notify(
          event.to === "focus"
            ? "Break’s over — ready for the next round."
            : event.to === "longBreak"
              ? "Round complete. Time for a long break."
              : "Round complete. Time for a short break.",
        );
      }),
    [store, notify],
  );

  const runPrimary = useCallback(
    (next: PrimaryAction) => {
      // Sound is only allowed once the user has interacted: this is that moment.
      prepareChime();
      clock.touch();
      if (next === "start") store.start();
      else if (next === "pause") store.pause();
      else if (next === "resume") store.resume();
      else store.skipBreak();
    },
    [store],
  );

  const end = useCallback(() => {
    const session = store.end();
    notify(
      session
        ? `Saved · ${session.name} · ${formatDuration(session.durationSeconds)}`
        : "Less than a second — nothing to save.",
    );
  }, [store, notify]);

  // Space starts, pauses and resumes, unless the key is needed where the focus is.
  useEffect(() => {
    if (panel !== null) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest("input, textarea, select, button, a, [role='switch'], [role='radio']"))
      ) {
        return;
      }
      const next = primaryActionFor(store.getState().timer);
      // Skipping a break by accident is too easy, and an open question deserves a deliberate answer.
      if (next === "skip-break" || store.getState().away) return;
      event.preventDefault();
      runPrimary(next);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [panel, store, runPrimary]);

  const rise = (order: number) => ({
    initial: { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.9, ease: easeOut, delay: entering ? 0.1 + order * 0.09 : 0 },
  });

  return (
    <>
      <TabTitle />
      <Background attempt={backgroundAttempt} onProblem={setBackgroundFailed} />

      <div inert={panel !== null} className="relative z-10 flex min-h-dvh flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between pr-3 pl-5 compact:h-12 sm:pr-6 sm:pl-8">
          <Brand />
          <motion.div
            className="flex items-center gap-0.5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.3 }}
          >
            <SyncBadge onClick={() => setPanel("settings")} />
            {videoBackground && (
              <IconButton
                label={muted ? "Turn video sound on" : "Mute video"}
                aria-pressed={!muted}
                onClick={() => store.updateSettings({ muted: !muted })}
              >
                {muted ? (
                  <VolumeX className="size-[18px]" strokeWidth={1.7} aria-hidden="true" />
                ) : (
                  <Volume2 className="size-[18px]" strokeWidth={1.7} aria-hidden="true" />
                )}
              </IconButton>
            )}
            <IconButton label="History" aria-haspopup="dialog" onClick={() => setPanel("history")}>
              <History className="size-[18px]" strokeWidth={1.7} aria-hidden="true" />
            </IconButton>
            <IconButton label="Settings" aria-haspopup="dialog" onClick={() => setPanel("settings")}>
              <SlidersHorizontal className="size-[18px]" strokeWidth={1.7} aria-hidden="true" />
            </IconButton>
          </motion.div>
        </header>

        {/*
          One column, with the ring in the middle. On wide but low screens (`short:`)
          a grid instead: the ring on the left, everything else beside it.
        */}
        <main
          className={[
            "flex flex-1 flex-col items-center justify-center gap-[clamp(0.9rem,2.6dvh,1.75rem)] px-4 py-3",
            "compact:gap-[clamp(0.5rem,2dvh,0.9rem)] compact:py-1",
            "short:mx-auto short:grid short:w-full short:max-w-4xl short:grid-cols-2 short:grid-rows-[1fr_auto_auto_auto_1fr]",
            "short:justify-items-center short:gap-x-6 short:gap-y-3",
          ].join(" ")}
        >
          {/* The mode is fixed once a session has begun, so the switch steps aside. */}
          <Segmented
            className="short:col-start-2 short:row-start-2"
            label="Timer mode"
            value={mode}
            options={MODE_OPTIONS}
            onChange={(next) => store.updateSettings({ mode: next })}
            inert={active}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: active ? 0 : 1, y: 0 }}
            transition={{ duration: active || !entering ? 0.4 : 0.9, ease: easeOut, delay: entering ? 0.1 : 0 }}
          />

          <motion.div className="flex w-full justify-center short:col-start-2 short:row-start-3" {...rise(1)}>
            <SessionName onSubmit={() => runPrimary("start")} />
          </motion.div>

          <motion.div
            className="short:col-start-1 short:row-span-full short:row-start-1 short:self-center"
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1.1, ease: easeOut, delay: 0.25 }}
          >
            <TimerFace />
          </motion.div>

          <div className="flex w-full flex-col items-center gap-3 short:col-start-2 short:row-start-4">
            <AwayPrompt />
            {!awayPending && (
              <>
                <Controls onPrimary={runPrimary} onEnd={end} delay={entering ? 0.45 : 0} />
                <p
                  className={`hidden h-4 text-xs text-white/35 transition-opacity duration-500 [@media(hover:hover)_and_(pointer:fine)]:block ${
                    KEY_HINTS[action] && !entering ? "opacity-100" : "opacity-0"
                  }`}
                  aria-hidden="true"
                >
                  <kbd className="mr-1.5 rounded-md border border-white/15 px-1.5 py-0.5 font-sans text-[10px] tracking-wide text-white/50">
                    Space
                  </kbd>
                  {KEY_HINTS[action]}
                </p>
              </>
            )}
          </div>
        </main>

        <footer className="flex shrink-0 justify-center px-3 pt-1 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-7 compact:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <StatsDock delay={0.55} />
        </footer>
      </div>

      <NoticeToast notice={notice} onDone={clearNotice} />
      <HistorySheet open={panel === "history"} onClose={closePanel} />
      <SettingsSheet
        open={panel === "settings"}
        onClose={closePanel}
        backgroundFailed={backgroundFailed}
        onRetryBackground={() => setBackgroundAttempt((attempt) => attempt + 1)}
      />
    </>
  );
}

/**
 * The whole app. It renders in the browser only: the timer, the settings and
 * the cached totals all live in this browser's storage, so the server has
 * nothing meaningful to render in its place.
 */
export default function StudyApp() {
  use(browser("The timer, the settings and the cached totals live in this browser's storage."));

  const [store] = useState(() => createTrackerStore({ storage: browserStorage(), api: createApi() }));

  return (
    <TrackerProvider value={store}>
      {/* Respect the system's "reduce motion" setting: movement stops, fades remain. */}
      <MotionConfig reducedMotion="user">
        <Shell />
      </MotionConfig>
    </TrackerProvider>
  );
}
