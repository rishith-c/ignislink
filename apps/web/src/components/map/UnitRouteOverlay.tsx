"use client";

// UnitRouteOverlay — composes a route polyline + ETA badge per in-flight unit.
// Designed to live at the scene root in FireSimulator3D so all geometry is in
// world space (no group transform).

import { useMemo } from "react";
import * as THREE from "three";

import { UnitRouteLine } from "./UnitRouteLine";
import { UnitRouteBadge, type UnitKind, type UnitStatus } from "./UnitRouteBadge";

export interface OverlayUnit {
  id: string;
  kind: UnitKind;
  name: string;
  color: string;
  basePos: THREE.Vector3;
  firePos: THREE.Vector3;
  currentPos: THREE.Vector3;
  isAerial: boolean;
  etaSeconds: number;
  totalDurationSec: number;
  status: UnitStatus;
}

interface UnitRouteOverlayProps {
  units: ReadonlyArray<OverlayUnit>;
  /** Optional terrain height sampler forwarded to ground routes. */
  heightAt?: (x: number, z: number) => number;
}

const AERIAL_BADGE_OFFSET_Y = 1.2;
const GROUND_BADGE_OFFSET_Y = 1.6;

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

interface PreparedUnit {
  unit: OverlayUnit;
  progress: number;
  badgePosition: [number, number, number];
}

export function UnitRouteOverlay({ units, heightAt }: UnitRouteOverlayProps) {
  // Memoize per-unit derived geometry inputs. The line itself memoizes on
  // (basePos, firePos, isAerial, progress) internally.
  const prepared = useMemo<PreparedUnit[]>(() => {
    return units.map((unit) => {
      const progress =
        unit.totalDurationSec > 0
          ? clamp01(1 - unit.etaSeconds / unit.totalDurationSec)
          : 1;
      const offsetY = unit.isAerial ? AERIAL_BADGE_OFFSET_Y : GROUND_BADGE_OFFSET_Y;
      const badgePosition: [number, number, number] = [
        unit.currentPos.x,
        unit.currentPos.y + offsetY,
        unit.currentPos.z,
      ];
      return { unit, progress, badgePosition };
    });
  }, [units]);

  return (
    <>
      {prepared.map(({ unit, progress, badgePosition }) => (
        <group key={unit.id}>
          <UnitRouteLine
            start={unit.basePos}
            end={unit.firePos}
            color={unit.color}
            isAerial={unit.isAerial}
            progress={progress}
            heightAt={heightAt}
          />
          <UnitRouteBadge
            position={badgePosition}
            kind={unit.kind}
            name={unit.name}
            etaSeconds={unit.etaSeconds}
            status={unit.status}
            color={unit.color}
          />
        </group>
      ))}
    </>
  );
}
