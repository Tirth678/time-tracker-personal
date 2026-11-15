import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../../lib/client/settings";
import { memoryStorage, type KeyValueStorage } from "../../lib/client/storage";
import {
  createTrackerStore,
  PAGE_SIZE,
  selectHasOlder,
  selectHistory,
  selectRecentNames,
  selectTotals,
  selectUnsyncedCount,
  STORAGE_KEYS,
  type TrackerEvent,
  type TrackerStore,
} from "../../lib/client/tracker-store";
import type { StudySession } from "../../lib/types";
import { startLiveApi, type LiveApi } from "../helpers/live-api";
import { makeSession } from "../helpers/sessions";

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
/** 09:00 local time, so that "today" behaves the same in every time zone. */
const T0 = new Date(2026, 10, 15, 9, 0, 0).getTime();

let live: LiveApi;
let stores: TrackerStore[] = [];

beforeAll(async () => {
  live = await startLiveApi();
});

afterAll(async () => {
  await live.close();
});

beforeEach(async () => {
  await live.reset();
  // Only the clock is faked: network I/O and retry timers run for real.
  vi.useFakeTimers({ now: T0, toFake: ["Date"] });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  for (const store of stores) store.dispose();
  stores = [];
  // Let requests that are still in flight finish, so they cannot leak into the next test.
  await live.idle();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function open(storage: KeyValueStorage = memoryStorage()): TrackerStore {
  const store = createTrackerStore({ storage, api: live.api, retryDelaysMs: [20, 40] });
  stores.push(store);
  return store;
}

const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);
const totals = (store: TrackerStore) => selectTotals(store.getState(), Date.now());

/** Runs a complete session of the given length and returns what was stored. */
function study(store: TrackerStore, name: string, minutes: number): StudySession {
  store.setDraftName(name);
  store.start();
  advance(minutes * MIN);
  const session = store.end();
  if (!session) throw new Error("the session was discarded");
  return session;
}

async function serverSessions(): Promise<StudySession[]> {
  return (await live.store.list({ limit: 100 })).sessions;
}

describe("the timer", () => {
  it("runs a named session from start to end", () => {
    const store = open();
    store.setDraftName("  Organic chemistry ");
    store.start();

    expect(store.getState().timer).toMatchObject({
      name: "  Organic chemistry ",
      mode: "stopwatch",
      startedAt: T0,
      runningSince: T0,
    });
    expect(store.getState().draftName).toBe("");

    advance(10 * MIN);
    store.pause();
    advance(30 * MIN);
    store.resume();
    advance(5 * MIN);
    store.rename("Organic chemistry II");
    const session = store.end();

    expect(session).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: "Organic chemistry II",
      mode: "stopwatch",
      startedAt: new Date(T0).toISOString(),
      endedAt: new Date(T0 + 45 * MIN).toISOString(),
      durationSeconds: 15 * 60,
      pomodorosCompleted: 0,
    });
    expect(store.getState().timer).toBeNull();
    expect(totals(store)).toEqual({ totalSeconds: 900, todaySeconds: 900, sessionCount: 1 });
  });

  it("discards a session that is ended within a second", () => {
    const store = open();
    store.start();
    advance(400);
    expect(store.end()).toBeNull();
    expect(store.getState().timer).toBeNull();
    expect(store.getState().local).toEqual([]);
    expect(store.end()).toBeNull(); // nothing to end
  });

  it("keeps running across a reload, and while the page is closed", () => {
    const storage = memoryStorage();
    const before = open(storage);
    before.setDraftName("Thesis");
    before.start();
    advance(20 * MIN);
    before.dispose();

    advance(40 * MIN); // the tab is closed for 40 minutes
    const after = open(storage);
    expect(after.getState().timer).toMatchObject({ name: "Thesis", startedAt: T0 });
    expect(after.end()?.durationSeconds).toBe(60 * 60);
  });

  it("stays paused across a reload", () => {
    const storage = memoryStorage();
    const before = open(storage);
    before.start();
    advance(20 * MIN);
    before.pause();

    advance(3 * HOUR);
    const after = open(storage);
    expect(after.getState().timer?.runningSince).toBeNull();
    after.resume();
    advance(5 * MIN);
    const session = after.end();
    expect(session?.durationSeconds).toBe(25 * 60);
  });

  it("uses the mode and Pomodoro lengths from the settings", () => {
    const store = open();
    store.updateSettings({ mode: "pomodoro", pomodoro: { ...DEFAULT_SETTINGS.pomodoro, focusMinutes: 50 } });
    store.start();
    expect(store.getState().timer).toMatchObject({ mode: "pomodoro", phase: "focus", phaseDurationMs: 50 * MIN });
  });

  it("moves through Pomodoro phases and announces only the ones that ran out", () => {
    const store = open();
    const events: TrackerEvent[] = [];
    store.onEvent((event) => events.push(event));
    store.updateSettings({ mode: "pomodoro" });
    store.setDraftName("Deep work");
    store.start();

    advance(24 * MIN);
    store.tick();
    expect(store.getState().timer?.phase).toBe("focus");
    expect(events).toEqual([]);

    advance(1 * MIN);
    store.tick();
    expect(store.getState().timer).toMatchObject({ phase: "shortBreak", pomodorosCompleted: 1 });
    expect(events).toEqual([{ type: "phase-change", from: "focus", to: "shortBreak" }]);

    advance(2 * MIN);
    store.skipBreak(); // the user's own choice is not announced
    expect(store.getState().timer).toMatchObject({ phase: "focus", runningSince: Date.now() });
    expect(events).toHaveLength(1);

    advance(25 * MIN);
    store.tick();
    advance(5 * MIN);
    store.tick(); // the break ran out: back to focus, waiting for Start
    expect(store.getState().timer).toMatchObject({ phase: "focus", runningSince: null, pomodorosCompleted: 2 });
    expect(events.map((event) => `${event.from}>${event.to}`)).toEqual([
      "focus>shortBreak",
      "focus>shortBreak",
      "shortBreak>focus",
    ]);

    store.resume();
    advance(10 * MIN);
    expect(store.end()).toMatchObject({
      name: "Deep work",
      mode: "pomodoro",
      durationSeconds: 60 * 60,
      pomodorosCompleted: 2,
    });
  });

  it("catches up when a phase ended while the page was closed", () => {
    const storage = memoryStorage();
    const before = open(storage);
    before.updateSettings({ mode: "pomodoro" });
    before.start();
    before.dispose();

    advance(2 * HOUR);
    const after = open(storage);
    after.pause(); // any action first brings the phase up to date
    expect(after.getState().timer).toMatchObject({ phase: "shortBreak", pomodorosCompleted: 1 });
    expect(after.end()).toMatchObject({ durationSeconds: 25 * 60, pomodorosCompleted: 1 });
  });
});

