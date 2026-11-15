"use client"; // Error boundaries must be Client Components.

import { useEffect } from "react";

/**
 * The last resort: shown when the root layout itself fails. It replaces the
 * layout, so it brings its own document and cannot rely on the stylesheet.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          background: "#060a14",
          color: "#fff",
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
          textAlign: "center",
        }}
      >
        <title>Something went wrong · Study Tracker</title>
        <main role="alert" style={{ maxWidth: "24rem" }}>
          <h1 style={{ margin: 0, fontSize: "1.75rem", fontWeight: 500 }}>Something went wrong</h1>
          <p style={{ margin: "1rem 0 1.75rem", fontSize: "0.9rem", lineHeight: 1.6, color: "rgb(255 255 255 / 0.65)" }}>
            Study Tracker could not start. A running timer keeps counting and your saved sessions are still in this
            browser.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              border: 0,
              borderRadius: "999px",
              padding: "0.75rem 1.5rem",
              background: "#fff",
              color: "#060a14",
              font: "inherit",
              fontSize: "0.9rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
