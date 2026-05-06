"use client";

// Camera-distance-aware scale factor for dispatched-unit meshes.
//
// As the user zooms from a tactical close-up out to a regional bird's-eye
// view, small units (engines, helicopters) become visually pinprick-sized.
// This hook returns a multiplier that the integrator can apply to a unit
// group's scale so the unit always subtends at least `minPx` pixels on
// screen, while staying at `baseScale` when the camera is closer than
// `refDistance`.
//
// Usage (inside a component that's a child of <Canvas>):
//
//   const groupRef = useRef<THREE.Group>(null);
//   useFrame(() => {
//     const s = useUnitScale(1, 14, 30); // NB: see note below
//     groupRef.current?.scale.setScalar(s);
//   });
//
// NB: hooks must be called at component top-level, not inside useFrame. The
// integrator's pattern is:
//
//   function Unit() {
//     const groupRef = useRef<THREE.Group>(null);
//     const scale = useUnitScale(1, 14, 30);
//     useFrame(() => groupRef.current?.scale.setScalar(scale));
//     return <group ref={groupRef}>...</group>;
//   }

import { useThree } from "@react-three/fiber";
import { PerspectiveCamera } from "three";

const MAX_SCALE_MULTIPLIER = 4;

/**
 * Returns the scale multiplier a unit-mesh group should apply so it stays at
 * least `minPx` pixels on screen at the current camera distance.
 *
 * - When camera distance ≤ refDistance: returns `baseScale`.
 * - When camera distance > refDistance: scales linearly with distance,
 *   clamped to `MAX_SCALE_MULTIPLIER * baseScale`.
 *
 * @param baseScale   Multiplier when the camera is at or closer than refDistance.
 * @param minPx       Minimum on-screen pixel size the unit should subtend.
 *                    Treated as a hint — the linear ramp is calibrated against
 *                    a 14px reference at refDistance, so larger values make the
 *                    ramp steeper.
 * @param refDistance Camera distance below which no scaling kicks in.
 */
export function useUnitScale(
  baseScale = 1,
  minPx = 14,
  refDistance = 30,
): number {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls);
  const size = useThree((state) => state.size);

  // Determine the look-at target. When OrbitControls is active and made the
  // default camera, fiber stores it on `state.controls`. Otherwise fall back
  // to the world origin — which matches the simulator's default focus.
  const target =
    controls && "target" in controls && controls.target instanceof Object
      ? (controls.target as { x: number; y: number; z: number })
      : { x: 0, y: 0, z: 0 };

  const dx = camera.position.x - target.x;
  const dy = camera.position.y - target.y;
  const dz = camera.position.z - target.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (distance <= refDistance) {
    return baseScale;
  }

  // Linear ramp: at 2× refDistance, scale by ~2×; at 4×+ refDistance, clamp
  // to MAX_SCALE_MULTIPLIER. A perspective camera's vertical FOV and viewport
  // height let us refine the ramp so a unit at `distance` subtends at least
  // `minPx` pixels.
  let multiplier = distance / refDistance;

  if (camera instanceof PerspectiveCamera) {
    const fovRad = (camera.fov * Math.PI) / 180;
    const worldUnitsPerPixel =
      (2 * Math.tan(fovRad / 2) * distance) / Math.max(1, size.height);
    // Required world size for `minPx` pixels on screen at this distance.
    const requiredWorldSize = worldUnitsPerPixel * minPx;
    // Assume the unit's natural world size is ~1 unit (the integrator's
    // groupRef subtree). The pixel-aware multiplier preserves that minimum.
    const pixelAware = Math.max(1, requiredWorldSize);
    multiplier = Math.max(multiplier, pixelAware);
  }

  const clamped = Math.min(multiplier, MAX_SCALE_MULTIPLIER);
  return baseScale * clamped;
}
