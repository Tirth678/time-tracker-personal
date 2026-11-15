"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

import { clock } from "@/lib/client/clock";
import type { TrackerState, TrackerStore } from "@/lib/client/tracker-store";

const StoreContext = createContext<TrackerStore | null>(null);

export const TrackerProvider = StoreContext.Provider;

export function useStore(): TrackerStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used inside <TrackerProvider>.");
  return store;
}

/**
 * Reads a slice of the tracker's state and re-renders only when it changes.
 * `select` must return a primitive or an object taken from the state itself.
 */
export function useTracker<T>(select: (state: TrackerState) => T): T {
  const store = useStore();
  const getSnapshot = () => select(store.getState());
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/**
 * The current time. `live` components update several times a second (a running
 * timer); the others only often enough to notice that a new day has begun.
 */
export function useNow(live: boolean): number {
  const subscribe = live ? clock.subscribeFast : clock.subscribeSlow;
  const getSnapshot = live ? clock.getNow : clock.getMinute;
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
