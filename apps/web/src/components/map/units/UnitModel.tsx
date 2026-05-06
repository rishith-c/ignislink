"use client";

import { Helicopter } from "./Helicopter";
import { FireTruck } from "./FireTruck";
import { FixedWing } from "./FixedWing";
import { Dozer } from "./Dozer";
import { HandCrewJeep } from "./HandCrewJeep";

export type UnitKind = "helicopter" | "fixed-wing" | "engine" | "dozer" | "hand-crew";

interface UnitModelProps {
  kind: UnitKind;
  color: string;
  scale?: number;
}

/**
 * Picks the right procedural vehicle component for a given unit kind.
 * All sub-components render in local space at the origin facing +X
 * (except the helicopter, whose nose is at +X). The parent group is
 * responsible for translation/rotation along the flight path.
 */
export function UnitModel({ kind, color, scale = 1 }: UnitModelProps) {
  switch (kind) {
    case "helicopter":
      return <Helicopter color={color} scale={scale} />;
    case "fixed-wing":
      return <FixedWing color={color} scale={scale} />;
    case "engine":
      return <FireTruck color={color} scale={scale} />;
    case "dozer":
      return <Dozer color={color} scale={scale} />;
    case "hand-crew":
      return <HandCrewJeep color={color} scale={scale} />;
    default: {
      // Exhaustiveness check — TS will error if a new kind is added without a case.
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
