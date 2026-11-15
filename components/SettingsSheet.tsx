"use client";

import {
  Check,
  CloudCheck,
  CloudOff,
  Film,
  HardDrive,
  Image as ImageIcon,
  Link2,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import { guessMediaKind, normalizeMediaUrl, probeMedia } from "@/lib/client/media-probe";
import { clearBackgroundFile, MAX_UPLOAD_BYTES, saveBackgroundFile } from "@/lib/client/media-store";
import {
  DEFAULT_SETTINGS,
  MAX_DIM,
  POMODORO_LIMITS,
  PRESETS,
  type Background,
  type Settings,
} from "@/lib/client/settings";
import { selectUnsyncedCount } from "@/lib/client/tracker-store";

import { Sheet } from "./Sheet";
import { useStore, useTracker } from "./tracker";
import { Slider, Stepper, Switch } from "./ui";

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="border-t border-white/10 py-5 first:border-t-0 first:pt-1">
      <h3 className="text-[11px] font-medium tracking-[0.18em] text-white/50 uppercase">{title}</h3>
      {hint && <p className="mt-1.5 text-xs leading-relaxed text-white/40">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** A problem worth showing to the user word for word. */
class Explained extends Error {}

function describeBackground(background: Background): string {
  if (background.kind === "upload") return background.name || (background.media === "video" ? "Your video" : "Your picture");
  if (background.kind === "url") {
    try {
      const url = new URL(background.url);
      return url.hostname + (url.pathname.length > 1 ? `/…${url.pathname.slice(-18)}` : "");
    } catch {
      return background.url;
    }
  }
  return "";
}

function BackgroundSettings({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  const store = useStore();
  const background = useTracker((state) => state.settings.background);
  const dim = useTracker((state) => state.settings.dim);
  const muted = useTracker((state) => state.settings.muted);
  const volume = useTracker((state) => state.settings.volume);

  const fileInput = useRef<HTMLInputElement>(null);
  const linkId = useId();
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState<"file" | "link" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const custom = background.kind !== "preset";
  const isVideo = custom && background.media === "video";

  function apply(next: Background) {
    // The stored file is only needed while it is the background.
    if (background.kind === "upload" && next.kind !== "upload") void clearBackgroundFile().catch(() => {});
    setError(null);
    store.updateSettings({ background: next });
  }

  async function addFile(file: File) {
    setBusy("file");
    setError(null);
    try {
      if (file.size > MAX_UPLOAD_BYTES) {
        throw new Explained(
          `That file is ${Math.round(file.size / 1_000_000)} MB. Files up to ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB work here.`,
        );
      }

      const preview = URL.createObjectURL(file);
      const media = await probeMedia(preview, guessMediaKind(file.type || file.name)).finally(() =>
        URL.revokeObjectURL(preview),
      );
      if (!media) {
        throw new Explained(
          "This browser can’t show that file. Try a JPG, PNG or WebP picture, or an MP4 or WebM video.",
        );
      }

      await saveBackgroundFile(file);
      apply({ kind: "upload", media, name: file.name.slice(0, 120), stamp: Date.now() });
    } catch (err) {
      setError(
        err instanceof Explained
          ? err.message
          : "The browser couldn’t keep that file. It may be out of space, or storage may be blocked in private browsing. A link works without storing anything.",
      );
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function addLink(event: FormEvent) {
    event.preventDefault();
    const url = normalizeMediaUrl(link);
    if (!url) {
      setError("Enter a full link, such as https://example.com/forest.jpg");
      return;
    }

    setBusy("link");
    setError(null);
    try {
      const media = await probeMedia(url, guessMediaKind(url));
      if (!media) {
        setError(
          "That link doesn’t lead straight to a picture or video this browser can show. Pages such as YouTube won’t work — use a direct file link, or upload the file instead.",
        );
        return;
      }
      apply({ kind: "url", media, url });
      setLink("");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section title="Background">
      <div role="radiogroup" aria-label="Animated backgrounds" className="flex flex-wrap gap-2.5">
        {PRESETS.map((preset) => {
          const selected = background.kind === "preset" && background.preset === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={preset.label}
              title={preset.label}
              onClick={() => apply({ kind: "preset", preset: preset.id })}
              className={`relative size-12 overflow-hidden rounded-2xl border transition-all duration-300 ${
                selected ? "border-white/90 shadow-[0_0_0_3px_rgb(255_255_255/0.14)]" : "border-white/15 hover:border-white/45"
              }`}
              style={{
                background: `radial-gradient(circle at 25% 20%, ${preset.colors[0]}, transparent 60%), radial-gradient(circle at 80% 85%, ${preset.colors[1]}, transparent 62%), radial-gradient(circle at 60% 40%, ${preset.colors[2]}, transparent 70%), ${preset.base}`,
              }}
            >
              {selected && <Check className="absolute inset-0 m-auto size-4 text-white drop-shadow" aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      <p className="mt-5 text-sm text-white/90">Your own picture or video</p>
      <p className="mt-0.5 text-xs leading-relaxed text-white/45">
        An uploaded file stays in this browser; it is not sent anywhere.
      </p>

      {custom && (
        <div className="mt-3 flex items-center gap-3 rounded-2xl bg-white/[0.07] py-2 pr-2 pl-3.5">
          {isVideo ? (
            <Film className="size-4 shrink-0 text-white/60" strokeWidth={1.6} aria-hidden="true" />
          ) : (
            <ImageIcon className="size-4 shrink-0 text-white/60" strokeWidth={1.6} aria-hidden="true" />
          )}
          <span className="min-w-0 flex-1 truncate text-[13px] text-white/85">{describeBackground(background)}</span>
          <button
            type="button"
            aria-label="Remove this background"
            title="Remove"
            className="grid size-8 shrink-0 place-items-center rounded-full text-white/55 transition-colors hover:bg-white/10 hover:text-white"
            onClick={() => apply(DEFAULT_SETTINGS.background)}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {custom && failed && (
        <div role="alert" className="mt-2.5 flex items-start gap-2.5 text-xs leading-relaxed text-amber-200/90">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <p>
            {background.kind === "upload"
              ? "The stored file is no longer available — browsers remove it when site data is cleared. Please add it again."
              : "This background couldn’t be loaded, so the default one is shown."}{" "}
            {background.kind === "url" && (
              <button type="button" className="underline underline-offset-2 hover:text-white" onClick={onRetry}>
                Try again
              </button>
            )}
          </p>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <input
          ref={fileInput}
          type="file"
          accept="image/*,video/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void addFile(file);
          }}
        />
        <button
          type="button"
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-white/14 px-4 text-[13px] text-white/85 transition-colors hover:bg-white/8 hover:text-white disabled:opacity-50"
          disabled={busy !== null}
          onClick={() => fileInput.current?.click()}
        >
          {busy === "file" ? (
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Upload className="size-3.5" aria-hidden="true" />
          )}
          {busy === "file" ? "Adding…" : "Upload"}
        </button>

        <form
          onSubmit={addLink}
          // The link is checked by loading it, with a message in the app's own words.
          noValidate
          className="flex h-10 min-w-0 flex-1 items-center rounded-full border border-white/14 pr-1 pl-3.5 transition-colors focus-within:border-white/45"
        >
          <Link2 className="size-3.5 shrink-0 text-white/45" aria-hidden="true" />
          <label htmlFor={linkId} className="sr-only">
            Link to a picture or video
          </label>
          <input
            id={linkId}
            type="url"
            inputMode="url"
            placeholder="or paste a link"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent px-2.5 text-[13px] text-white outline-none placeholder:text-white/35 focus-visible:outline-none"
            value={link}
            onChange={(event) => setLink(event.target.value)}
          />
          {link.trim() !== "" && (
            <button
              type="submit"
              className="h-8 shrink-0 rounded-full bg-white px-3.5 text-xs font-medium text-ink transition-colors hover:bg-white/90 disabled:opacity-60"
              disabled={busy !== null}
            >
              {busy === "link" ? "Checking…" : "Use"}
            </button>
          )}
        </form>
      </div>

      {error && (
        <p role="alert" className="mt-2.5 text-xs leading-relaxed text-rose-300">
          {error}
        </p>
      )}

      {custom && (
        <div className="mt-5">
          <div className="flex items-center justify-between text-sm text-white/90">
            <span>Dim</span>
            <span className="text-xs text-white/45 tabular-nums">{Math.round(dim * 100)}%</span>
          </div>
          <Slider
            label="Dim the background"
            value={dim}
            min={0}
            max={MAX_DIM}
            step={0.01}
            onChange={(value) => store.updateSettings({ dim: value })}
          />
        </div>
      )}

      {isVideo && (
        <div className="mt-2">
          <Switch
            label="Video sound"
            checked={!muted}
            onChange={(on) => store.updateSettings({ muted: !on })}
          />
          <div className="flex items-center justify-between text-sm text-white/90">
            <span className={muted ? "text-white/40" : undefined}>Volume</span>
            <span className="text-xs text-white/45 tabular-nums">{Math.round(volume * 100)}%</span>
          </div>
          <Slider
            label="Video volume"
            value={volume}
            min={0}
            max={1}
            step={0.01}
            disabled={muted}
            onChange={(value) => store.updateSettings({ volume: value })}
          />
        </div>
      )}
    </Section>
  );
}

function PomodoroSettings() {
  const store = useStore();
  const pomodoro = useTracker((state) => state.settings.pomodoro);
  const chime = useTracker((state) => state.settings.chime);
  const set = (patch: Partial<Settings["pomodoro"]>) => store.updateSettings({ pomodoro: { ...pomodoro, ...patch } });

  return (
    <Section title="Pomodoro" hint="Focus in rounds with breaks in between. Changes apply from the next round.">
      <Stepper
        label="Focus"
        unit="min"
        value={pomodoro.focusMinutes}
        {...POMODORO_LIMITS.focusMinutes}
        onChange={(focusMinutes) => set({ focusMinutes })}
      />
      <Stepper
        label="Short break"
        unit="min"
        value={pomodoro.shortBreakMinutes}
        {...POMODORO_LIMITS.shortBreakMinutes}
        onChange={(shortBreakMinutes) => set({ shortBreakMinutes })}
      />
      <Stepper
        label="Long break"
        unit="min"
        value={pomodoro.longBreakMinutes}
        {...POMODORO_LIMITS.longBreakMinutes}
        onChange={(longBreakMinutes) => set({ longBreakMinutes })}
      />
      <Stepper
        label="Long break after"
        unit={pomodoro.roundsBeforeLongBreak === 1 ? "round" : "rounds"}
        value={pomodoro.roundsBeforeLongBreak}
        {...POMODORO_LIMITS.roundsBeforeLongBreak}
        onChange={(roundsBeforeLongBreak) => set({ roundsBeforeLongBreak })}
      />
      <div className="mt-2">
        <Switch
          label="Start the next round automatically"
          description="Otherwise the timer waits for you after each break."
          checked={pomodoro.autoStartFocus}
          onChange={(autoStartFocus) => set({ autoStartFocus })}
        />
        <Switch
          label="Chime"
          description="A soft sound when a round or a break ends."
          checked={chime}
          onChange={(value) => store.updateSettings({ chime: value })}
        />
      </div>
    </Section>
  );
}

function DataSettings() {
  const store = useStore();
  const sync = useTracker((state) => state.sync);
  const local = useTracker((state) => state.local);
  const storageOk = useTracker((state) => state.storageOk);
  const waiting = selectUnsyncedCount({ local });
  const sessions = `${waiting} ${waiting === 1 ? "session is" : "sessions are"}`;

  let icon: ReactNode;
  let headline: string;
  let detail: string;

  if (sync.status === "local") {
    icon = <HardDrive className="size-4" strokeWidth={1.6} aria-hidden="true" />;
    headline = "Saved in this browser";
    detail =
      "No database is connected, so your sessions live on this device only. Set DATABASE_URL on the server and they will be uploaded and kept in sync.";
  } else if (sync.status === "error") {
    icon = <CloudOff className="size-4" strokeWidth={1.6} aria-hidden="true" />;
    headline = sync.reason === "offline" ? "You’re offline" : "The database can’t be reached";
    detail =
      waiting > 0
        ? `${sessions} waiting on this device and will upload automatically.`
        : "Nothing is waiting to be uploaded. The totals shown are the last ones received.";
  } else if (sync.status === "synced") {
    icon = <CloudCheck className="size-4" strokeWidth={1.6} aria-hidden="true" />;
    headline = "Saved to your database";
    detail = waiting > 0 ? `${sessions} kept on this device only.` : "Every session is stored and up to date.";
  } else {
    icon = <LoaderCircle className="size-4 animate-spin" strokeWidth={1.6} aria-hidden="true" />;
    headline = "Syncing…";
    detail = "Talking to the database.";
  }

  return (
    <Section title="Your data">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-white/60">{icon}</span>
        <div className="min-w-0 flex-1" role="status">
          <p className="text-sm text-white/90">{headline}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-white/45">{detail}</p>
        </div>
        <button
          type="button"
          aria-label="Sync now"
          title="Sync now"
          className="grid size-9 shrink-0 place-items-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
          disabled={sync.status === "syncing"}
          onClick={() => void store.syncAfresh()}
        >
          <RefreshCw className="size-4" strokeWidth={1.7} aria-hidden="true" />
        </button>
      </div>

      {!storageOk && (
        <p role="alert" className="mt-3 flex items-start gap-2.5 text-xs leading-relaxed text-amber-200/90">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          This browser is refusing to store data (it may be full, or in a private window). Your timer keeps working, but
          anything not yet in the database will be lost when this tab closes.
        </p>
      )}
    </Section>
  );
}

export function SettingsSheet({
  open,
  onClose,
  backgroundFailed,
  onRetryBackground,
}: {
  open: boolean;
  onClose: () => void;
  backgroundFailed: boolean;
  onRetryBackground: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Settings">
      <BackgroundSettings failed={backgroundFailed} onRetry={onRetryBackground} />
      <PomodoroSettings />
      <DataSettings />
    </Sheet>
  );
}
