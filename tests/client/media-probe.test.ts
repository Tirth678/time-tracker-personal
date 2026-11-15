import { describe, expect, it } from "vitest";

import { guessMediaKind, normalizeMediaUrl } from "../../lib/client/media-probe";

describe("normalizeMediaUrl", () => {
  it.each([
    ["https://example.com/forest.jpg", "https://example.com/forest.jpg"],
    ["  http://example.com/a b.jpg".replace(" b", "%20b"), "http://example.com/a%20b.jpg"],
    ["example.com/rain.mp4", "https://example.com/rain.mp4"],
    ["cdn.example.com:8443/clip.webm?x=1#t=3", "https://cdn.example.com:8443/clip.webm?x=1#t=3"],
    ["localhost:8765/photo.jpg", "https://localhost:8765/photo.jpg"],
    ["HTTPS://Example.COM/A.JPG", "https://example.com/A.JPG"],
    ["http://192.168.1.20/cam.jpg", "http://192.168.1.20/cam.jpg"],
  ])("accepts %s", (input, expected) => {
    expect(normalizeMediaUrl(input)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "forest",
    "http://",
    "javascript:alert(1)",
    "javascript://example.com/%0Aalert(1)",
    "data:image/png;base64,AAAA",
    "file:///etc/passwd",
    "blob:https://example.com/123",
    "ftp://example.com/a.jpg",
    "two words.com/a.jpg",
  ])("refuses %j", (input) => {
    expect(normalizeMediaUrl(input)).toBeNull();
  });
});

describe("guessMediaKind", () => {
  it("guesses from MIME types and file names, ignoring query strings", () => {
    expect(guessMediaKind("video/mp4")).toBe("video");
    expect(guessMediaKind("image/webp")).toBe("image");
    expect(guessMediaKind("Holiday.MOV")).toBe("video");
    expect(guessMediaKind("https://example.com/a.jpeg?w=1200#x")).toBe("image");
    expect(guessMediaKind("https://example.com/watch?v=abc")).toBeUndefined();
    expect(guessMediaKind("")).toBeUndefined();
  });
});
