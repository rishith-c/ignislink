"use client";

// Atmospheric scene wrapper for the SENTRY 3D fire simulator.
//
// Provides the Apple-Maps-pale-blue-noon look:
//   - drei <Sky /> with tuned turbidity / rayleigh / mie params
//   - 8 soft <Cloud /> instances drifting above the terrain (wrapped at ±60)
//   - exponential-squared fog for subtle atmospheric haze that does NOT
//     occlude distant mountains at max zoom-out
//   - directional sun + ambient fill
//   - optional <Sparkles /> ash drift (off by default)
//
// Render this as a child of <Canvas>. It does not own the camera or the
// terrain — it is purely scene-decoration.

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Sky, Cloud, Sparkles } from "@react-three/drei";
import * as THREE from "three";

interface AtmosphericLayerProps {
  /** World-space sun position. Drives both the Sky shader and the directional light. */
  sunPosition?: readonly [number, number, number];
  /** 0..1 multiplier on cloud opacity. */
  cloudDensity?: number;
  /** Exponential-squared fog density. Keep small (<0.001) so far mountains stay visible. */
  fogDensity?: number;
  /** When true, render subtle floating ash particles. */
  showAsh?: boolean;
}

interface CloudConfig {
  position: readonly [number, number, number];
  scale: number;
  opacity: number;
  seed: number;
  speed: number;
}

// Hand-placed clouds so they form a pleasant scatter across the terrain
// rather than a uniform grid. y stays in the 12..20 band — high enough to
// never intersect the tallest ridges.
const CLOUD_LAYOUT: ReadonlyArray<CloudConfig> = [
  { position: [-30, 14, -20], scale: 8, opacity: 0.6, seed: 1, speed: 0.18 },
  { position: [10, 18, -30], scale: 6, opacity: 0.5, seed: 2, speed: 0.22 },
  { position: [25, 13, -8], scale: 4, opacity: 0.55, seed: 3, speed: 0.16 },
  { position: [-15, 19, 12], scale: 9, opacity: 0.65, seed: 4, speed: 0.14 },
  { position: [20, 15, 20], scale: 5, opacity: 0.5, seed: 5, speed: 0.2 },
  { position: [-35, 16, 25], scale: 7, opacity: 0.55, seed: 6, speed: 0.17 },
  { position: [0, 20, 35], scale: 10, opacity: 0.7, seed: 7, speed: 0.15 },
  { position: [40, 17, 5], scale: 3, opacity: 0.45, seed: 8, speed: 0.24 },
];

const CLOUD_DRIFT_PER_FRAME = 0.02;
const CLOUD_WRAP_BOUND = 60;

const FOG_COLOR = "#9fb6c8"; // Apple Maps pale blue haze.

/**
 * Renders the sky, fog, sun, and soft drifting clouds. Place inside a
 * <Canvas /> alongside (or instead of) any existing scene lighting.
 */
export function AtmosphericLayer({
  sunPosition = [50, 80, 30],
  cloudDensity = 0.6,
  fogDensity = 0.0008,
  showAsh = false,
}: AtmosphericLayerProps) {
  const cloudGroup = useRef<THREE.Group>(null);

  // Pre-compute per-cloud opacities scaled by `cloudDensity`. We clamp to
  // [0, 1] just in case the integrator passes >1.
  const clouds = useMemo<ReadonlyArray<CloudConfig>>(() => {
    const factor = Math.max(0, Math.min(1.5, cloudDensity));
    return CLOUD_LAYOUT.map((c) => ({
      ...c,
      opacity: Math.max(0, Math.min(1, c.opacity * factor)),
    }));
  }, [cloudDensity]);

  // Drift clouds along +X. When a cloud passes the right wrap bound, snap it
  // back to the left so the layer is effectively endless.
  useFrame(() => {
    const group = cloudGroup.current;
    if (!group) return;
    for (const child of group.children) {
      child.position.x += CLOUD_DRIFT_PER_FRAME;
      if (child.position.x > CLOUD_WRAP_BOUND) {
        child.position.x = -CLOUD_WRAP_BOUND;
      }
    }
  });

  return (
    <>
      <Sky
        distance={450000}
        turbidity={6}
        rayleigh={1.5}
        mieCoefficient={0.005}
        mieDirectionalG={0.85}
        sunPosition={sunPosition}
      />

      <fogExp2 attach="fog" args={[FOG_COLOR, fogDensity]} />

      <ambientLight intensity={0.35} />

      <directionalLight
        position={sunPosition}
        intensity={1.6}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={1}
        shadow-camera-far={300}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={80}
        shadow-camera-bottom={-80}
        shadow-bias={-0.0005}
      />

      <group ref={cloudGroup}>
        {clouds.map((c) => (
          <Cloud
            key={c.seed}
            seed={c.seed}
            position={c.position}
            scale={c.scale}
            opacity={c.opacity}
            speed={c.speed}
            growth={4}
            segments={20}
            color="#ffffff"
          />
        ))}
      </group>

      {showAsh ? (
        <Sparkles
          count={120}
          scale={[60, 8, 60]}
          size={1.2}
          speed={0.2}
          opacity={0.4}
          color="#ffd9a8"
        />
      ) : null}
    </>
  );
}
