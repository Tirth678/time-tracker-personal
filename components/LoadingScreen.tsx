import { Brand } from "./Brand";

/**
 * What the server sends: the page frame without anything that depends on this
 * browser's stored data. The app fades in on top of it once it has loaded.
 */
export function LoadingScreen() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-16 items-center px-5 sm:px-8">
        <Brand />
      </header>
      <div className="flex flex-1 items-center justify-center pb-16" role="status">
        <span className="size-1.5 animate-breathe rounded-full bg-white/60" aria-hidden="true" />
        <span className="sr-only">Loading your study tracker…</span>
      </div>
      <noscript>
        <p className="fixed inset-x-0 bottom-10 px-6 text-center text-sm text-white/70">
          Study Tracker needs JavaScript to run its timer. Please enable it and reload.
        </p>
      </noscript>
    </div>
  );
}
