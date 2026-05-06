// Contract test for the multi-modal resource ranker.

import { describe, it, expect } from "vitest";
import {
  ResourceCandidateSchema,
  type ResourceCandidate,
  rankResources,
} from "../src/dispatch.js";

const home: ResourceCandidate["home_base"] = {
  type: "Point",
  coordinates: [-120.5, 37.4],
};

function r(over: Partial<ResourceCandidate>): ResourceCandidate {
  return ResourceCandidateSchema.parse({
    resource_id: over.resource_id ?? "r1",
    kind: over.kind ?? "engine",
    name: over.name ?? "Eng-1",
    agency: over.agency ?? "Cal Fire",
    home_base: home,
    eta_seconds: over.eta_seconds ?? 600,
    distance_meters: over.distance_meters ?? 5000,
    cruise_speed_ms: over.cruise_speed_ms ?? 15,
    capabilities: over.capabilities ?? ["wildland-attack"],
    available: over.available ?? true,
  });
}

describe("rankResources", () => {
  it("filters out unavailable resources", () => {
    const ranked = rankResources({
      candidates: [r({ resource_id: "r1" }), r({ resource_id: "r2", available: false })],
      risk: "MODERATE",
      predicted6hAcres: 5,
    });
    expect(ranked).toHaveLength(1);
    expect(ranked[0].resource_id).toBe("r1");
  });

  it("on a CRITICAL fire prefers a helicopter over a closer engine", () => {
    const ranked = rankResources({
      candidates: [
        r({
          resource_id: "engine-near",
          kind: "engine",
          name: "Eng-1",
          eta_seconds: 540,
          capabilities: ["wildland-attack"],
        }),
        r({
          resource_id: "heli-far",
          kind: "helicopter",
          name: "H-101",
          eta_seconds: 720,
          capabilities: ["aerial-water-drop", "wildland-attack"],
        }),
      ],
      risk: "CRITICAL",
      predicted6hAcres: 200,
    });
    expect(ranked[0].kind).toBe("helicopter");
  });

  it("on a LOW small fire prefers the closer engine over a far helicopter", () => {
    const ranked = rankResources({
      candidates: [
        r({
          resource_id: "engine-near",
          kind: "engine",
          eta_seconds: 360,
          capabilities: ["wildland-attack", "structure-protection"],
        }),
        r({
          resource_id: "heli-far",
          kind: "helicopter",
          eta_seconds: 1200,
          capabilities: ["aerial-water-drop"],
        }),
      ],
      risk: "LOW",
      predicted6hAcres: 4,
    });
    expect(ranked[0].kind).toBe("engine");
  });

  it("ETA penalty dominates between two equal-capability ground resources", () => {
    const ranked = rankResources({
      candidates: [
        r({ resource_id: "fast", eta_seconds: 300, capabilities: ["wildland-attack"] }),
        r({ resource_id: "slow", eta_seconds: 1500, capabilities: ["wildland-attack"] }),
      ],
      risk: "MODERATE",
      predicted6hAcres: 10,
    });
    expect(ranked[0].resource_id).toBe("fast");
    expect(ranked[1].resource_id).toBe("slow");
  });

  it("schema rejects unknown kind", () => {
    expect(() =>
      ResourceCandidateSchema.parse({
        ...r({}),
        kind: "spaceship",
      }),
    ).toThrow();
  });
});
