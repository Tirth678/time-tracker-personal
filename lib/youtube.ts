const PLAYLIST_ID = /^[A-Za-z0-9_-]{1,200}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const VIDEO_REFERENCE_PREFIX = "video:";

/** Returns a playlist id or an internal video reference from a YouTube URL or pasted id. */
export function parseYouTubePlaylistId(input: string): string | null {
  const value = input.trim();
  if (PLAYLIST_ID.test(value)) return value;

  try {
    const url = new URL(value);
    if (!["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(url.hostname)) return null;
    const id = url.searchParams.get("list");
    if (id && PLAYLIST_ID.test(id)) return id;

    if (url.hostname === "youtu.be" || url.pathname === "/watch") {
      const videoId = url.hostname === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v");
      return videoId && VIDEO_ID.test(videoId) ? `${VIDEO_REFERENCE_PREFIX}${videoId}` : null;
    }
    return null;
  } catch {
    return null;
  }
}

export function isYouTubeVideoReference(value: string): boolean {
  return value.startsWith(VIDEO_REFERENCE_PREFIX);
}