describe("a stopwatch nobody is watching", () => {
  /** Simulates the page being open: the UI calls tick() a few times per second. */
  function watch(store: TrackerStore, minutes: number): void {
    for (let i = 0; i < minutes * 2; i += 1) {
      advance(30 * SEC);
      store.tick();
    }
  }

  it("is left alone while the page is open, however long the session", () => {
    const store = open();
    store.start();
    watch(store, 5 * 60);
    expect(store.getState().away).toBeNull();
    expect(store.end()?.durationSeconds).toBe(5 * 3600);
  });

  it("asks what to do with the time after the device slept through the night", () => {
    const store = open();
    store.setDraftName("Late revision");
    store.start();
    watch(store, 40);
    const leftAt = Date.now();

    advance(9 * HOUR); // lid closed, End forgotten
    store.tick();
    expect(store.getState().away).toEqual({ since: leftAt });
    watch(store, 2); // the question stays open while the user reads it
    expect(store.getState().away).toEqual({ since: leftAt });

    store.discardAwayTime();
    expect(store.getState().away).toBeNull();
    expect(store.getState().timer?.runningSince).toBeNull(); // the clock stopped when they left
    expect(store.end()).toMatchObject({
      name: "Late revision",
      durationSeconds: 40 * 60,
      endedAt: new Date(leftAt).toISOString(),
    });
  });

  it("keeps the time when the user says it counts", () => {
    const store = open();
    store.start();
    watch(store, 10);
    advance(2 * HOUR); // studying from a book, phone locked
    store.tick();
    expect(store.getState().away).not.toBeNull();

    store.keepAwayTime();
    watch(store, 20);
    expect(store.getState().away).toBeNull();
    expect(store.end()?.durationSeconds).toBe(2 * 3600 + 30 * 60);
  });

  it("asks again after a reload if the question was not answered", () => {
    const storage = memoryStorage();
    const before = open(storage);
    before.start();
    watch(before, 20);
    const leftAt = Date.now();
    before.dispose();

    advance(3 * HOUR);
    const first = open(storage);
    first.tick();
    expect(first.getState().away).toEqual({ since: leftAt });
    first.dispose();

    advance(10 * MIN);
    const second = open(storage);
    second.tick();
    expect(second.getState().away).toEqual({ since: leftAt });
  });

  it("does not ask about short absences, paused timers or Pomodoro rounds", () => {
    const store = open();
    store.start();
    watch(store, 5);
    advance(29 * MIN);
    store.tick();
    expect(store.getState().away).toBeNull();

    store.pause();
    advance(5 * HOUR);
    store.tick();
    store.resume();
    watch(store, 1);
    expect(store.getState().away).toBeNull();
    expect(store.end()?.durationSeconds).toBe(35 * 60);

    store.updateSettings({ mode: "pomodoro" });
    store.start();
    advance(5 * HOUR);
    store.tick();
    expect(store.getState().away).toBeNull();
  });

  it("treats ending or pausing as an answer", () => {
    const store = open();
    store.start();
    watch(store, 10);
    advance(HOUR);
    store.tick();
    expect(store.getState().away).not.toBeNull();
    store.pause();
    expect(store.getState().away).toBeNull();

    store.resume();
    advance(HOUR);
    store.tick();
    expect(store.getState().away).not.toBeNull();
    expect(store.end()?.durationSeconds).toBe(2 * 3600 + 10 * 60);
    expect(store.getState().away).toBeNull();
  });

  it("does not ask when another tab kept watching", () => {
    const storage = memoryStorage();
    const frozen = open(storage); // e.g. a background tab the browser put to sleep
    const active = open(storage);
    frozen.start();
    active.reload(STORAGE_KEYS.timer);

    watch(active, 90);
    frozen.reload(STORAGE_KEYS.timer);
    frozen.tick();
    expect(frozen.getState().away).toBeNull();
    expect(active.getState().away).toBeNull();
  });
});

