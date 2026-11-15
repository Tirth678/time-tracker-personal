/** The wordmark. Shared by the loading screen and the app so that it never moves. */
export function Brand() {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
        <circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" />
        <path d="M12 2.75a9.25 9.25 0 0 1 8.01 4.63" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="12" cy="12" r="2" fill="currentColor" />
      </svg>
      <span className="text-[13px] font-medium tracking-[0.02em] text-white/85">Study Tracker</span>
    </div>
  );
}
