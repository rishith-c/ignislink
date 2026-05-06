"use client";

// UnitRouteLine — a glowing dashed polyline from a unit's base station to the
// fire, split visually into a fully-opaque "traveled" segment and a faded
// "remaining" segment. Aerial routes arc over the terrain (CatmullRomCurve3
// with an elevated midpoint, matching the shape used by DispatchedUnit so the
// route line overlaps the unit's actual flight path). Ground routes ride the
// terrain surface and optionally sample a heightAt(x, z) callback.
//
// Small upward-pointing chevrons are drawn every ~25% of the path so the eye
// can read direction at a glance.

import { useMemo } from "react";
import { Line } from "@react-three/drei";
import * as THREE from "three";

interface UnitRouteLineProps {
  start: THREE.Vector3;
  end: THREE.Vector3;
  color: string;
  isAerial: boolean;
  /** 0..1 — fraction of the route already traveled. */
  progress: number;
  /** Optional terrain height sampler used to drape ground routes onto terrain. */
  heightAt?: (x: number, z: number) => number;
}

const AERIAL_SAMPLES = 64;
const GROUND_SAMPLES = 32;
const TICK_FRACTIONS = [0.25, 0.5, 0.75] as const;
const TICK_HALF_WIDTH = 0.18;
const TICK_HEIGHT = 0.22;

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function buildAerialCurve(start: THREE.Vector3, end: THREE.Vector3): THREE.CatmullRomCurve3 {
  // Match DispatchedUnit's curve: peak elevated to ~3.2 at the halfway mark.
  const peakY = 3.2;
  const mid = new THREE.Vector3(
    (start.x + end.x) * 0.5,
    Math.max(start.y, end.y, peakY),
    (start.z + end.z) * 0.5,
  );
  return new THREE.CatmullRomCurve3([start.clone(), mid, end.clone()], false, "catmullrom", 0.5);
}

function sampleAerial(start: THREE.Vector3, end: THREE.Vector3): THREE.Vector3[] {
  const curve = buildAerialCurve(start, end);
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= AERIAL_SAMPLES; i += 1) {
    points.push(curve.getPointAt(i / AERIAL_SAMPLES));
  }
  return points;
}

function sampleGround(
  start: THREE.Vector3,
  end: THREE.Vector3,
  heightAt?: (x: number, z: number) => number,
): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= GROUND_SAMPLES; i += 1) {
    const t = i / GROUND_SAMPLES;
    const x = start.x + (end.x - start.x) * t;
    const z = start.z + (end.z - start.z) * t;
    const baseY = start.y + (end.y - start.y) * t;
    const y = heightAt ? heightAt(x, z) + 0.05 : baseY;
    points.push(new THREE.Vector3(x, y, z));
  }
  return points;
}

interface SplitPoints {
  traveled: THREE.Vector3[];
  remaining: THREE.Vector3[];
}

function splitAtProgress(points: THREE.Vector3[], progress: number): SplitPoints {
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length < 2 || !first || !last) {
    return { traveled: points, remaining: points };
  }
  const p = clamp01(progress);
  if (p <= 0) {
    return { traveled: [first.clone(), first.clone()], remaining: points };
  }
  if (p >= 1) {
    return { traveled: points, remaining: [last.clone(), last.clone()] };
  }
  const segments = points.length - 1;
  const exact = p * segments;
  const idx = Math.floor(exact);
  const frac = exact - idx;
  const a = points[idx];
  const b = points[idx + 1];
  if (!a || !b) {
    return { traveled: points, remaining: [last.clone(), last.clone()] };
  }
  const split = new THREE.Vector3().lerpVectors(a, b, frac);
  const traveled = points.slice(0, idx + 1).map((v) => v.clone());
  traveled.push(split);
  const remaining: THREE.Vector3[] = [split.clone()];
  for (let i = idx + 1; i < points.length; i += 1) {
    const next = points[i];
    if (next) remaining.push(next.clone());
  }
  return { traveled, remaining };
}

interface Chevron {
  key: string;
  points: THREE.Vector3[];
}

function buildChevrons(points: THREE.Vector3[]): Chevron[] {
  if (points.length < 2) return [];
  const segments = points.length - 1;
  const chevrons: Chevron[] = [];
  for (const fraction of TICK_FRACTIONS) {
    const exact = fraction * segments;
    const idx = Math.min(segments - 1, Math.floor(exact));
    const tip = points[idx + 1];
    const tail = points[idx];
    if (!tip || !tail) continue;
    const dir = new THREE.Vector3().subVectors(tip, tail);
    if (dir.lengthSq() < 1e-6) continue;
    dir.normalize();
    // Perpendicular in the XZ plane.
    const perp = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    const center = new THREE.Vector3().lerpVectors(tail, tip, exact - idx);
    const back = new THREE.Vector3().copy(center).addScaledVector(dir, -TICK_HEIGHT);
    const left = new THREE.Vector3().copy(back).addScaledVector(perp, TICK_HALF_WIDTH);
    const right = new THREE.Vector3().copy(back).addScaledVector(perp, -TICK_HALF_WIDTH);
    // Three thin lines forming an upward arrowhead pointing toward `tip`.
    chevrons.push({
      key: `chev-${fraction}`,
      points: [left, center, right],
    });
  }
  return chevrons;
}

export function UnitRouteLine({
  start,
  end,
  color,
  isAerial,
  progress,
  heightAt,
}: UnitRouteLineProps) {
  const { traveled, remaining, chevrons } = useMemo(() => {
    const points = isAerial ? sampleAerial(start, end) : sampleGround(start, end, heightAt);
    const split = splitAtProgress(points, progress);
    return {
      traveled: split.traveled,
      remaining: split.remaining,
      chevrons: buildChevrons(points),
    };
  }, [start, end, isAerial, progress, heightAt]);

  return (
    <>
      <Line
        points={remaining}
        color={color}
        lineWidth={2}
        transparent
        opacity={0.35}
        dashed
        dashSize={0.4}
        gapSize={0.25}
        toneMapped={false}
      />
      <Line
        points={traveled}
        color={color}
        lineWidth={2}
        transparent
        opacity={1}
        toneMapped={false}
      />
      {chevrons.map((chevron) => (
        <Line
          key={chevron.key}
          points={chevron.points}
          color={color}
          lineWidth={1.5}
          transparent
          opacity={0.85}
          toneMapped={false}
        />
      ))}
    </>
  );
}
