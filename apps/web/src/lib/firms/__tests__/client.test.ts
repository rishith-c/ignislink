import { describe, expect, it, vi } from "vitest";

import { fetchFirmsHotspots, parseFirmsCsv } from "../client";

const FIXTURE_CSV = `latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
38.6924,-120.4148,367.2,0.42,0.39,2026-05-01,2104,N20,VIIRS,h,2.0NRT,302.4,412.0,N
38.7019,-120.3942,358.7,0.43,0.40,2026-05-01,2104,N20,VIIRS,n,2.0NRT,298.3,318.5,N
38.6837,-120.4385,341.5,0.42,0.39,2026-05-01,2104,N20,VIIRS,l,2.0NRT,287.1,164.2,N
`;

const FIRMS_BBOX = {
  west: -120.5,
  south: 38.6,
  east: -120.3,
  north: 38.8,
};

describe("parseFirmsCsv", () => {
  it("parses well-formed FIRMS CSV rows into typed hotspots", () => {
    const rows = parseFirmsCsv(FIXTURE_CSV);
    expect(rows).toHaveLength(3);
    const first = rows[0]!;
    expect(first.latitude).toBeCloseTo(38.6924, 4);
    expect(first.longitude).toBeCloseTo(-120.4148, 4);
    expect(first.brightTi4).toBeCloseTo(367.2, 1);
    expect(first.frp).toBeCloseTo(412.0, 1);
    expect(first.confidence).toBe("high");
    expect(first.acqDate).toBe("2026-05-01");
    expect(first.acqTime).toBe("2104");
    expect(first.daynight).toBe("N");
  });

  it("buckets the three FIRMS confidence codes", () => {
    const rows = parseFirmsCsv(FIXTURE_CSV);
    const confs = rows.map((r) => r.confidence);
    expect(confs).toEqual(["high", "nominal", "low"]);
  });

  it("returns an empty list when the CSV is empty / malformed", () => {
    expect(parseFirmsCsv("")).toEqual([]);
    expect(parseFirmsCsv("oops\n")).toEqual([]);
    expect(parseFirmsCsv("latitude,longitude\nfoo,bar\n")).toEqual([]);
  });

  it("buckets numeric confidence (MODIS-style 0–100)", () => {
    const csv = `latitude,longitude,bright_ti4,acq_date,acq_time,confidence,frp,daynight
40.1,-121.0,300,2026-05-01,1100,90,50,D
40.2,-121.0,300,2026-05-01,1100,50,40,D
40.3,-121.0,300,2026-05-01,1100,10,30,D
`;
    const rows = parseFirmsCsv(csv);
    expect(rows.map((r) => r.confidence)).toEqual(["high", "nominal", "low"]);
  });
});

describe("fetchFirmsHotspots", () => {
  it("falls back to the bundled fixture when no API key is provided", async () => {
    const fakeFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url === "/firms-fixture.csv") {
        return new Response(FIXTURE_CSV, { status: 200 });
      }
      return new Response("nope", { status: 404 });
    });
    const result = await fetchFirmsHotspots({
      bbox: FIRMS_BBOX,
      apiKey: "",
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });
    expect(result.ok).toBe(true);
    expect(result.source).toBe("fixture");
    expect(result.error).toMatch(/FIRMS_API_KEY/);
    expect(result.hotspots).toHaveLength(3);
    expect(fakeFetch).toHaveBeenCalledWith("/firms-fixture.csv", expect.any(Object));
  });

  it("calls the live FIRMS endpoint when an API key is provided", async () => {
    const fakeFetch = vi.fn().mockResolvedValue(new Response(FIXTURE_CSV, { status: 200 }));
    const result = await fetchFirmsHotspots({
      bbox: FIRMS_BBOX,
      apiKey: "test-key",
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });
    expect(result.ok).toBe(true);
    expect(result.source).toBe("live");
    expect(result.hotspots).toHaveLength(3);
    const calledUrl = fakeFetch.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("firms.modaps.eosdis.nasa.gov");
    expect(calledUrl).toContain("test-key");
    expect(calledUrl).toContain("VIIRS_NOAA20_NRT");
    // bbox: west,south,east,north
    expect(calledUrl).toContain("-120.5000,38.6000,-120.3000,38.8000");
  });

  it("falls back to the fixture if the live request returns non-OK", async () => {
    const fakeFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("firms.modaps")) return new Response("err", { status: 503 });
      if (url === "/firms-fixture.csv") return new Response(FIXTURE_CSV, { status: 200 });
      return new Response("nope", { status: 404 });
    });
    const result = await fetchFirmsHotspots({
      bbox: FIRMS_BBOX,
      apiKey: "test-key",
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });
    expect(result.source).toBe("fixture");
    expect(result.error).toMatch(/HTTP 503/);
    expect(result.hotspots).toHaveLength(3);
  });

  it("accepts an inline fixtureCsv override (used by the embedded fallback)", async () => {
    const result = await fetchFirmsHotspots({
      bbox: FIRMS_BBOX,
      apiKey: "",
      fixtureCsv: FIXTURE_CSV,
    });
    expect(result.ok).toBe(true);
    expect(result.source).toBe("fixture");
    expect(result.hotspots).toHaveLength(3);
  });
});
