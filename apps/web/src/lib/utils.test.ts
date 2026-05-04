import { describe, expect, it } from "vitest";

import { cn, formatRelativeTime } from "./utils";

describe("web utility helpers", () => {
  it("merges Tailwind utility conflicts through cn()", () => {
    expect(cn("rounded-md px-2", "px-4", false)).toBe("rounded-md px-4");
  });

  it("formats relative incident timestamps for the queue", () => {
    const now = new Date("2026-05-02T16:15:00.000Z");

    expect(formatRelativeTime("2026-05-02T16:14:15.000Z", now)).toBe("45s ago");
    expect(formatRelativeTime("2026-05-02T16:05:00.000Z", now)).toBe("10m ago");
    expect(formatRelativeTime("2026-05-02T13:15:00.000Z", now)).toBe("3h ago");
    expect(formatRelativeTime("2026-04-30T16:15:00.000Z", now)).toBe("2d ago");
  });
});