describe("settings", () => {
  it("are remembered and validated", () => {
    const storage = memoryStorage();
    const store = open(storage);
    store.updateSettings({ dim: 5, volume: -1, muted: false });
    store.updateSettings({ background: { kind: "url", media: "video", url: "https://example.com/rain.mp4" } });

    const reopened = open(storage).getState().settings;
    expect(reopened).toMatchObject({
      dim: 0.8,
      volume: 0,
      muted: false,
      background: { kind: "url", media: "video", url: "https://example.com/rain.mp4" },
      mode: "stopwatch",
    });
  });

  it("fall back to defaults when the stored data is damaged", () => {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEYS.settings, '{"mode":"sprint","pomodoro":{"focusMinutes":"x","roundsBeforeLongBreak":99},"dim":null');
    storage.setItem(STORAGE_KEYS.timer, '{"id":7,"mode":"stopwatch"}');
    storage.setItem(STORAGE_KEYS.sessions, '{"local":[{"id":"a"},null,42],"remote":{"stats":"many"}}');
    expect(open(storage).getState()).toMatchObject({ settings: DEFAULT_SETTINGS, timer: null, local: [], remote: null });

    storage.setItem(STORAGE_KEYS.settings, '{"mode":"pomodoro","pomodoro":{"focusMinutes":900,"roundsBeforeLongBreak":0}}');
    expect(open(storage).getState().settings).toMatchObject({
      mode: "pomodoro",
      pomodoro: { focusMinutes: 180, roundsBeforeLongBreak: 1, shortBreakMinutes: 5 },
    });
  });
});

describe("data found in storage", () => {
  const stored = (overrides: Record<string, unknown> = {}) => ({
    ...makeSession({ name: "Stored", startedAt: new Date(T0 - HOUR).toISOString(), durationSeconds: 1800 }),
    endedAt: new Date(T0 - 30 * MIN).toISOString(),
    ...overrides,
  });

  it("cannot claim more time than passed between start and end", () => {
    const storage = memoryStorage();
    storage.setItem(
      STORAGE_KEYS.sessions,
      JSON.stringify({
        local: [
          stored(),
          stored({ id: "22222222-2222-4222-8222-222222222222", durationSeconds: 1e300, pomodorosCompleted: 1e300 }),
          stored({ id: "33333333-3333-4333-8333-333333333333", durationSeconds: 1799.9, pomodorosCompleted: 2.7 }),
          // Ends before it starts: nothing about it can be trusted.
          stored({ id: "44444444-4444-4444-8444-444444444444", endedAt: new Date(T0 - 2 * HOUR).toISOString() }),
        ],
        remote: null,
      }),
    );

    const store = open(storage);
    expect(store.getState().local.map((session) => [session.durationSeconds, session.pomodorosCompleted])).toEqual([
      [1800, 0],
      [1802, 100_000],
      [1799, 2],
    ]);
    expect(totals(store)).toEqual({ totalSeconds: 5401, todaySeconds: 5401, sessionCount: 3 });
  });

  it("drops a timer whose numbers make no sense", () => {
    const timer = {
      id: "55555555-5555-4555-8555-555555555555",
      name: "Stored",
      mode: "stopwatch",
      startedAt: T0 - HOUR,
      phase: "focus",
      phaseDurationMs: null,
      phaseElapsedMs: 0,
      runningSince: T0 - HOUR,
      lastActiveAt: T0,
      focusMs: 0,
      pomodorosCompleted: 0,
    };
    const load = (overrides: Record<string, unknown>) => {
      const storage = memoryStorage();
      storage.setItem(STORAGE_KEYS.timer, JSON.stringify({ ...timer, ...overrides }));
      storage.setItem(STORAGE_KEYS.seen, JSON.stringify(T0));
      return open(storage).getState().timer;
    };

    expect(load({})).toMatchObject({ name: "Stored", runningSince: T0 - HOUR });
    expect(load({ startedAt: 500_000_000_000, runningSince: 500_000_000_000 })).toBeNull(); // 1985
    expect(load({ startedAt: -5 })).toBeNull();
    expect(load({ runningSince: 1e300 })).toBeNull();
    expect(load({ phaseElapsedMs: 1e300 })).toBeNull();
    expect(load({ focusMs: -1 })).toBeNull();
    expect(load({ pomodorosCompleted: 1.5 })).toBeNull();
    expect(load({ pomodorosCompleted: 1e9 })).toBeNull();
    expect(load({ mode: "pomodoro", phaseDurationMs: 1e300 })).toBeNull();
    expect(load({ mode: "pomodoro", phaseDurationMs: 25 * MIN })).toMatchObject({ mode: "pomodoro" });
  });

  it("only accepts a web link as the background", () => {
    const load = (background: unknown) => {
      const storage = memoryStorage();
      storage.setItem(STORAGE_KEYS.settings, JSON.stringify({ background }));
      return open(storage).getState().settings.background;
    };

    expect(load({ kind: "url", media: "image", url: "https://example.com/desk.jpg" })).toEqual({
      kind: "url",
      media: "image",
      url: "https://example.com/desk.jpg",
    });
    for (const url of ["javascript:alert(1)", "data:text/html,<p>hi", "file:///etc/passwd", "", 5, null]) {
      expect(load({ kind: "url", media: "image", url })).toEqual(DEFAULT_SETTINGS.background);
    }
    expect(load({ kind: "url", media: "audio", url: "https://example.com/a.mp3" })).toEqual(DEFAULT_SETTINGS.background);
    expect(load({ kind: "upload", media: "video", name: "rain.mp4", stamp: null })).toEqual(DEFAULT_SETTINGS.background);
  });
});

