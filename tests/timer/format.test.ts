import { describe, expect, it } from "vitest";

import {
  dayLabel,
  durationParts,
  formatClock,
  formatDuration,
  spokenDuration,
  startOfDay,
} from "../../lib/timer/format";

describe("formatClock", () => {
  it("rounds a stopwatch down", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(999)).toBe("00:00");
    expect(formatClock(1000)).toBe("00:01");
    expect(formatClock(59 * 60_000 + 59_999)).toBe("59:59");
    expect(formatClock(3_600_000)).toBe("1:00:00");
    expect(formatClock(100 * 3_600_000 + 5 * 60_000 + 9_000)).toBe("100:05:09");
    expect(formatClock(-5)).toBe("00:00");
  });

  it("rounds a countdown up", () => {
    expect(formatClock(25 * 60_000, "up")).toBe("25:00");
    expect(formatClock(25 * 60_000 - 1, "up")).toBe("25:00");
    expect(formatClock(1, "up")).toBe("00:01");
    expect(formatClock(0, "up")).toBe("00:00");
    expect(formatClock(90 * 60_000, "up")).toBe("1:30:00");
  });
});

describe("durations", () => {
  it("shows the two most significant units", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(42)).toBe("42s");
    expect(formatDuration(60)).toBe("1m 00s");
    expect(formatDuration(24 * 60 + 13)).toBe("24m 13s");
    expect(formatDuration(3599)).toBe("59m 59s");
    expect(formatDuration(3600)).toBe("1h 00m");
    expect(formatDuration(12 * 3600 + 5 * 60 + 59)).toBe("12h 05m");
    expect(formatDuration(1234 * 3600)).toBe("1,234h 00m");
    expect(formatDuration(-10)).toBe("0s");
    expect(formatDuration(59.9)).toBe("59s");
  });

  it("keeps value and unit apart for styling", () => {
    expect(durationParts(3725)).toEqual([
      { value: "1", unit: "h" },
      { value: "02", unit: "m" },
    ]);
  });

  it("can be read aloud", () => {
    expect(spokenDuration(0)).toBe("0 seconds");
    expect(spokenDuration(1)).toBe("1 second");
    expect(spokenDuration(3600)).toBe("1 hour");
    expect(spokenDuration(3725)).toBe("1 hour 2 minutes");
    expect(spokenDuration(125)).toBe("2 minutes 5 seconds");
  });
});

describe("days", () => {
  const now = new Date(2026, 10, 15, 14, 30).getTime();

  it("finds local midnight", () => {
    expect(new Date(startOfDay(now)).getHours()).toBe(0);
    expect(startOfDay(startOfDay(now))).toBe(startOfDay(now));
    expect(now - startOfDay(now)).toBe(14.5 * 3_600_000);
  });

  it("labels today, yesterday and older days", () => {
    expect(dayLabel(startOfDay(now), now)).toBe("Today");
    expect(dayLabel(startOfDay(now - 86_400_000), now)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 10, 3).getTime(), now)).toMatch(/3/);
    expect(dayLabel(new Date(2026, 10, 3).getTime(), now)).not.toMatch(/2026/);
    expect(dayLabel(new Date(2025, 11, 31).getTime(), now)).toMatch(/2025/);
  });
});
