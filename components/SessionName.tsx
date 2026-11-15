"use client";

import { AnimatePresence, motion } from "motion/react";
import { useMemo, useRef, useState } from "react";

import { selectRecentNames } from "@/lib/client/tracker-store";
import { SESSION_NAME_MAX_LENGTH } from "@/lib/types";

import { useStore, useTracker } from "./tracker";
import { easeOut } from "./ui";

const MAX_SUGGESTIONS = 4;

/**
 * The name of the session: typed before starting, and still editable while
 * the timer runs. While the field has focus, recent names are offered below.
 */
export function SessionName({ onSubmit }: { onSubmit: () => void }) {
  const store = useStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const active = useTracker((state) => state.timer !== null);
  const name = useTracker((state) => state.timer?.name ?? state.draftName);

  const local = useTracker((state) => state.local);
  const remote = useTracker((state) => state.remote);
  const older = useTracker((state) => state.older);
  const recent = useMemo(() => selectRecentNames({ local, remote, older }, 12), [local, remote, older]);

  const typed = name.trim().toLowerCase();
  const suggestions = recent
    .filter((candidate) => candidate.toLowerCase().includes(typed) && candidate.toLowerCase() !== typed)
    .slice(0, MAX_SUGGESTIONS);
  const offer = focused && !active && suggestions.length > 0;

  return (
    <div
      // The space below the hairline is where the suggestions appear.
      className="on-media relative w-full max-w-2xl px-2 pb-3 sm:pb-4"
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        // Focus moving from the field to a suggestion is not leaving.
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <input
        ref={inputRef}
        type="text"
        aria-label="Session name"
        placeholder={active ? "Untitled session" : "What are you studying?"}
        className="peer w-full bg-transparent text-center font-serif text-[clamp(1.7rem,4.6vw,2.7rem)] leading-tight short:text-[clamp(1.4rem,3.6vw,2.2rem)] text-ellipsis text-white italic caret-white/70 outline-none placeholder:text-white/40"
        value={name}
        maxLength={SESSION_NAME_MAX_LENGTH}
        autoComplete="off"
        autoCapitalize="sentences"
        spellCheck={false}
        enterKeyHint={active ? "done" : "go"}
        onChange={(event) => (active ? store.rename(event.target.value) : store.setDraftName(event.target.value))}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") event.currentTarget.blur();
          if (event.key !== "Enter") return;
          event.preventDefault();
          // Leave the field either way, so that Space reaches the timer again.
          event.currentTarget.blur();
          if (!active) onSubmit();
        }}
      />
      {/* A hairline that widens with focus: the field's focus indicator. */}
      <div className="pointer-events-none mx-auto mt-1.5 h-px w-20 bg-gradient-to-r from-transparent via-white/30 to-transparent transition-all duration-500 ease-out-expo peer-focus:w-64 peer-focus:via-white/80" />

      <AnimatePresence>
        {offer && (
          <motion.div
            className="absolute inset-x-0 top-full z-10 -mt-1.5 flex justify-center sm:-mt-2.5"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.3, ease: easeOut }}
          >
            {/* One row: more names than fit can be reached by swiping (or with Tab). */}
            <ul
              aria-label="Recent session names"
              className="scroll-none flex max-w-full gap-2 overflow-x-auto px-5 py-1 [mask-image:linear-gradient(to_right,transparent,black_1.25rem,black_calc(100%-1.25rem),transparent)]"
            >
              {suggestions.map((suggestion) => (
                <li key={suggestion} className="shrink-0">
                  <button
                    type="button"
                    className="block max-w-48 truncate rounded-full border border-white/12 bg-[rgb(12_16_26/0.72)] px-3 py-1 text-[12.5px] leading-[1.35] text-white/75 transition-colors duration-200 hover:border-white/30 hover:text-white"
                    // Keep the focus in the field, so typing can simply continue.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      store.setDraftName(suggestion);
                      inputRef.current?.focus();
                    }}
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