describe("without a database", () => {
  beforeEach(() => live.setDatabase("not_configured"));

  it("keeps everything on the device and says so", async () => {
    const storage = memoryStorage();
    const store = open(storage);
    study(store, "Maths", 30);
    advance(5 * MIN);
    study(store, "Physics", 45);
    await store.sync();

    expect(store.getState().sync).toEqual({ status: "local" });
    expect(totals(store)).toEqual({ totalSeconds: 75 * 60, todaySeconds: 75 * 60, sessionCount: 2 });
    expect(selectUnsyncedCount(store.getState())).toBe(2);
    expect(selectHistory(store.getState()).map((s) => [s.name, s.pending])).toEqual([
      ["Physics", true],
      ["Maths", true],
    ]);
    expect(selectRecentNames(store.getState())).toEqual(["Physics", "Maths"]);
    expect(live.calls).not.toContain("saveSessions");

    // Everything is still there after a reload.
    expect(totals(open(storage))).toEqual({ totalSeconds: 75 * 60, todaySeconds: 75 * 60, sessionCount: 2 });
  });

  it("deletes a session without asking the server", async () => {
    const store = open();
    const session = study(store, "Maths", 30);
    await store.sync();
    live.calls.length = 0;

    await store.deleteSession(session.id);
    expect(totals(store).totalSeconds).toBe(0);
    expect(live.calls).toEqual([]);
  });

  it("uploads everything once a database is connected", async () => {
    const storage = memoryStorage();
    const store = open(storage);
    const first = study(store, "Maths", 30);
    const second = study(store, "Physics", 45);
    await store.sync();
    expect(await serverSessions()).toEqual([]);

    live.setDatabase("connected");
    await store.sync();

    expect(store.getState().sync).toEqual({ status: "synced" });
    expect(await serverSessions()).toEqual([second, first]);
    expect(selectUnsyncedCount(store.getState())).toBe(0);
    expect(totals(store)).toEqual({ totalSeconds: 75 * 60, todaySeconds: 75 * 60, sessionCount: 2 });
  });
});

