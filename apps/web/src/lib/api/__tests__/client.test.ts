import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDetections,
  getEarthquakes,
  getFloodGauges,
  isErr,
  isOk,
  postDispatch,
  postPredictSpread,
} from "../client";

// We mock the global `fetch` rather than spinning up an MSW server. MSW isn't
// installed in this workspace and the deliverable is to verify the typed
// client's request shape and the graceful-fallback path when the backend is
// down — both achievable with a fetch spy.

interface MockResponseInit {
  ok?: boolean;
  status?: number;
  body?: unknown;
}

function makeResponse({ ok = true, status = 200, body = {} }: MockResponseInit = {}): Response {
  return {
    ok,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    json: async () => body,
  } as unknown as Response;
}

const BASE_URL = "http://api.test.local";

type FetchFn = typeof fetch;

describe("api client", () => {
  // We attach a vi.fn to globalThis.fetch and read off its `.mock.calls`
  // directly. Typed as a permissive wrapper so the assertions below remain
  // ergonomic.
  let fetchSpy: ReturnType<typeof vi.fn> & {
    mock: { calls: unknown[][] };
    mockResolvedValueOnce: (value: Response) => unknown;
    mockRejectedValueOnce: (reason: unknown) => unknown;
  };
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchSpy = vi.fn() as unknown as typeof fetchSpy;
    globalThis.fetch = fetchSpy as unknown as FetchFn;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("getDetections", () => {
    it("hits /detections and returns the typed payload on success", async () => {
      fetchSpy.mockResolvedValueOnce(
        makeResponse({ body: { incidents: [{ id: "abc" }] } }),
      );
      const result = await getDetections({ baseUrl: BASE_URL });
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data.incidents).toHaveLength(1);
      }
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const url = (fetchSpy.mock.calls[0]?.[0] ?? "") as string;
      expect(url).toBe(`${BASE_URL}/detections`);
    });

    it("appends bbox query params", async () => {
      fetchSpy.mockResolvedValueOnce(makeResponse({ body: { incidents: [] } }));
      await getDetections({
        baseUrl: BASE_URL,
        bbox: { lon0: -125, lat0: 32, lon1: -114, lat1: 42 },
      });
      const url = (fetchSpy.mock.calls[0]?.[0] ?? "") as string;
      expect(url).toBe(`${BASE_URL}/detections?bbox=-125,32,-114,42`);
    });

    it("retries once on network failure then returns an error", async () => {
      fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed"));
      fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed"));
      const result = await getDetections({ baseUrl: BASE_URL });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error).toMatch(/fetch failed/);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("recovers when the second attempt succeeds", async () => {
      fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed"));
      fetchSpy.mockResolvedValueOnce(makeResponse({ body: { incidents: [{ id: "x" }] } }));
      const result = await getDetections({ baseUrl: BASE_URL });
      expect(isOk(result)).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("does not retry on a 4xx", async () => {
      fetchSpy.mockResolvedValueOnce(makeResponse({ ok: false, status: 404, body: "not found" }));
      const result = await getDetections({ baseUrl: BASE_URL });
      expect(isErr(result)).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("postDispatch", () => {
    it("POSTs to /dispatch/{id} with json content-type", async () => {
      fetchSpy.mockResolvedValueOnce(
        makeResponse({
          body: { detection_id: "ig_1", status: "queued", eta_minutes: 7, station_id: "s1" },
        }),
      );
      const result = await postDispatch("ig_1", { baseUrl: BASE_URL });
      expect(isOk(result)).toBe(true);
      const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
      expect(init.method).toBe("POST");
      const headers = init.headers as Record<string, string>;
      expect(headers["content-type"]).toBe("application/json");
    });

    it("URL-encodes the detection id", async () => {
      fetchSpy.mockResolvedValueOnce(makeResponse({ body: { detection_id: "a/b", status: "ok" } }));
      await postDispatch("a/b", { baseUrl: BASE_URL });
      const url = (fetchSpy.mock.calls[0]?.[0] ?? "") as string;
      expect(url).toBe(`${BASE_URL}/dispatch/a%2Fb`);
    });

    it("surfaces backend errors", async () => {
      fetchSpy.mockResolvedValueOnce(makeResponse({ ok: false, status: 500, body: "boom" }));
      const result = await postDispatch("ig_1", { baseUrl: BASE_URL });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error).toMatch(/HTTP 500/);
    });
  });

  describe("postPredictSpread", () => {
    it("sends the predict-spread payload as JSON", async () => {
      fetchSpy.mockResolvedValueOnce(makeResponse({ body: { model_version: "v1" } }));
      await postPredictSpread(
        {
          detection_id: "00000000-0000-0000-0000-000000000000",
          hotspot: { type: "Point", coordinates: [-120.4, 38.7] },
        },
        { baseUrl: BASE_URL },
      );
      const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
      expect(JSON.parse(init.body as string).detection_id).toBe(
        "00000000-0000-0000-0000-000000000000",
      );
    });
  });

  describe("getEarthquakes / getFloodGauges", () => {
    it("getEarthquakes round-trips bbox+since", async () => {
      fetchSpy.mockResolvedValueOnce(
        makeResponse({ body: { type: "FeatureCollection", features: [] } }),
      );
      await getEarthquakes({
        baseUrl: BASE_URL,
        bbox: { lon0: -130, lat0: 30, lon1: -110, lat1: 50 },
        since: "2026-05-01T00:00:00Z",
      });
      const url = (fetchSpy.mock.calls[0]?.[0] ?? "") as string;
      expect(url).toContain("/earthquakes?bbox=-130%2C30%2C-110%2C50");
      expect(url).toContain("since=2026-05-01T00%3A00%3A00Z");
    });

    it("getFloodGauges defaults state to ca", async () => {
      fetchSpy.mockResolvedValueOnce(makeResponse({ body: { gauges: [] } }));
      await getFloodGauges({ baseUrl: BASE_URL });
      const url = (fetchSpy.mock.calls[0]?.[0] ?? "") as string;
      expect(url).toBe(`${BASE_URL}/floods/gauges?state=ca`);
    });

    it("returns ApiErr (no fallback) when the backend is unreachable", async () => {
      fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed"));
      fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed"));
      const result = await getFloodGauges({ baseUrl: BASE_URL });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        // Caller layer (hooks.ts) is responsible for substituting a fixture
        // fallback — the raw client just propagates the network error.
        expect(result.error).toMatch(/fetch failed/);
      }
    });
  });
});
