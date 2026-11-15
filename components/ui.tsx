"use client";

import { motion } from "motion/react";
import { useId, useState, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";

/** Springs shared across the interface, so everything moves with one character. */
export const spring = { type: "spring", stiffness: 420, damping: 34, mass: 0.9 } as const;
export const softSpring = { type: "spring", stiffness: 260, damping: 30 } as const;
export const easeOut = [0.22, 1, 0.36, 1] as const;

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function IconButton({
  label,
  children,
  className,
  ...props
}: { label: string; children: ReactNode } & Omit<ComponentProps<"button">, "aria-label" | "title">) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        "grid size-10 shrink-0 place-items-center rounded-full text-white/75 transition-colors duration-200",
        "hover:bg-white/10 hover:text-white active:bg-white/15 disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function PillButton({
  variant = "glass",
  className,
  children,
  ...props
}: { variant?: "solid" | "glass" } & ComponentProps<typeof motion.button>) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.96 }}
      transition={spring}
      className={cx(
        "inline-flex h-13 items-center justify-center gap-2.5 rounded-full px-7 text-[15px] font-medium whitespace-nowrap",
        "transition-[background-color,color,box-shadow] duration-200 disabled:pointer-events-none disabled:opacity-50",
        variant === "solid"
          ? "bg-white text-ink shadow-[0_10px_40px_-10px_rgb(255_255_255/0.55)] hover:bg-white/90"
          : "glass text-white/90 hover:bg-white/12 hover:text-white",
        className,
      )}
      {...props}
    >
      {children}
    </motion.button>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-6 py-2.5">
      <div className="min-w-0">
        <label htmlFor={id} className="block cursor-pointer text-sm text-white/90">
          {label}
        </label>
        {description && <p className="mt-0.5 text-xs leading-relaxed text-white/45">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative flex h-6 w-10.5 shrink-0 items-center rounded-full px-0.75 transition-colors duration-300",
          checked ? "justify-end bg-white" : "justify-start bg-white/18",
        )}
      >
        <motion.span
          layout
          transition={spring}
          className={cx("size-4.5 rounded-full shadow-sm", checked ? "bg-ink" : "bg-white")}
        />
      </button>
    </div>
  );
}

/**
 * A two-or-more-way switch with a pill that slides to the selected option.
 * Animation props are applied to the frosted element itself: a frosted panel
 * inside a fading parent would lose its blur until the fade has finished.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
  ...motionProps
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
} & Pick<ComponentProps<typeof motion.div>, "initial" | "animate" | "transition" | "inert">) {
  const pillId = useId();

  // Radio buttons share one tab stop; the arrow keys move between them.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const index = options.findIndex((option) => option.value === value);
    const next = options[(index + step + options.length) % options.length];
    onChange(next.value);
    event.currentTarget.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus();
  };

  return (
    <motion.div
      role="radiogroup"
      aria-label={label}
      className={cx("glass inline-flex rounded-full p-1", className)}
      onKeyDown={onKeyDown}
      {...motionProps}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            data-value={option.value}
            onClick={() => onChange(option.value)}
            className={cx(
              "relative rounded-full px-4.5 py-2 text-[13px] font-medium transition-colors duration-300",
              selected ? "text-ink" : "text-white/65 hover:text-white",
            )}
          >
            {selected && (
              <motion.span
                layoutId={pillId}
                transition={spring}
                className="absolute inset-0 rounded-full bg-white shadow-[0_2px_12px_rgb(0_0_0/0.25)]"
              />
            )}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </motion.div>
  );
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  label,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  label: string;
  disabled?: boolean;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      aria-label={label}
      className="slider w-full"
      style={{ "--fill": `${fill}%` } as React.CSSProperties}
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}

/** A number with − and + buttons that can also be typed into. */
export function Stepper({
  value,
  min,
  max,
  onChange,
  label,
  unit,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
  unit: string;
}) {
  const id = useId();
  // While typing, the field may hold text that is not a valid value yet.
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (text: string) => {
    setDraft(null);
    const parsed = Number.parseInt(text, 10);
    if (Number.isFinite(parsed)) onChange(Math.min(max, Math.max(min, parsed)));
  };

  const stepButton =
    "grid size-8 place-items-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-30";

  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <label htmlFor={id} className="text-sm text-white/90">
        {label}
      </label>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={stepButton}
          aria-label={`Decrease ${label.toLowerCase()}`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
        >
          <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
            <path d="M3.5 8h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <div className="flex w-17 items-baseline justify-center gap-1">
          <input
            id={id}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            className="w-8 bg-transparent text-right text-[15px] tabular-nums text-white outline-none"
            value={draft ?? String(value)}
            onChange={(event) => setDraft(event.target.value.replace(/\D/g, "").slice(0, 3))}
            onBlur={(event) => commit(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "ArrowUp") onChange(Math.min(max, value + 1));
              if (event.key === "ArrowDown") onChange(Math.max(min, value - 1));
            }}
          />
          <span className="text-xs text-white/45">{unit}</span>
        </div>
        <button
          type="button"
          className={stepButton}
          aria-label={`Increase ${label.toLowerCase()}`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
        >
          <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
            <path d="M3.5 8h9M8 3.5v9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export { cx };
