"use client"; // Error boundaries must be Client Components.

import { useEffect } from "react";

import { Brand } from "@/components/Brand";

/**
 * Shown when the page itself fails to render. The timer is kept as timestamps
 * in this browser's storage and every finished session is stored the moment it
 * ends, so nothing is lost: trying again (or reloading) picks up where it was.
 */
export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-16 items-center px-5 sm:px-8">
        <Brand />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-5 px-6 pb-16 text-center" role="alert">
        <h1 className="font-serif text-4xl text-white italic">Something went wrong</h1>
        <p className="max-w-sm text-sm leading-relaxed text-white/60">
          The page ran into a problem. A running timer keeps counting and your saved sessions are still in this
          browser.
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-3 text-sm font-medium">
          <button
            type="button"
            className="rounded-full bg-white px-6 py-3 text-ink transition-colors hover:bg-white/90"
            onClick={() => retry()}
          >
            Try again
          </button>
          <button
            type="button"
            className="rounded-full border border-white/20 px-6 py-3 text-white/85 transition-colors hover:bg-white/10"
            onClick={() => window.location.reload()}
          >
            Reload the page
          </button>
        </div>
      </main>
    </div>
  );
}
