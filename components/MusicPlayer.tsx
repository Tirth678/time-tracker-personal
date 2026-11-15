"use client";

import { ChevronLeft, ChevronRight, LoaderCircle, Pause, Play, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { ApiError, createApi } from "@/lib/client/api";
import type { MusicPlaylist } from "@/lib/types";
import { parseYouTubePlaylistId } from "@/lib/youtube";

import { IconButton } from "./ui";

const api = createApi();

function command(frame: HTMLIFrameElement | null, func: string, args: unknown[] = []) {
  frame?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "https://www.youtube.com");
}

export function MusicPlayer() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [playlist, setPlaylist] = useState<MusicPlaylist | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api
      .playlist()
      .then((value) => {
        if (active) setPlaylist(value);
      })
      .catch((err: unknown) => {
        if (active && !(err instanceof ApiError && err.code === "database_not_configured")) {
          setError("The music playlist could not be loaded.");
        }
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    const playlistId = parseYouTubePlaylistId(draft);
    if (!playlistId) {
      setError("Paste a YouTube playlist URL or playlist id.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      setPlaylist(await api.savePlaylist(playlistId));
      setDraft("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The playlist could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setError(null);
    try {
      await api.deletePlaylist();
      setPlaylist(null);
      setPlaying(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The playlist could not be removed.");
    }
  }

  if (busy) {
    return <LoaderCircle className="size-4 animate-spin text-white/40" aria-label="Loading music player" />;
  }

  if (!playlist) {
    return (
      <div className="glass w-full max-w-xl rounded-3xl px-4 py-3 text-left">
        <p className="text-sm text-white/90">Focus music</p>
        <p className="mt-0.5 text-xs text-white/45">Add a YouTube playlist to control it while you work.</p>
        <form onSubmit={save} className="mt-3 flex gap-2">
          <label htmlFor="playlist-url" className="sr-only">
            YouTube playlist URL
          </label>
          <input
            id="playlist-url"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Paste a YouTube playlist URL"
            className="min-w-0 flex-1 rounded-full border border-white/15 bg-transparent px-3.5 py-2 text-xs text-white outline-none placeholder:text-white/35 focus:border-white/45"
            disabled={saving}
          />
          <button
            type="submit"
            className="rounded-full bg-white px-4 py-2 text-xs font-medium text-ink transition-colors hover:bg-white/90 disabled:opacity-50"
            disabled={saving || draft.trim() === ""}
          >
            {saving ? "Saving…" : "Add"}
          </button>
        </form>
        {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
      </div>
    );
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const embedUrl = `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(
    playlist.playlistId,
  )}&enablejsapi=1&origin=${encodeURIComponent(origin)}&controls=0&rel=0`;

  return (
    <div className="glass w-full max-w-xl overflow-hidden rounded-3xl">
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-xl bg-black/30">
          <iframe
            ref={frame}
            title="YouTube focus music"
            src={embedUrl}
            allow="autoplay; encrypted-media"
            className="absolute inset-0 h-full w-full"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-white/90">Focus music</p>
          <p className="truncate text-xs text-white/45">Playlist {playlist.playlistId}</p>
          <div className="mt-1 flex items-center gap-0.5">
            <IconButton label="Previous track" className="size-8" onClick={() => command(frame.current, "previousVideo")}>
              <ChevronLeft className="size-4" aria-hidden="true" />
            </IconButton>
            <IconButton
              label={playing ? "Pause music" : "Play music"}
              className="size-8 bg-white/10"
              onClick={() => {
                command(frame.current, playing ? "pauseVideo" : "playVideo");
                setPlaying(!playing);
              }}
            >
              {playing ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
            </IconButton>
            <IconButton label="Next track" className="size-8" onClick={() => command(frame.current, "nextVideo")}>
              <ChevronRight className="size-4" aria-hidden="true" />
            </IconButton>
            <IconButton
              label={muted ? "Unmute music" : "Mute music"}
              className="size-8"
              onClick={() => {
                command(frame.current, muted ? "unMute" : "mute");
                setMuted(!muted);
              }}
            >
              {muted ? <VolumeX className="size-4" aria-hidden="true" /> : <Volume2 className="size-4" aria-hidden="true" />}
            </IconButton>
          </div>
        </div>
        <IconButton label="Remove playlist" className="size-8 self-start" onClick={() => void remove()}>
          <X className="size-4" aria-hidden="true" />
        </IconButton>
      </div>
      {error && <p className="px-4 pb-2 text-xs text-rose-300">{error}</p>}
    </div>
  );
}
