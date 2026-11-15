import { DEFAULT_POMODORO, type PomodoroSettings } from "../timer/engine";
import { TIMER_MODES, type TimerMode } from "../types";
import { normalizeMediaUrl } from "./media-probe";

/** The built-in animated backdrops, in the order the settings panel shows them. */
export const PRESETS = [
  { id: "aurora", label: "Aurora", base: "#060a14", colors: ["#1d4ed8", "#0d9488", "#7c3aed"] },
  { id: "dusk", label: "Dusk", base: "#120910", colors: ["#be185d", "#ea580c", "#5b21b6"] },
  { id: "forest", label: "Forest", base: "#050f0b", colors: ["#047857", "#4d7c0f", "#0f766e"] },
  { id: "ocean", label: "Ocean", base: "#030d19", colors: ["#0369a1", "#0e7490", "#1e3a8a"] },
  { id: "mono", label: "Mono", base: "#09090b", colors: ["#3f3f46", "#27272a", "#52525b"] },
] as const;

export type PresetId = (typeof PRESETS)[number]["id"];
export type MediaKind = "image" | "video";

export type Background =
  | { kind: "preset"; preset: PresetId }
  /** An image or video loaded straight from a link. */
  | { kind: "url"; media: MediaKind; url: string }
  /** A file kept in this browser (IndexedDB). `stamp` changes with every upload. */
  | { kind: "upload"; media: MediaKind; name: string; stamp: number };

export interface Settings {
  mode: TimerMode;
  pomodoro: PomodoroSettings;
  /** Play a short sound when a Pomodoro phase ends. */
  chime: boolean;
  background: Background;
  /** How much a custom image or video is darkened, 0 – 0.8. */
  dim: number;
  /** Whether a background video's sound is off. */
  muted: boolean;
  /** Volume of a background video, 0 – 1. */
  volume: number;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: "stopwatch",
  pomodoro: DEFAULT_POMODORO,
  chime: true,
  background: { kind: "preset", preset: "aurora" },
  dim: 0.35,
  muted: true,
  volume: 0.6,
};

/** Allowed ranges for the Pomodoro numbers, shared by the settings UI. */
export const POMODORO_LIMITS = {
  focusMinutes: { min: 1, max: 180 },
  shortBreakMinutes: { min: 1, max: 60 },
  longBreakMinutes: { min: 1, max: 120 },
  roundsBeforeLongBreak: { min: 1, max: 12 },
} as const;

export const MAX_DIM = 0.8;

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function number(value: unknown, fallback: number, min: number, max: number, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const clamped = Math.min(max, Math.max(min, value));
  return integer ? Math.round(clamped) : clamped;
}

const boolean = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);

const mediaKind = (value: unknown): MediaKind | null => (value === "image" || value === "video" ? value : null);

function background(value: unknown): Background {
  if (isRecord(value)) {
    const media = mediaKind(value.media);
    if (value.kind === "preset" && PRESETS.some((preset) => preset.id === value.preset)) {
      return { kind: "preset", preset: value.preset as PresetId };
    }
    // Only http(s) links are ever put into the page, whatever storage says.
    const url = value.kind === "url" && media && typeof value.url === "string" ? normalizeMediaUrl(value.url) : null;
    if (url && media) return { kind: "url", media, url };
    if (value.kind === "upload" && media && typeof value.stamp === "number" && Number.isFinite(value.stamp)) {
      return { kind: "upload", media, name: typeof value.name === "string" ? value.name : "", stamp: value.stamp };
    }
  }
  return DEFAULT_SETTINGS.background;
}

/**
 * Turns whatever was found in storage into valid settings. Stored data can be
 * missing, written by an older version or edited by hand, so every field is
 * checked and falls back to its default.
 */
export function sanitizeSettings(value: unknown): Settings {
  const input = isRecord(value) ? value : {};
  const pomodoro = isRecord(input.pomodoro) ? input.pomodoro : {};
  const limits = POMODORO_LIMITS;
  const defaults = DEFAULT_SETTINGS;

  return {
    mode: TIMER_MODES.includes(input.mode as TimerMode) ? (input.mode as TimerMode) : defaults.mode,
    pomodoro: {
      focusMinutes: number(
        pomodoro.focusMinutes,
        defaults.pomodoro.focusMinutes,
        limits.focusMinutes.min,
        limits.focusMinutes.max,
        true,
      ),
      shortBreakMinutes: number(
        pomodoro.shortBreakMinutes,
        defaults.pomodoro.shortBreakMinutes,
        limits.shortBreakMinutes.min,
        limits.shortBreakMinutes.max,
        true,
      ),
      longBreakMinutes: number(
        pomodoro.longBreakMinutes,
        defaults.pomodoro.longBreakMinutes,
        limits.longBreakMinutes.min,
        limits.longBreakMinutes.max,
        true,
      ),
      roundsBeforeLongBreak: number(
        pomodoro.roundsBeforeLongBreak,
        defaults.pomodoro.roundsBeforeLongBreak,
        limits.roundsBeforeLongBreak.min,
        limits.roundsBeforeLongBreak.max,
        true,
      ),
      autoStartFocus: boolean(pomodoro.autoStartFocus, defaults.pomodoro.autoStartFocus),
    },
    chime: boolean(input.chime, defaults.chime),
    background: background(input.background),
    dim: number(input.dim, defaults.dim, 0, MAX_DIM),
    muted: boolean(input.muted, defaults.muted),
    volume: number(input.volume, defaults.volume, 0, 1),
  };
}