describe("with a database", () => {
  it("saves a finished session and reads the totals back", async () => {
    await live.store.saveMany([makeSession({ name: "Last week", minutesAgo: 7 * 24 * 60, minutes: 120 })]);
    const store = open();
    await store.sync();
    expect(totals(store)).toEqual({ totalSeconds: 7200, todaySeconds: 0, sessionCount: 1 });

    const session = study(store, "Today", 50);
    await store.sync();

    const state = store.getState();
    expect(state.sync).toEqual({ status: "synced" });
    expect(state.local).toEqual([]);
    expect(state.remote?.stats).toEqual({ totalSeconds: 7200 + 3000, sessionCount: 2, todaySeconds: 3000 });
    expect(await serverSessions()).toContainEqual(session);
    expect(selectHistory(state).map((s) => [s.name, s.pending])).toEqual([
      ["Today", false],
      ["Last week", false],
    ]);
  });

  it("never shows a wrong total while syncing", async () => {
    const store = open();
    study(store, "One", 10);
    await store.sync();
    study(store, "Two", 20);

    const seen = new Set<number>();
    const unsubscribe = store.subscribe(() => seen.add(totals(store).totalSeconds));
    study(store, "Three", 30);
    seen.delete(30 * 60); // the moment before "Three" was added
    await store.sync();
    unsubscribe();

    // Every single intermediate state added up to the same total.
    expect([...seen]).toEqual([60 * 60]);
    expect(totals(store)).toEqual({ totalSeconds: 3600, todaySeconds: 3600, sessionCount: 3 });
  });

  it("uploads a session that is finished while a sync is already running", async () => {
    const store = open();
    study(store, "First", 10);
    await store.sync();

    const held = live.hold("stats");
    const syncing = store.sync();
    await held.reached;
    const second = study(store, "Second", 20); // lands in the middle of the download
    expect(totals(store).totalSeconds).toBe(30 * 60);
    held.release();
    await syncing; // includes the extra round that picks up "Second"

    expect((await serverSessions()).map((s) => s.id)).toContain(second.id);
    expect(store.getState().local).toEqual([]);
    expect(totals(store).totalSeconds).toBe(30 * 60);
  });

  it("uploads a long backlog in batches", async () => {
    const storage = memoryStorage();
    const backlog = Array.from({ length: 230 }, (_, i) => makeSession({ minutesAgo: 10_000 + i * 3, minutes: 2 }));
    storage.setItem(STORAGE_KEYS.sessions, JSON.stringify({ local: backlog, remote: null }));

    const store = open(storage);
    expect(totals(store).totalSeconds).toBe(230 * 120);
    await store.sync();

    expect(live.calls.filter((call) => call === "saveSessions")).toHaveLength(3);
    expect((await live.store.stats()).sessionCount).toBe(230);
    expect(store.getState().local).toEqual([]);
    expect(totals(store)).toMatchObject({ totalSeconds: 230 * 120, sessionCount: 230 });
  });

  it("is safe to upload the same session twice", async () => {
    const storage = memoryStorage();
    const store = open(storage);
    const session = study(store, "Once", 25);
    const savedCopy = storage.getItem(STORAGE_KEYS.sessions)!;
    await store.sync();

    // A second tab that still holds the unsaved copy uploads it again.
    const other = memoryStorage();
    other.setItem(STORAGE_KEYS.sessions, savedCopy);
    const duplicate = open(other);
    await duplicate.sync();

    expect(await serverSessions()).toEqual([session]);
    expect(totals(duplicate)).toEqual({ totalSeconds: 1500, todaySeconds: 1500, sessionCount: 1 });
  });

  it("keeps a session the server refuses, without sending it again and again", async () => {
    const storage = memoryStorage();
    const broken = { ...makeSession({ name: "Clock was wrong" }), startedAt: "1970-01-01T00:00:10.000Z" };
    storage.setItem(STORAGE_KEYS.sessions, JSON.stringify({ local: [broken], remote: null }));

    const store = open(storage);
    const good = study(store, "Fine", 10);
    await store.sync();

    expect((await serverSessions()).map((s) => s.id)).toEqual([good.id]);
    expect(store.getState().local).toEqual([{ ...broken, rejected: true }]);
    expect(store.getState().sync).toEqual({ status: "synced" });
    expect(totals(store).totalSeconds).toBe(600 + broken.durationSeconds);
    expect(selectHistory(store.getState()).find((s) => s.id === broken.id)).toMatchObject({
      pending: true,
      rejected: true,
    });

    live.calls.length = 0;
    await store.sync();
    expect(live.calls).not.toContain("saveSessions");

    // It is offered again on the next visit, and can always be deleted.
    const nextVisit = open(storage);
    await nextVisit.sync();
    expect(live.calls.filter((call) => call === "saveSessions")).toHaveLength(1);
    await nextVisit.deleteSession(broken.id);
    expect(nextVisit.getState().local).toEqual([]);
  });

  it("shows the cached totals immediately on the next visit, even offline", async () => {
    const storage = memoryStorage();
    const store = open(storage);
    study(store, "Cached", 40);
    await store.sync();

    live.setOnline(false);
    const offline = open(storage);
    expect(totals(offline)).toEqual({ totalSeconds: 2400, todaySeconds: 2400, sessionCount: 1 });
    expect(selectHistory(offline.getState()).map((s) => s.name)).toEqual(["Cached"]);

    study(offline, "Offline work", 15);
    await offline.sync();
    expect(offline.getState().sync).toEqual({ status: "error", reason: "offline" });
    expect(totals(offline)).toEqual({ totalSeconds: 3300, todaySeconds: 3300, sessionCount: 2 });
    expect(selectUnsyncedCount(offline.getState())).toBe(1);
  });

  it("retries by itself after the connection comes back", async () => {
    const store = open();
    live.setOnline(false);
    const session = study(store, "Train ride", 35);
    await store.sync();
    expect(store.getState().sync).toEqual({ status: "error", reason: "offline" });

    live.setOnline(true);
    await vi.waitFor(() => expect(store.getState().sync).toEqual({ status: "synced" }));
    expect(await serverSessions()).toEqual([session]);
    expect(store.getState().local).toEqual([]);
  });

  it("waits longer after every failure, and starts over when the connection is reported back", async () => {
    // Retries after 20 ms, then only after a minute.
    const store = createTrackerStore({ storage: memoryStorage(), api: live.api, retryDelaysMs: [20, 60_000] });
    stores.push(store);
    live.setOnline(false);
    const session = study(store, "Tunnel", 15);
    await store.sync();
    // Two attempts have failed (one for the finished session, one for the call
    // above), so the next one is a minute away.
    expect(live.calls).toHaveLength(2);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(live.calls).toHaveLength(2);
    expect(store.getState().sync).toEqual({ status: "error", reason: "offline" });

    // "Online", but the first request still fails, as it does when the network is not quite ready.
    await store.syncAfresh();
    expect(live.calls).toHaveLength(3);
    expect(store.getState().sync).toEqual({ status: "error", reason: "offline" });

    live.setOnline(true);
    await vi.waitFor(() => expect(store.getState().sync).toEqual({ status: "synced" }), { timeout: 2000 });
    expect(await serverSessions()).toEqual([session]);
  });

  it("keeps sessions safe while the database is down, then catches up", async () => {
    const store = open();
    live.setDatabase("down");
    const session = study(store, "During the outage", 20);
    await store.sync();
    expect(store.getState().sync).toEqual({ status: "error", reason: "unavailable" });
    expect(totals(store).totalSeconds).toBe(1200);

    live.setDatabase("connected");
    await vi.waitFor(() => expect(store.getState().sync).toEqual({ status: "synced" }));
    expect(await serverSessions()).toEqual([session]);
  });

  it("recovers when the database goes down between two syncs", async () => {
    const store = open();
    study(store, "Before", 10);
    await store.sync();

    live.setDatabase("down");
    study(store, "During", 10);
    await store.sync();
    expect(store.getState().sync).toEqual({ status: "error", reason: "unavailable" });
    expect(totals(store).totalSeconds).toBe(1200);

    live.setDatabase("connected");
    await vi.waitFor(() => expect(store.getState().local).toEqual([]));
    expect(totals(store)).toMatchObject({ totalSeconds: 1200, sessionCount: 2 });
  });

  it("does not lose or double-count a session when the answer to an upload never arrives", async () => {
    const store = open();
    // The server stores the session, but the connection drops before the client hears back.
    live.dropNextAnswer("saveSessions");

    const session = study(store, "Flaky wifi", 30); // ending a session starts a sync
    const seen: string[] = [];
    store.subscribe(() => seen.push(`${store.getState().sync.status}:${totals(store).totalSeconds}`));

    await vi.waitFor(() => expect(store.getState().sync).toEqual({ status: "synced" }));

    // It failed first, was retried, and showed 30 minutes the whole time.
    expect(seen).toContain("error:1800");
    expect(seen.every((entry) => entry.endsWith(":1800"))).toBe(true);
    expect(live.calls.filter((call) => call === "saveSessions")).toHaveLength(2);
    expect(await serverSessions()).toEqual([session]);
    expect(totals(store)).toEqual({ totalSeconds: 1800, todaySeconds: 1800, sessionCount: 1 });
  });

  it("starts a new 'today' after midnight", async () => {
    const storage = memoryStorage();
    const store = open(storage);
    study(store, "Evening", 60);
    await store.sync();
    expect(totals(store).todaySeconds).toBe(3600);

    vi.setSystemTime(new Date(2026, 10, 16, 0, 5, 0));
    expect(totals(store)).toEqual({ totalSeconds: 3600, todaySeconds: 0, sessionCount: 1 });

    live.calls.length = 0;
    store.syncIfStale();
    await vi.waitFor(() => expect(store.getState().sync).toEqual({ status: "synced" }));
    expect(live.calls).toContain("stats");
    expect(totals(store)).toEqual({ totalSeconds: 3600, todaySeconds: 0, sessionCount: 1 });
  });

  it("counts a session that crosses midnight on the day it started", async () => {
    const store = open();
    vi.setSystemTime(new Date(2026, 10, 15, 23, 30, 0));
    store.start();
    vi.setSystemTime(new Date(2026, 10, 16, 0, 30, 0));
    store.end();
    await store.sync();
    expect(totals(store)).toEqual({ totalSeconds: 3600, todaySeconds: 0, sessionCount: 1 });
  });

  it("only syncs on focus when the data is stale", async () => {
    const store = open();
    await store.sync();
    live.calls.length = 0;

    store.syncIfStale();
    advance(4 * MIN);
    store.syncIfStale();
    expect(live.calls).toEqual([]);

    advance(2 * MIN);
    store.syncIfStale();
    await vi.waitFor(() => expect(live.calls).toContain("stats"));
  });

  describe("deleting", () => {
    it("removes a saved session from the server and from the totals", async () => {
      const store = open();
      const keep = study(store, "Keep", 10);
      advance(MIN);
      const remove = study(store, "Remove", 30);
      await store.sync();

      await store.deleteSession(remove.id);
      expect(await serverSessions()).toEqual([keep]);
      expect(totals(store)).toEqual({ totalSeconds: 600, todaySeconds: 600, sessionCount: 1 });
      expect(selectHistory(store.getState()).map((s) => s.name)).toEqual(["Keep"]);

      await store.sync(); // the server agrees
      expect(totals(store)).toEqual({ totalSeconds: 600, todaySeconds: 600, sessionCount: 1 });
    });

    it("reports a failure and keeps the session", async () => {
      const store = open();
      const session = study(store, "Sticky", 10);
      await store.sync();

      live.setOnline(false);
      await expect(store.deleteSession(session.id)).rejects.toMatchObject({ code: "network_error" });
      expect(totals(store).totalSeconds).toBe(600);
      expect(selectHistory(store.getState())).toHaveLength(1);
    });

    it("treats a session that was already deleted elsewhere as deleted", async () => {
      const store = open();
      const session = study(store, "Gone", 10);
      await store.sync();
      await live.store.remove(session.id);

      await store.deleteSession(session.id);
      expect(totals(store)).toEqual({ totalSeconds: 0, todaySeconds: 0, sessionCount: 0 });
    });

    it("waits for a running upload, so a deleted session cannot come back", async () => {
      const store = open();
      await store.sync();
      const held = live.hold("saveSessions");
      const session = study(store, "Oops", 10); // starts uploading right away
      const deleting = store.deleteSession(session.id);
      await held.reached; // the server has stored it; the client does not know yet
      held.release();
      await deleting;
      await store.sync();

      expect(await serverSessions()).toEqual([]);
      expect(totals(store).totalSeconds).toBe(0);
    });
  });

  describe("history", () => {
    it("loads older sessions page by page", async () => {
      const all = Array.from({ length: 70 }, (_, i) => makeSession({ name: `#${i}`, minutesAgo: 100 + i * 10, minutes: 5 }));
      await live.store.saveMany(all);
      const store = open();
      await store.sync();

      expect(selectHistory(store.getState())).toHaveLength(PAGE_SIZE);
      expect(selectHasOlder(store.getState())).toBe(true);
      expect(totals(store)).toMatchObject({ totalSeconds: 70 * 300, sessionCount: 70 });

      await store.loadOlder();
      expect(selectHistory(store.getState())).toHaveLength(60);
      await Promise.all([store.loadOlder(), store.loadOlder()]); // a double click loads one page
      expect(selectHasOlder(store.getState())).toBe(false);
      await store.loadOlder();

      expect(selectHistory(store.getState()).map((s) => s.name)).toEqual(all.map((s) => s.name));
    });

    it("keeps the loaded pages when a sync changes nothing, and resets them when it does", async () => {
      await live.store.saveMany(Array.from({ length: 40 }, (_, i) => makeSession({ minutesAgo: 100 + i * 10, minutes: 5 })));
      const store = open();
      await store.sync();
      await store.loadOlder();
      expect(selectHistory(store.getState())).toHaveLength(40);

      await store.sync();
      expect(selectHistory(store.getState())).toHaveLength(40);

      study(store, "Newest", 5);
      await store.sync();
      expect(selectHistory(store.getState())).toHaveLength(PAGE_SIZE);
      expect(selectHasOlder(store.getState())).toBe(true);
      expect(totals(store).sessionCount).toBe(41);
    });

    it("can delete a session from an older page", async () => {
      const all = Array.from({ length: 35 }, (_, i) => makeSession({ minutesAgo: 100 + i * 10, minutes: 5 }));
      await live.store.saveMany(all);
      const store = open();
      await store.sync();
      await store.loadOlder();

      await store.deleteSession(all[34].id);
      expect(selectHistory(store.getState())).toHaveLength(34);
      expect(totals(store)).toMatchObject({ totalSeconds: 34 * 300, sessionCount: 34 });
    });
  });

  describe("two tabs", () => {
    /** Delivers storage changes to the other tab, like the browser's `storage` event. */
    function link(storage: KeyValueStorage, tabs: TrackerStore[]): { storageFor(tab: number): KeyValueStorage } {
      return {
        storageFor: (tab) => ({
          getItem: (key) => storage.getItem(key),
          setItem(key, value) {
            storage.setItem(key, value);
            tabs.forEach((other, index) => index !== tab && other.reload(key));
          },
          removeItem(key) {
            storage.removeItem(key);
            tabs.forEach((other, index) => index !== tab && other.reload(key));
          },
        }),
      };
    }

    function openTwo(): [TrackerStore, TrackerStore] {
      const tabs: TrackerStore[] = [];
      const shared = link(memoryStorage(), tabs);
      tabs.push(open(shared.storageFor(0)), open(shared.storageFor(1)));
      return [tabs[0], tabs[1]];
    }

    it("share one timer", () => {
      const [a, b] = openTwo();
      a.setDraftName("Shared");
      a.start();
      expect(b.getState().timer).toMatchObject({ name: "Shared" });

      b.setDraftName("Another");
      b.start(); // there is already a session: nothing new starts
      expect(b.getState().timer?.name).toBe("Shared");

      advance(10 * MIN);
      b.pause();
      expect(a.getState().timer?.runningSince).toBeNull();

      const session = b.end();
      expect(session).toMatchObject({ name: "Shared", durationSeconds: 600 });
      expect(a.getState().timer).toBeNull();
      expect(totals(a).totalSeconds).toBe(600);
      expect(a.end()).toBeNull(); // it cannot be ended twice
    });

    it("announce a finished phase only once", () => {
      const [a, b] = openTwo();
      const events: string[] = [];
      a.onEvent(() => events.push("a"));
      b.onEvent(() => events.push("b"));
      a.updateSettings({ mode: "pomodoro" });
      a.start();

      advance(25 * MIN);
      a.tick();
      b.tick();
      expect(events).toEqual(["a"]);
      expect(b.getState().timer?.phase).toBe("shortBreak");
    });

    it("never overwrite each other's sessions, even without hearing from one another", async () => {
      // No storage events at all: the worst case, e.g. a tab that was frozen in the background.
      const storage = memoryStorage();
      live.setOnline(false); // and nothing can be uploaded yet
      const a = open(storage);
      const b = open(storage);

      const fromA = study(a, "From A", 10);
      const fromB = study(b, "From B", 20); // b has never heard of "From A"

      // Both sessions are on the device: a reload finds them.
      const reloaded = open(storage);
      expect(selectHistory(reloaded.getState()).map((s) => s.name)).toEqual(["From B", "From A"]);
      expect(totals(reloaded).totalSeconds).toBe(1800);

      live.setOnline(true);
      await Promise.all([a.sync(), b.sync()]);
      await a.sync();

      expect((await serverSessions()).map((s) => s.id).sort()).toEqual([fromA.id, fromB.id].sort());
      a.reload(STORAGE_KEYS.sessions);
      b.reload(STORAGE_KEYS.sessions);
      for (const tab of [a, b]) {
        expect(totals(tab)).toEqual({ totalSeconds: 1800, todaySeconds: 1800, sessionCount: 2 });
        expect(tab.getState().local).toEqual([]);
      }
    });

    it("keep the newer of two snapshots when their answers arrive out of order", async () => {
      const [a, b] = openTwo();
      await a.sync();
      await b.sync();

      // Tab A asks for the totals, but the answer is slow to arrive.
      const held = live.hold("stats");
      const slow = a.sync();
      await held.reached;

      // Meanwhile tab B finishes a session and syncs completely.
      advance(SEC);
      const session = study(b, "Quick one", 10);
      await b.sync();
      expect(totals(a).totalSeconds).toBe(600);

      // A's answer is from before that session existed. It must not replace B's.
      held.release();
      await slow;

      expect(await serverSessions()).toEqual([session]);
      for (const tab of [a, b]) {
        expect(totals(tab)).toEqual({ totalSeconds: 600, todaySeconds: 600, sessionCount: 1 });
        expect(selectHistory(tab.getState()).map((s) => s.name)).toEqual(["Quick one"]);
      }
    });
  });
});

describe("when the browser cannot store data", () => {
  function fullStorage(): KeyValueStorage {
    return {
      getItem: () => null,
      setItem() {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      },
      removeItem: () => {},
    };
  }

  it("keeps working in memory and flags the problem", async () => {
    const store = open(fullStorage());
    expect(store.getState().storageOk).toBe(true);

    store.setDraftName("Unsaved");
    store.start();
    expect(store.getState().storageOk).toBe(false);
    advance(10 * MIN);
    store.pause();
    expect(store.getState().timer).toMatchObject({ name: "Unsaved", runningSince: null });
    store.resume();
    advance(5 * MIN);
    const session = store.end();
    expect(session?.durationSeconds).toBe(900);
    expect(totals(store).totalSeconds).toBe(900);

    // With a database the session is safe regardless of the browser's storage.
    await store.sync();
    expect(await serverSessions()).toEqual([session]);
    expect(totals(store)).toEqual({ totalSeconds: 900, todaySeconds: 900, sessionCount: 1 });
  });
});
