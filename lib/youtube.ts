const PLAYLIST_ID = /^[A-Za-z0-9_-]{1,200}$/;

/** Returns a YouTube playlist id from a URL or a pasted id. */
export function parseYouTubePlaylistId(input: string): string | null {
  const value = input.trim();
  if (PLAYLIST_ID.test(value)) return value;

  try {
    const url = new URL(value);
    if (!["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(url.hostname)) return null;
    const id = url.searchParams.get("list");
    return id && PLAYLIST_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}
