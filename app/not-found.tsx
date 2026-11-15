import type { Metadata } from "next";
import Link from "next/link";

import { Brand } from "@/components/Brand";

export const metadata: Metadata = { title: "Page not found · Study Tracker" };

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-16 items-center px-5 sm:px-8">
        <Brand />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-5 px-6 pb-16 text-center">
        <h1 className="font-serif text-4xl text-white italic">Nothing to study here</h1>
        <p className="max-w-sm text-sm leading-relaxed text-white/60">
          This page does not exist. Your timer and your sessions are where you left them.
        </p>
        <Link
          href="/"
          className="mt-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-ink transition-colors hover:bg-white/90"
        >
          Back to the timer
        </Link>
      </main>
    </div>
  );
}
