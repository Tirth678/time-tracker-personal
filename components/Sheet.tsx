"use client";

import { X } from "lucide-react";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode, type RefObject } from "react";

import { IconButton, softSpring } from "./ui";

const WIDE = "(min-width: 640px)";

function subscribeToWidth(listener: () => void): () => void {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

/** Whether there is room for a side panel (otherwise the sheet comes from the bottom). */
function useWideScreen(): boolean {
  return useSyncExternalStore(
    subscribeToWidth,
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

/**
 * A panel that slides in from the right (from the bottom on phones).
 *
 * It behaves as a modal dialog: focus moves into it, Escape and the backdrop
 * close it, and focus returns to where it was. The page behind is made `inert`
 * by the caller, which keeps the Tab key inside the panel.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const wide = useWideScreen();
  const hidden = wide ? { opacity: 0, x: 56, y: 0 } : { opacity: 1, x: 0, y: "100%" };

  useEffect(() => {
    if (!open) return;

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Wait a frame: the page behind is still inert while this effect cleans up.
      requestAnimationFrame(() => opener?.focus({ preventScroll: true }));
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <SheetLayer title={title} titleId={titleId} panelRef={panelRef} hidden={hidden} onClose={onClose}>
          {children}
        </SheetLayer>
      )}
    </AnimatePresence>
  );
}

function SheetLayer({
  title,
  titleId,
  panelRef,
  hidden,
  onClose,
  children,
}: {
  title: string;
  titleId: string;
  panelRef: RefObject<HTMLDivElement | null>;
  hidden: { opacity: number; x: number; y: number | string };
  onClose: () => void;
  children: ReactNode;
}) {
  // False from the moment the sheet is closed until its exit animation has finished.
  const present = useIsPresent();

  return (
    // While it slides away, clicks go to the page underneath, which is already usable again.
    <div className={`fixed inset-0 z-40 ${present ? "" : "pointer-events-none"}`}>
      <motion.div
        className="absolute inset-0 bg-black/45"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        onClick={onClose}
      />
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={[
          "glass absolute flex flex-col outline-none",
          // Phones: a sheet from the bottom. Larger screens: a panel on the right.
          "inset-x-0 bottom-0 max-h-[88dvh] rounded-t-[28px] pb-[env(safe-area-inset-bottom)]",
          "sm:inset-x-auto sm:top-3 sm:right-3 sm:bottom-3 sm:max-h-none sm:w-[26.5rem] sm:rounded-[28px] sm:pb-0",
          "bg-[rgb(10_13_22/0.78)]",
        ].join(" ")}
        initial={hidden}
        animate={{ opacity: 1, x: 0, y: 0 }}
        exit={hidden}
        transition={softSpring}
      >
        <header className="flex shrink-0 items-center justify-between py-4 pr-4 pl-6">
          <h2 id={titleId} className="font-serif text-[1.7rem] leading-none text-white italic">
            {title}
          </h2>
          <IconButton label={`Close ${title.toLowerCase()}`} onClick={onClose}>
            <X className="size-[18px]" aria-hidden="true" />
          </IconButton>
        </header>
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6">{children}</div>
      </motion.div>
    </div>
  );
}
