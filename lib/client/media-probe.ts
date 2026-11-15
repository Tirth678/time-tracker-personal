import type { MediaKind } from "./settings";

const PROBE_TIMEOUT_MS = 20_000;

function loadsAsImage(url: string, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    const done = (ok: boolean) => {
      image.onload = image.onerror = null;
      resolve(ok);
    };
    image.onload = () => done(image.naturalWidth > 0);
    image.onerror = () => done(false);
    signal.addEventListener("abort", () => {
      image.src = "";
      done(false);
    });
    image.src = url;
  });
}

function loadsAsVideo(url: string, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const done = (ok: boolean) => {
      video.onloadeddata = video.onerror = null;
      // Stop downloading: the real player will load it again.
      video.removeAttribute("src");
      video.load();
      resolve(ok);
    };
    video.muted = true;
    video.preload = "auto";
    // Wait for a decodable frame: metadata alone also arrives for audio-only
    // files and for videos in a codec this browser cannot show.
    video.onloadeddata = () => done(video.videoWidth > 0);
    video.onerror = () => done(false);
    signal.addEventListener("abort", () => done(false));
    video.src = url;
  });
}

/**
 * Finds out what a URL really is by loading it, instead of trusting its file
 * extension or MIME type. Returns `null` when the browser can show it as neither.
 */
export async function probeMedia(url: string, hint?: MediaKind): Promise<MediaKind | null> {
  const signal = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  const order: MediaKind[] = hint === "video" ? ["video", "image"] : ["image", "video"];

  for (const kind of order) {
    if (signal.aborted) return null;
    if (await (kind === "image" ? loadsAsImage(url, signal) : loadsAsVideo(url, signal))) return kind;
  }
  return null;
}

/** A guess from the name or MIME type, used only to decide what to try first. */
export function guessMediaKind(nameOrType: string): MediaKind | undefined {
  const value = nameOrType.toLowerCase().split(/[?#]/)[0];
  if (value.startsWith("video/") || /\.(mp4|webm|mov|m4v|ogv|mkv)$/.test(value)) return "video";
  if (value.startsWith("image/") || /\.(jpe?g|png|gif|webp|avif|svg|bmp)$/.test(value)) return "image";
  return undefined;
}

/**
 * Checks a link typed by the user and completes it (`example.com/a.jpg` gets
 * `https://`). Only http(s) links make sense here; anything else
 * (`javascript:`, `data:`, `file:`, …) is refused.
 */
export function normalizeMediaUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "" || /\s/.test(trimmed)) return null;
  try {
    // `host:8080/a.jpg` also has a colon, so only `scheme://` counts as a scheme.
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    const usable = (url.protocol === "https:" || url.protocol === "http:") && url.hostname.includes(".");
    // A bare word such as "forest" would otherwise become https://forest/.
    return usable || url.hostname === "localhost" ? url.href : null;
  } catch {
    return null;
  }
}
