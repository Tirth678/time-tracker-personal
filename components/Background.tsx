"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { loadBackgroundFile } from "@/lib/client/media-store";
import { PRESETS, type Background as BackgroundSetting, type PresetId } from "@/lib/client/settings";

import { useTracker } from "./tracker";

/** Identifies a background, so its loading state can be told apart from the previous one's. */
export function backgroundKey(background: BackgroundSetting): string {
  if (background.kind === "preset") return `preset:${background.preset}`;
  if (background.kind === "url") return `url:${background.media}:${background.url}`;
  return `upload:${background.media}:${background.stamp}`;
}

/**
 * A glow that fades out like a blurred light rather than a disc with an edge.
 * (A real blur filter would look the same but costs far more to animate.)
 */
function glow(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
  const stops = [
    [1, 0],
    [0.86, 12],
    [0.62, 26],
    [0.38, 42],
    [0.19, 58],
    [0.07, 74],
    [0.015, 88],
    [0, 100],
  ];
  return `radial-gradient(closest-side, ${stops.map(([alpha, at]) => `rgb(${r} ${g} ${b} / ${alpha}) ${at}%`).join(", ")})`;
}

function PresetLayer({ preset, paused }: { preset: PresetId; paused: boolean }) {
  const { base, colors } = PRESETS.find((candidate) => candidate.id === preset) ?? PRESETS[0];
  const playState = paused ? "paused" : "running";
  const blob = "absolute rounded-full will-change-transform";

  return (
    <motion.div
      className="absolute inset-0 overflow-hidden"
      style={{ backgroundColor: base }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1.4, ease: "easeInOut" }}
    >
      <div
        className={`${blob} -top-[40%] -left-[25%] size-[105vmax] animate-drift-a opacity-70`}
        style={{ background: glow(colors[0]), animationPlayState: playState }}
      />
      <div
        className={`${blob} -right-[30%] -bottom-[50%] size-[115vmax] animate-drift-b opacity-60`}
        style={{ background: glow(colors[1]), animationPlayState: playState }}
      />
      <div
        className={`${blob} top-[8%] left-[28%] size-[80vmax] animate-drift-c opacity-50`}
        style={{ background: glow(colors[2]), animationPlayState: playState }}
      />
    </motion.div>
  );
}

/** The object URL of the uploaded file, or what went wrong with it. */
type Upload = { stamp: number; url: string | null };

function useUploadedFile(stamp: number | null): Upload | null {
  const [upload, setUpload] = useState<Upload | null>(null);

  useEffect(() => {
    if (stamp === null) return;

    let cancelled = false;
    let objectUrl: string | null = null;
    loadBackgroundFile()
      .catch(() => null)
      .then((file) => {
        if (cancelled) return;
        objectUrl = file ? URL.createObjectURL(file) : null;
        setUpload({ stamp, url: objectUrl });
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [stamp]);

  return upload !== null && upload.stamp === stamp ? upload : null;
}

function VideoLayer({ src, onReady, onError }: { src: string; onReady: () => void; onError: () => void }) {
  const muted = useTracker((state) => state.settings.muted);
  const volume = useTracker((state) => state.settings.volume);
  const ref = useRef<HTMLVideoElement>(null);
  // Browsers refuse to start a video with sound before the user has touched the page.
  const [soundBlocked, setSoundBlocked] = useState(false);
  const silent = muted || soundBlocked;

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.volume = volume;
    video.muted = silent;

    let cancelled = false;
    video.play().catch((error: unknown) => {
      if (cancelled || !(error instanceof DOMException) || error.name !== "NotAllowedError") return;
      // Play silently for now; the sound follows with the first click or key press.
      if (!silent) setSoundBlocked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [silent, volume, src]);

  useEffect(() => {
    if (!soundBlocked) return;
    // `click` rather than `pointerdown`: if that click is on the mute button,
    // both changes land together and no sound slips out in between.
    const unblock = () => setSoundBlocked(false);
    window.addEventListener("click", unblock, { once: true });
    window.addEventListener("keydown", unblock, { once: true });
    return () => {
      window.removeEventListener("click", unblock);
      window.removeEventListener("keydown", unblock);
    };
  }, [soundBlocked]);

  // Some browsers pause a video while its tab is hidden; pick it up again on return.
  useEffect(() => {
    const resume = () => {
      const video = ref.current;
      if (video && !document.hidden && video.paused) void video.play().catch(() => {});
    };
    document.addEventListener("visibilitychange", resume);
    return () => document.removeEventListener("visibilitychange", resume);
  }, []);

  return (
    <video
      ref={ref}
      src={src}
      className="absolute inset-0 size-full object-cover"
      autoPlay
      loop
      muted={silent}
      playsInline
      preload="auto"
      disablePictureInPicture
      tabIndex={-1}
      onLoadedData={onReady}
      onError={onError}
    />
  );
}

/**
 * The full-screen backdrop: an animated gradient, or the user's own picture or
 * video on top of it. The gradient always stays underneath, so there is
 * something pleasant to look at while media loads — or if it fails to.
 *
 * `attempt` changes when the user asks to try a failed background again.
 */
export function Background({ attempt, onProblem }: { attempt: number; onProblem: (failed: boolean) => void }) {
  const background = useTracker((state) => state.settings.background);
  const dim = useTracker((state) => state.settings.dim);
  const key = `${backgroundKey(background)}#${attempt}`;

  const upload = useUploadedFile(background.kind === "upload" ? background.stamp : null);

  // Loading state of the current background. It starts over whenever the
  // background changes, which also makes late events from the old one harmless.
  const [media, setMedia] = useState<{ key: string; state: "loading" | "ready" | "failed" }>({ key, state: "loading" });
  if (media.key !== key) setMedia({ key, state: "loading" });
  const state = media.key === key ? media.state : "loading";

  const src = background.kind === "url" ? background.url : background.kind === "upload" ? (upload?.url ?? null) : null;
  // The stored file is gone, e.g. because the browser's site data was cleared.
  const missing = background.kind === "upload" && upload !== null && upload.url === null;
  const failed = background.kind !== "preset" && (state === "failed" || missing);
  const showMedia = background.kind !== "preset" && src !== null && !failed;
  const mediaVisible = showMedia && state === "ready";

  useEffect(() => {
    onProblem(failed);
  }, [failed, onProblem]);

  const settle = (next: "ready" | "failed") => () =>
    setMedia((current) => (current.key === key ? { key, state: next } : current));

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-ink" aria-hidden="true">
      <AnimatePresence initial={false}>
        <PresetLayer
          key={background.kind === "preset" ? background.preset : "base"}
          preset={background.kind === "preset" ? background.preset : "aurora"}
          paused={mediaVisible}
        />
      </AnimatePresence>

      <AnimatePresence>
        {showMedia && (
          <motion.div
            key={key}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: mediaVisible ? 1 : 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.1, ease: "easeInOut" }}
          >
            {background.media === "video" ? (
              <VideoLayer src={src} onReady={settle("ready")} onError={settle("failed")} />
            ) : (
              // A plain <img>: the picture is the user's own file or link, shown as it is.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt=""
                className="absolute inset-0 size-full object-cover"
                decoding="async"
                onLoad={settle("ready")}
                onError={settle("failed")}
              />
            )}
            <div className="absolute inset-0 bg-black" style={{ opacity: dim }} />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grain absolute inset-0 opacity-[0.22] mix-blend-overlay" />
      {/* A soft vignette keeps the eye in the middle and the corners quiet. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgb(0_0_0/0.42)_100%)]" />
    </div>
  );
}
