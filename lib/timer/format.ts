/** Formatting helpers. Pure: anything time-zone dependent takes the dates it needs. */

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * A clock face such as `24:13` or `1:02:45`.
 * Stopwatches round down (the second has to be complete to count); countdowns
 * round up, so they start on the full duration and never linger on `00:00`.
 */
export function formatClock(ms: number, rounding: "down" | "up" = "down"): string {
  const safe = Math.max(0, ms);
  const total = rounding === "up" ? Math.ceil(safe / 1000) : Math.floor(safe / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export interface DurationPart {
  value: string;
  unit: "h" | "m" | "s";
}

/**
 * A duration as its two most significant units: `12h 05m`, `24m 13s`, `42s`.
 * Seconds are only shown below one hour, where they still matter.
 */
export function durationParts(totalSeconds: number): DurationPart[] {
  const total = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (hours > 0) {
    return [
      { value: hours.toLocaleString("en-US"), unit: "h" },
      { value: pad(minutes), unit: "m" },
    ];
  }
  if (minutes > 0) {
    return [
      { value: String(minutes), unit: "m" },
      { value: pad(seconds), unit: "s" },
    ];
  }
  return [{ value: String(seconds), unit: "s" }];
}

export function formatDuration(totalSeconds: number): string {
  return durationParts(totalSeconds)
    .map((part) => part.value + part.unit)
    .join(" ");
}

/** A duration read aloud by screen readers: `1 hour 5 minutes`. */
export function spokenDuration(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(totalSeconds));
  const units: [number, string][] = [
    [Math.floor(total / 3600), "hour"],
    [Math.floor((total % 3600) / 60), "minute"],
    [total % 60, "second"],
  ];
  const spoken = units
    .filter(([value]) => value > 0)
    .slice(0, 2)
    .map(([value, unit]) => `${value} ${unit}${value === 1 ? "" : "s"}`);
  return spoken.length > 0 ? spoken.join(" ") : "0 seconds";
}

/** Midnight (local time) of the day that contains `ms`. */
export function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** `Today`, `Yesterday`, or a date such as `Mon, 3 Nov` (with the year when it differs). */
export function dayLabel(dayStart: number, now: number): string {
  const today = startOfDay(now);
  if (dayStart === today) return "Today";
  if (dayStart === startOfDay(today - 1)) return "Yesterday";

  const date = new Date(dayStart);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" }),
  }).format(date);
}

export function timeOfDay(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(ms));
}
