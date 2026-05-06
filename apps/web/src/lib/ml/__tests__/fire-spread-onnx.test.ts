/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { disposeFireSpreadSession, runFireSpread } from "../fire-spread-onnx";

const ORIGINAL_FETCH = globalThis.fetch;

describe("runFireSpread (graceful degradation)", () => {
  beforeEach(() => {
    disposeFireSpreadSession();
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
    disposeFireSpreadSession();
  });

  it("rejects with a friendly error when the ONNX file is missing (HEAD 404)", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(null, { status: 404, statusText: "Not Found" }),
    ) as unknown as typeof fetch;
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const input = new Float32Array(1 * 4 * 14 * 8 * 8);
    await expect(
      runFireSpread(input, [1, 4, 14, 8, 8]),
    ).rejects.toThrow(/ONNX model not found/i);

    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringMatching(/falling back to CA-only/i),
    );
  });

  it("rejects with a friendly error when fetch fails entirely (network error)", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const input = new Float32Array(1 * 4 * 14 * 8 * 8);
    await expect(
      runFireSpread(input, [1, 4, 14, 8, 8]),
    ).rejects.toThrow(/ONNX model not found/i);
  });
});
