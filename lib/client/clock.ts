/**
 * One shared clock for everything on screen that depends on the current time.
 *
 * Components read it with `useSyncExternalStore`, so they all show the same
 * instant and none of them calls `Date.now()` while rendering.
 */

type Listener = () => void;

const FAST_MS = 200;
const SLOW_MS = 30_000;

// Module scope also runs while the server prerenders the page, where the time is never shown.
let now = typeof window === "undefined" ? 0 : Date.now();
const fastListeners = new Set<Listener>();
const slowListeners = new Set<Listener>();
let stopTicker: (() => void) | null = null;
let tickerInterval = 0;

function tick(): void {
  now = Date.now();
  for (const listener of [...fastListeners, ...slowListeners]) listener();
}

/**
 * Ticks from a worker where possible. Browsers slow the timers of background
 * tabs down to as little as one per minute, but not those of workers — and a
 * Pomodoro round should end on time even when the tab is not in front.
 */
function startTicker(intervalMs: number): () => void {
  let fallback: ReturnType<typeof setInterval> | null = null;
  let worker: Worker | null = null;
  let workerUrl: string | null = null;

  const fallBackToInterval = () => {
    worker?.terminate();
    worker = null;
    fallback ??= setInterval(tick, intervalMs);
  };

  try {
    workerUrl = URL.createObjectURL(
      new Blob([`setInterval(() => postMessage(0), ${intervalMs});`], { type: "text/javascript" }),
    );
    worker = new Worker(workerUrl);
    worker.onmessage = tick;
    worker.onerror = fallBackToInterval; // e.g. blocked by a content security policy
  } catch {
    fallBackToInterval();
  }

  return () => {
    worker?.terminate();
    if (workerUrl) URL.revokeObjectURL(workerUrl);
    if (fallback !== null) clearInterval(fallback);
  };
}

function refresh(): void {
  if (!document.hidden) tick();
}

/** Runs the ticker at the rate the current subscribers need, or not at all. */
function reconcile(): void {
  const wanted = fastListeners.size > 0 ? FAST_MS : slowListeners.size > 0 ? SLOW_MS : 0;
  if (wanted === tickerInterval) return;

  stopTicker?.();
  stopTicker = null;
  tickerInterval = wanted;

  if (wanted === 0) {
    document.removeEventListener("visibilitychange", refresh);
    window.removeEventListener("focus", refresh);
    return;
  }
  stopTicker = startTicker(wanted);
  // Catch up immediately when the tab comes back, rather than at the next tick.
  document.addEventListener("visibilitychange", refresh);
  window.addEventListener("focus", refresh);
}

function subscribeTo(listeners: Set<Listener>) {
  return (listener: Listener): (() => void) => {
    listeners.add(listener);
    reconcile();
    return () => {
      listeners.delete(listener);
      reconcile();
    };
  };
}

export const clock = {
  /** Updates several times a second: for a running timer. */
  subscribeFast: subscribeTo(fastListeners),
  /** Updates twice a minute: enough to notice that a new day has begun. */
  subscribeSlow: subscribeTo(slowListeners),
  /** The time of the latest tick. */
  getNow: (): number => now,
  /** The same, rounded down to the minute: a snapshot that rarely changes. */
  getMinute: (): number => now - (now % 60_000),
  /** Brings the clock up to date right now, e.g. just before acting on a click. */
  touch: tick,
};
