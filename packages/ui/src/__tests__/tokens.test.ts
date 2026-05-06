import { describe, expect, it } from "vitest";

import { cn } from "../cn.js";
import { tokens } from "../tokens.js";

describe("@sentry-max/ui shared primitives", () => {
  it("publishes verification tokens for every public incident status", () => {
    expect(Object.keys(tokens.verification).sort()).toEqual([
      "CREWS_ACTIVE",
      "EMERGING",
      "KNOWN_PRESCRIBED",
      "LIKELY_INDUSTRIAL",
      "UNREPORTED",
    ]);
  });

  it("merges conflicting Tailwind utility classes deterministically", () => {
    expect(cn("px-2 text-sm", false, ["px-4", "font-medium"])).toBe("text-sm px-4 font-medium");
  });
});
