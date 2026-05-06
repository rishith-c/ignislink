"use client";

// 3D fire-spread visualizer — v3 (multi-fire FIRMS hotspots).
//
// New in v3:
//   - Multi-hotspot ignition. Each FIRMS hotspot in the input bbox seeds
//     the CA mask at its own (x, z) location, scaled by FRP so brighter
//     hotspots ignite a wider initial cluster.
//   - Per-hotspot ember + smoke clusters. Each seed gets its own animated
//     embers and smoke column rather than a single column at the origin.
//   - Camera tour mode. When `tourMode` is enabled the camera auto-pans
//     between hotspots (4s per stop, ease-out), with a small TourControls
//     overlay that shows "i / N · label" and prev/next/pause buttons.
//
// What's still here from v2:
//   - Wind-biased CA spread (pgermon/wildfire rule table on a CPU 96² grid).
//   - Procedural terrain (sum-of-sines value-noise replacement).
//   - Animated dispatched units along a CatmullRomCurve3.
//   - Cinematic intro that pulls the camera in over 2.5s on mount.
//
// Refs:
//   https://github.com/pgermon/wildfire (CA wind-biased rule table)
//   https://github.com/andrewkchan/fire-simulation (GPGPU CA pattern)
//   https://github.com/vasturiano/r3f-globe (label/path animation patterns)
//   https://threejs.org/docs/#api/en/extras/curves/CatmullRomCurve3

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Text, Billboard, Stars } from "@react-three/drei";
import * as THREE from "three";

import {
  DEFAULT_TERRAIN_SIZE,
  projectLatLon,
  type ProjectedHotspot,
} from "@/lib/firms/project";
import type { FirmsBbox } from "@/lib/firms/client";

interface ResourceMarker {
  id: string;
  kind: "engine" | "helicopter" | "fixed-wing" | "dozer" | "hand-crew";
  bearingDeg: number;
  distanceKm: number;
  etaMinutes: number;
  /** Optional human-readable unit identifier (e.g., "E-28", "H-301"). */
  name?: string;
  /** Optional base/station name (e.g., "Pollock Pines Station 28"). */
  baseName?: string;
}

interface Landmark {
  x: number;
  z: number;
  label: string;
  kind: "city" | "ridge" | "water" | "highway";
}

export interface FireHotspotInput {
  lat: number;
  lon: number;
  frp: number;
  confidence?: "low" | "nominal" | "high";
  label?: string;
  id?: string;
  brightTi4?: number;
}

interface FireSimulator3DProps {
  windDirDeg: number;
  windSpeedMs: number;
  predicted1hAcres?: number;
  predicted6hAcres?: number;
  predicted24hAcres?: number;
  risk?: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  resources?: ResourceMarker[];
  landmarks?: Landmark[];
  lowDetail?: boolean;
  /** Real FIRMS hotspots to plant in the scene as multi-fire ignitions.
   *  When omitted/empty, the legacy single-fire seed at the origin is used. */
  hotspots?: FireHotspotInput[];
  /** Bbox used to project hotspots into the (-S/2..S/2) terrain extent. */
  bbox?: FirmsBbox;
  /** When true, the camera auto-tours between hotspots (4s each, ease-out). */
  tourMode?: boolean;
}

const TERRAIN_SIZE = DEFAULT_TERRAIN_SIZE;
const TERRAIN_RES = 96;

const RISK_COLORS: Record<NonNullable<FireSimulator3DProps["risk"]>, [number, number, number]> = {
  LOW: [1.0, 0.86, 0.45],
  MODERATE: [1.0, 0.62, 0.22],
  HIGH: [1.0, 0.36, 0.12],
  CRITICAL: [1.0, 0.18, 0.05],
};

const DEFAULT_LANDMARKS: Landmark[] = [
  { x: -8, z: -10, label: "Pollock Pines", kind: "city" },
  { x: 12, z: -6, label: "Camino", kind: "city" },
  { x: -14, z: 6, label: "Sly Park Reservoir", kind: "water" },
  { x: 6, z: 14, label: "US-50", kind: "highway" },
  { x: 14, z: 12, label: "Carson Ridge", kind: "ridge" },
];

// ─────────────── Terrain heightmap ───────────────

function smoothNoise(x: number, z: number): number {
  return (
    0.55 * Math.sin(x * 0.9 + Math.cos(z * 0.7) * 1.4) +
    0.32 * Math.cos(z * 1.3 + x * 0.4) +
    0.22 * Math.sin((x + z) * 1.7) +
    0.14 * Math.sin(x * 3.2 + z * 2.6) +
    0.08 * Math.cos(z * 5.1 - x * 4.0)
  );
}

function buildHeightmap(): Float32Array {
  const h = new Float32Array(TERRAIN_RES * TERRAIN_RES);
  for (let j = 0; j < TERRAIN_RES; j++) {
    for (let i = 0; i < TERRAIN_RES; i++) {
      const x = (i / (TERRAIN_RES - 1)) * 2 - 1;
      const z = (j / (TERRAIN_RES - 1)) * 2 - 1;
      const r = Math.sqrt(x * x + z * z);
      const ridges = smoothNoise(x * 1.2, z * 1.2) * 0.45;
      const fineDetail = smoothNoise(x * 4.0, z * 4.0) * 0.08;
      const slopeBias = z * 0.18;
      const fireBasin = -0.52 * Math.exp(-r * 1.4);
      h[j * TERRAIN_RES + i] = ridges + fineDetail + slopeBias + fireBasin;
    }
  }
  return h;
}

// ─────────────── Fire-spread CA (multi-seed) ───────────────

/**
 * Build the fire grid. When `seeds` is provided we plant a seed cluster at
 * each one; otherwise we fall back to a single 3×3 seed at the centre.
 *
 * Seed radius and intensity scale with FRP so brighter hotspots start
 * hotter and wider. Mapping is compressed (sqrt) so a 400 MW hotspot
 * doesn't dominate a 50 MW one too aggressively.
 */
export function buildFireGrid(
  seeds?: ReadonlyArray<{ x: number; z: number; frp: number }>,
): Float32Array {
  const g = new Float32Array(TERRAIN_RES * TERRAIN_RES);
  if (!seeds || seeds.length === 0) {
    const c = Math.floor(TERRAIN_RES / 2);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        g[(c + dy) * TERRAIN_RES + (c + dx)] = 0.85;
      }
    }
    return g;
  }
  const half = TERRAIN_SIZE / 2;
  for (const seed of seeds) {
    const i = Math.round(((seed.x + half) / TERRAIN_SIZE) * (TERRAIN_RES - 1));
    const j = Math.round(((seed.z + half) / TERRAIN_SIZE) * (TERRAIN_RES - 1));
    if (i < 0 || i >= TERRAIN_RES || j < 0 || j >= TERRAIN_RES) continue;
    const frpScale = Math.max(0.4, Math.min(1.5, Math.sqrt(seed.frp || 1) / 18));
    const radius = Math.max(1, Math.round(1 + frpScale * 1.6));
    const peak = 0.55 + Math.min(0.4, frpScale * 0.32);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const ii = i + dx;
        const jj = j + dy;
        if (ii < 0 || ii >= TERRAIN_RES || jj < 0 || jj >= TERRAIN_RES) continue;
        const r = Math.hypot(dx, dy);
        if (r > radius) continue;
        const fall = 1 - r / (radius + 0.0001);
        const v = peak * fall;
        const idx = jj * TERRAIN_RES + ii;
        if (v > (g[idx] ?? 0)) g[idx] = v;
      }
    }
  }
  return g;
}

/**
 * OR a list of FIRMS hotspot seeds into an existing fire grid. The mask is
 * combined as max(existing, new) per cell so a tour-restart isn't
 * destructive to in-flight burning cells.
 */
export function ignitionMaskFromHotspots(
  grid: Float32Array,
  seeds: ReadonlyArray<{ x: number; z: number; frp: number }>,
): void {
  const seeded = buildFireGrid(seeds);
  for (let i = 0; i < grid.length; i++) {
    const a = grid[i] ?? 0;
    const b = seeded[i] ?? 0;
    if (b > a) grid[i] = b;
  }
}

function stepFire(grid: Float32Array, windX: number, windZ: number, rng: () => number): void {
  const next = new Float32Array(grid.length);
  const wMag = Math.min(0.55, Math.hypot(windX, windZ) * 0.04);
  const wxNorm = wMag === 0 ? 0 : (windX / Math.hypot(windX, windZ)) || 0;
  const wzNorm = wMag === 0 ? 0 : (windZ / Math.hypot(windX, windZ)) || 0;
  for (let j = 1; j < TERRAIN_RES - 1; j++) {
    for (let i = 1; i < TERRAIN_RES - 1; i++) {
      const idx = j * TERRAIN_RES + i;
      const cur = grid[idx]!;
      if (cur >= 1.0) {
        next[idx] = 1.0;
        continue;
      }
      let influence = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const n = grid[(j + dy) * TERRAIN_RES + (i + dx)]!;
          if (n <= 0 || n >= 1) continue;
          const len = Math.hypot(dx, dy);
          const align = -((dx / len) * wxNorm + (dy / len) * wzNorm);
          const weight = 0.55 + 0.45 * Math.max(-0.4, align);
          influence += n * weight * (0.5 + wMag);
        }
      }
      const ignitePressure = influence / 8;
      let nv = cur;
      if (cur === 0 && ignitePressure > 0.18 + rng() * 0.06) {
        nv = 0.45 + rng() * 0.2;
      } else if (cur > 0 && cur < 1) {
        nv = Math.min(1.0, cur + 0.018 + rng() * 0.012);
      }
      next[idx] = nv;
    }
  }
  grid.set(next);
}

function fireGridToTexture(grid: Float32Array): THREE.DataTexture {
  const data = new Uint8Array(TERRAIN_RES * TERRAIN_RES * 4);
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i]!;
    if (v === 0) {
      data[i * 4] = 0;
      data[i * 4 + 1] = 0;
      data[i * 4 + 2] = 0;
      data[i * 4 + 3] = 0;
    } else if (v < 1) {
      data[i * 4] = Math.round(255 * (1 - v * 0.5));
      data[i * 4 + 1] = Math.round(255 * 0.45 * (1 - v));
      data[i * 4 + 2] = Math.round(255 * 0.05);
      data[i * 4 + 3] = 230;
    } else {
      data[i * 4] = 30;
      data[i * 4 + 1] = 18;
      data[i * 4 + 2] = 12;
      data[i * 4 + 3] = 230;
    }
  }
  const tex = new THREE.DataTexture(data, TERRAIN_RES, TERRAIN_RES, THREE.RGBAFormat);
  tex.flipY = false;
  tex.needsUpdate = true;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

function Terrain({
  fireGridRef,
  windDirDeg,
  windSpeedMs,
}: {
  fireGridRef: React.MutableRefObject<Float32Array>;
  windDirDeg: number;
  windSpeedMs: number;
}) {
  const fireMatRef = useRef<THREE.MeshBasicMaterial>(null!);
  const stepCounter = useRef(0);
  const rngState = useRef(1);
  const rng = useMemo(
    () => () => {
      let t = (rngState.current += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    [],
  );

  const heightmap = useMemo(buildHeightmap, []);
  const terrainGeo = useMemo(() => {
    const geo = new THREE.PlaneGeometry(
      TERRAIN_SIZE,
      TERRAIN_SIZE,
      TERRAIN_RES - 1,
      TERRAIN_RES - 1,
    );
    const pos = geo.attributes.position!;
    for (let i = 0; i < pos.count; i++) {
      pos.setZ(i, heightmap[i]!);
    }
    geo.computeVertexNormals();
    return geo;
  }, [heightmap]);

  const fireGeo = useMemo(() => {
    const geo = terrainGeo.clone();
    const pos = geo.attributes.position!;
    for (let i = 0; i < pos.count; i++) {
      pos.setZ(i, heightmap[i]! + 0.005);
    }
    return geo;
  }, [heightmap, terrainGeo]);

  const initialTex = useMemo(() => fireGridToTexture(fireGridRef.current), [fireGridRef]);

  useFrame((_, dt) => {
    stepCounter.current += dt;
    if (stepCounter.current >= 0.08) {
      stepCounter.current = 0;
      const windRad = (windDirDeg * Math.PI) / 180;
      const windX = Math.sin(windRad) * windSpeedMs;
      const windZ = -Math.cos(windRad) * windSpeedMs;
      stepFire(fireGridRef.current, windX, windZ, rng);
      const tex = fireGridToTexture(fireGridRef.current);
      if (fireMatRef.current) {
        fireMatRef.current.map?.dispose();
        fireMatRef.current.map = tex;
        fireMatRef.current.needsUpdate = true;
      }
    }
  });

  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      <mesh geometry={terrainGeo} receiveShadow>
        <meshStandardMaterial color="#1a1a1a" roughness={0.95} metalness={0} flatShading />
      </mesh>
      <mesh geometry={fireGeo}>
        <meshBasicMaterial
          ref={fireMatRef}
          map={initialTex}
          transparent
          opacity={0.95}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

// ─────────────── Embers + smoke ───────────────

function Embers({
  windDirDeg,
  windSpeedMs,
  riskColor,
  count,
}: {
  windDirDeg: number;
  windSpeedMs: number;
  riskColor: [number, number, number];
  count: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const state = useMemo(
    () =>
      new Array(count).fill(null).map(() => ({
        x: (Math.random() - 0.5) * 0.4,
        y: Math.random() * 0.2,
        z: (Math.random() - 0.5) * 0.4,
        vy: 0.3 + Math.random() * 0.6,
        life: Math.random(),
        ttl: 1.4 + Math.random() * 2.0,
      })),
    [count],
  );
  const windRad = (windDirDeg * Math.PI) / 180;
  const wScale = Math.min(0.55, windSpeedMs * 0.06);
  const windX = Math.sin(windRad) * wScale;
  const windZ = -Math.cos(windRad) * wScale;
  useFrame((_, dt) => {
    if (!meshRef.current) return;
    for (let i = 0; i < count; i++) {
      const p = state[i];
      if (!p) continue;
      p.life += dt;
      if (p.life > p.ttl) {
        p.x = (Math.random() - 0.5) * 0.4;
        p.y = 0.05;
        p.z = (Math.random() - 0.5) * 0.4;
        p.vy = 0.3 + Math.random() * 0.7;
        p.life = 0;
        p.ttl = 1.4 + Math.random() * 2.2;
      }
      p.x += windX * dt;
      p.z += windZ * dt;
      p.y += p.vy * dt;
      p.vy *= 1 - dt * 0.4;
      const t = p.life / p.ttl;
      const scale = (1 - t) * 0.05 + 0.015;
      dummy.position.set(p.x, p.y, p.z);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
      const fade = 1 - t;
      meshRef.current.setColorAt(
        i,
        new THREE.Color(riskColor[0] * fade + 0.05 * t, riskColor[1] * fade, riskColor[2] * fade),
      );
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 6, 6]} />
      <meshBasicMaterial
        transparent
        opacity={0.85}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </instancedMesh>
  );
}

function SmokeColumn({ windDirDeg, windSpeedMs }: { windDirDeg: number; windSpeedMs: number }) {
  const group = useRef<THREE.Group>(null!);
  const layers = 6;
  const windRad = (windDirDeg * Math.PI) / 180;
  const drift = Math.min(2.0, windSpeedMs * 0.18);
  useFrame(({ clock }) => {
    if (!group.current) return;
    const t = clock.getElapsedTime();
    group.current.children.forEach((c, i) => {
      const phase = i / layers;
      c.position.set(
        Math.sin(windRad) * drift * phase + Math.sin(t + i) * 0.05,
        0.3 + i * 0.5 + Math.sin(t * 0.6 + i) * 0.04,
        -Math.cos(windRad) * drift * phase + Math.cos(t + i) * 0.05,
      );
    });
  });
  return (
    <group ref={group}>
      {Array.from({ length: layers }).map((_, i) => (
        <mesh key={i}>
          <sphereGeometry args={[0.45 + i * 0.16, 12, 12]} />
          <meshBasicMaterial
            color="#1c1c1f"
            transparent
            opacity={0.16 - i * 0.018}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

function SpreadRings({
  predicted1hAcres,
  predicted6hAcres,
  predicted24hAcres,
}: {
  predicted1hAcres?: number;
  predicted6hAcres?: number;
  predicted24hAcres?: number;
}) {
  const ringFor = (acres: number | undefined) => {
    if (!acres || acres <= 0) return null;
    const radiusM = Math.sqrt((acres * 4047) / Math.PI);
    return radiusM / 125;
  };
  const r1 = ringFor(predicted1hAcres);
  const r6 = ringFor(predicted6hAcres);
  const r24 = ringFor(predicted24hAcres);
  return (
    <group rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
      {r1 !== null && (
        <mesh>
          <ringGeometry args={[r1 * 0.95, r1, 64]} />
          <meshBasicMaterial color="#fde68a" transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
      )}
      {r6 !== null && (
        <mesh>
          <ringGeometry args={[r6 * 0.97, r6, 64]} />
          <meshBasicMaterial color="#fb923c" transparent opacity={0.4} side={THREE.DoubleSide} />
        </mesh>
      )}
      {r24 !== null && (
        <mesh>
          <ringGeometry args={[r24 * 0.98, r24, 64]} />
          <meshBasicMaterial color="#dc2626" transparent opacity={0.32} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

// ─────────────── Landmarks ───────────────

function Landmarks({
  landmarks,
  showIncident = true,
}: {
  landmarks: Landmark[];
  showIncident?: boolean;
}) {
  return (
    <group>
      {landmarks.map((lm, i) => (
        <Billboard key={i} position={[lm.x, 0.6, lm.z]} follow>
          <Text
            fontSize={0.4}
            color={
              lm.kind === "city"
                ? "#ffffff"
                : lm.kind === "water"
                  ? "#7dd3fc"
                  : lm.kind === "highway"
                    ? "#fde68a"
                    : "#a3a3a3"
            }
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.025}
            outlineColor="#000000"
            material-toneMapped={false}
          >
            {lm.label}
          </Text>
        </Billboard>
      ))}
      {showIncident && (
        <Billboard position={[0, 1.4, 0]} follow>
          <Text
            fontSize={0.5}
            color="#fb923c"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.04}
            outlineColor="#000000"
            material-toneMapped={false}
          >
            INCIDENT
          </Text>
        </Billboard>
      )}
    </group>
  );
}

function HotspotLabels({ hotspots }: { hotspots: ProjectedHotspot[] }) {
  return (
    <group>
      {hotspots.map((h, i) => (
        <Billboard key={h.id} position={[h.x, 1.4, h.z]} follow>
          <Text
            fontSize={0.42}
            color="#fb923c"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.04}
            outlineColor="#000000"
            material-toneMapped={false}
          >
            {h.label ?? `IGNITION ${i + 1}`}
          </Text>
        </Billboard>
      ))}
    </group>
  );
}

// ─────────────── Web Audio "beep" hook ───────────────

function playBeep(freq = 880, durationMs = 220): void {
  try {
    const ctx = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durationMs / 1000 + 0.05);
    osc.onended = () => ctx.close();
  } catch {
    /* no-op — AudioContext not available */
  }
}

// ─────────────── Fire-station base marker ───────────────

function StationBase({
  position,
  name,
  color,
  isAerial,
}: {
  position: THREE.Vector3;
  name: string;
  color: string;
  isAerial: boolean;
}) {
  return (
    <group position={[position.x, isAerial ? 0.25 : 0.05, position.z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.32, 0.42, 24]} />
        <meshBasicMaterial color={color} transparent opacity={0.55} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
        <circleGeometry args={[0.32, 24]} />
        <meshBasicMaterial color={color} transparent opacity={0.18} />
      </mesh>
      <mesh position={[0, 0.4, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.8, 6]} />
        <meshBasicMaterial color={color} transparent opacity={0.6} />
      </mesh>
      <mesh position={[0, 0.85, 0]}>
        <sphereGeometry args={[0.06, 10, 10]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <Billboard position={[0, 1.05, 0]} follow>
        <Text
          fontSize={0.18}
          color="#e5e5e5"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.018}
          outlineColor="#000000"
          material-toneMapped={false}
        >
          {name}
        </Text>
      </Billboard>
    </group>
  );
}

// ─────────────── Animated dispatched units ───────────────

function DispatchedUnit({ res }: { res: ResourceMarker }) {
  const groupRef = useRef<THREE.Group>(null!);
  const tStart = useRef<number | null>(null);
  const beeped = useRef(false);
  const isAerial = res.kind === "helicopter" || res.kind === "fixed-wing";

  const { curve, basePos } = useMemo(() => {
    const angleRad = (res.bearingDeg * Math.PI) / 180;
    const distUnits = Math.min(18, (res.distanceKm * 1000) / 125);
    const bx = Math.sin(angleRad) * distUnits;
    const bz = -Math.cos(angleRad) * distUnits;
    const peakY = isAerial ? 3.2 : 0.4;
    const start = new THREE.Vector3(bx, isAerial ? 1.2 : 0.2, bz);
    const mid = new THREE.Vector3(bx * 0.5, peakY, bz * 0.5);
    const end = new THREE.Vector3(0, isAerial ? 0.8 : 0.15, 0);
    return {
      curve: new THREE.CatmullRomCurve3([start, mid, end], false, "catmullrom", 0.5),
      basePos: new THREE.Vector3(bx, 0, bz),
    };
  }, [res.bearingDeg, res.distanceKm, isAerial]);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    if (tStart.current === null) tStart.current = clock.getElapsedTime();
    const sceneDuration = Math.max(4, res.etaMinutes / 4);
    const elapsed = clock.getElapsedTime() - tStart.current;
    const t = Math.min(1, elapsed / sceneDuration);
    const tEased = 1 - Math.pow(1 - t, 2.5);
    const pos = curve.getPointAt(tEased);
    groupRef.current.position.copy(pos);
    if (!beeped.current && t >= 0.95) {
      beeped.current = true;
      const freq = isAerial ? 1100 : res.kind === "dozer" ? 540 : 760;
      playBeep(freq, 240);
    }
  });

  const color =
    res.kind === "helicopter"
      ? "#22d3ee"
      : res.kind === "fixed-wing"
        ? "#a78bfa"
        : res.kind === "dozer"
          ? "#fbbf24"
          : res.kind === "hand-crew"
            ? "#34d399"
            : "#60a5fa";

  const baseLabel = res.baseName ?? (isAerial ? `${res.kind.toUpperCase()} BASE` : "STATION");
  const unitLabel = res.name ?? `${res.kind.toUpperCase()}`;

  return (
    <>
      <StationBase position={basePos} name={baseLabel} color={color} isAerial={isAerial} />
      <group ref={groupRef}>
        <mesh>
          <sphereGeometry args={[isAerial ? 0.18 : 0.12, 12, 12]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
        <pointLight color={color} intensity={1.2} distance={2.4} decay={2} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, 0]}>
          <ringGeometry args={[0, 0.22, 16]} />
          <meshBasicMaterial color={color} transparent opacity={0.35} />
        </mesh>
        <Billboard position={[0, 0.5, 0]} follow>
          <Text
            fontSize={0.22}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.02}
            outlineColor="#000000"
            material-toneMapped={false}
          >
            {`${unitLabel} · ETA ${res.etaMinutes}m`}
          </Text>
        </Billboard>
      </group>
    </>
  );
}

// ─────────────── Cinematic camera intro ───────────────

function CinematicIntro({
  durationSec = 2.5,
  startPos = new THREE.Vector3(28, 22, 28),
  endPos = new THREE.Vector3(12, 8, 14),
  enabled = true,
}: {
  durationSec?: number;
  startPos?: THREE.Vector3;
  endPos?: THREE.Vector3;
  enabled?: boolean;
}) {
  const { camera } = useThree();
  const t0 = useRef<number | null>(null);
  const done = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    camera.position.copy(startPos);
    camera.lookAt(0, 0, 0);
  }, [camera, startPos, enabled]);

  useFrame(({ clock }) => {
    if (!enabled || done.current) return;
    if (t0.current === null) t0.current = clock.getElapsedTime();
    const elapsed = clock.getElapsedTime() - t0.current;
    const t = Math.min(1, elapsed / durationSec);
    const eased = 1 - Math.pow(1 - t, 3);
    camera.position.lerpVectors(startPos, endPos, eased);
    camera.lookAt(0, 0, 0);
    if (t >= 1) done.current = true;
  });

  return null;
}

// ─────────────── Camera tour controller ───────────────
//
// While `tourMode` is true, the camera eases between hotspots — 4 seconds
// per stop with a cubic ease-out (same easing pattern as CinematicIntro).

function CameraTour({
  hotspots,
  active,
  index,
}: {
  hotspots: ProjectedHotspot[];
  active: boolean;
  index: number;
}) {
  const { camera } = useThree();
  const t0 = useRef<number | null>(null);
  const fromPos = useRef<THREE.Vector3 | null>(null);
  const toPos = useRef<THREE.Vector3 | null>(null);
  const fromTarget = useRef<THREE.Vector3 | null>(null);
  const toTarget = useRef<THREE.Vector3 | null>(null);
  const settled = useRef(false);

  useEffect(() => {
    if (!active || hotspots.length === 0) return;
    const target = hotspots[index % hotspots.length];
    if (!target) return;
    fromPos.current = camera.position.clone();
    toPos.current = new THREE.Vector3(target.x + 6, 8, target.z + 8);
    fromTarget.current = new THREE.Vector3(0, 0, 0);
    toTarget.current = new THREE.Vector3(target.x, 0, target.z);
    t0.current = null;
    settled.current = false;
  }, [active, index, hotspots, camera]);

  useFrame(({ clock }) => {
    if (!active || settled.current) return;
    if (!fromPos.current || !toPos.current || !toTarget.current || !fromTarget.current) return;
    if (t0.current === null) t0.current = clock.getElapsedTime();
    const elapsed = clock.getElapsedTime() - t0.current;
    const duration = 1.2;
    const t = Math.min(1, elapsed / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const pos = new THREE.Vector3().lerpVectors(fromPos.current, toPos.current, eased);
    const target = new THREE.Vector3().lerpVectors(fromTarget.current, toTarget.current, eased);
    camera.position.copy(pos);
    camera.lookAt(target);
    if (t >= 1) settled.current = true;
  });

  return null;
}

// ─────────────── Tour controls overlay ───────────────

function TourControls({
  hotspots,
  index,
  setIndex,
  paused,
  setPaused,
}: {
  hotspots: ProjectedHotspot[];
  index: number;
  setIndex: (n: number) => void;
  paused: boolean;
  setPaused: (p: boolean) => void;
}) {
  if (hotspots.length === 0) return null;
  const cur = hotspots[index % hotspots.length];
  const label = cur?.label ?? `Ignition ${index + 1}`;
  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 z-[404] -translate-x-1/2 rounded-[14px] border border-white/10 bg-black/60 px-3 py-2 text-xs text-zinc-100 backdrop-blur-md">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setIndex((index - 1 + hotspots.length) % hotspots.length)}
          className="rounded-md border border-white/10 px-2 py-0.5 text-[11px] hover:bg-white/[0.08]"
          aria-label="previous hotspot"
        >
          prev
        </button>
        <span className="font-mono text-[11px] tabular-nums text-zinc-300">
          {(index % hotspots.length) + 1} / {hotspots.length}
        </span>
        <span className="text-zinc-200">·</span>
        <span className="max-w-[220px] truncate text-zinc-100">{label}</span>
        <button
          type="button"
          onClick={() => setPaused(!paused)}
          className="rounded-md border border-white/10 px-2 py-0.5 text-[11px] hover:bg-white/[0.08]"
          aria-label={paused ? "resume tour" : "pause tour"}
        >
          {paused ? "play" : "pause"}
        </button>
        <button
          type="button"
          onClick={() => setIndex((index + 1) % hotspots.length)}
          className="rounded-md border border-white/10 px-2 py-0.5 text-[11px] hover:bg-white/[0.08]"
          aria-label="next hotspot"
        >
          next
        </button>
      </div>
    </div>
  );
}

// ─────────────── Main scene ───────────────

export function FireSimulator3D({
  windDirDeg,
  windSpeedMs,
  predicted1hAcres,
  predicted6hAcres,
  predicted24hAcres,
  risk = "MODERATE",
  resources = [],
  landmarks = DEFAULT_LANDMARKS,
  lowDetail = false,
  hotspots,
  bbox,
  tourMode = false,
}: FireSimulator3DProps) {
  const riskColor = RISK_COLORS[risk];

  // Project FIRMS hotspots into scene coordinates. When no bbox is provided
  // the projection is meaningless, so we skip multi-fire mode entirely.
  const projected: ProjectedHotspot[] = useMemo(() => {
    if (!hotspots || hotspots.length === 0 || !bbox) return [];
    return hotspots.map((h, i) => {
      const { x, z } = projectLatLon(h.lat, h.lon, { bbox, terrainSize: TERRAIN_SIZE });
      return {
        id: h.id ?? `hs_${i}`,
        x,
        z,
        lat: h.lat,
        lon: h.lon,
        frp: Math.max(0, h.frp ?? 0),
        confidence: h.confidence ?? "nominal",
        brightTi4: h.brightTi4,
        label: h.label,
      };
    });
  }, [hotspots, bbox]);

  // Multi-fire ignition mask — built once per hotspot set, then mutated by
  // the simulator. Falls back to a single 3×3 seed at the origin when no
  // hotspots are provided so legacy callers keep working.
  const fireGridRef = useRef<Float32Array>(buildFireGrid());
  useEffect(() => {
    if (projected.length === 0) {
      fireGridRef.current = buildFireGrid();
      return;
    }
    fireGridRef.current = buildFireGrid(
      projected.map((p) => ({ x: p.x, z: p.z, frp: p.frp })),
    );
  }, [projected]);

  // Per-hotspot ember + smoke + warm-light cluster bookkeeping. We split
  // the total ember pool across hotspots so the GPU cost is bounded
  // regardless of N.
  const totalEmbers = lowDetail ? 1500 : 3500;
  const emberClusters =
    projected.length === 0
      ? [{ key: "default", x: 0, z: 0, count: totalEmbers }]
      : projected.map((h) => {
          const frpScale = Math.max(0.4, Math.min(1.5, Math.sqrt(h.frp || 1) / 18));
          return {
            key: h.id,
            x: h.x,
            z: h.z,
            count: Math.max(180, Math.floor((totalEmbers / projected.length) * frpScale)),
          };
        });
  const smokeSources =
    projected.length === 0
      ? [{ key: "default", x: 0, z: 0, frp: 200 }]
      : projected.map((h) => ({ key: h.id, x: h.x, z: h.z, frp: h.frp }));

  // ─── camera-tour state ───
  const [tourIndex, setTourIndex] = useState(0);
  const [tourPaused, setTourPaused] = useState(false);
  const tourActive = tourMode && projected.length > 1;

  useEffect(() => {
    if (!tourActive || tourPaused) return;
    const id = window.setInterval(() => {
      setTourIndex((i) => (i + 1) % projected.length);
    }, 4000);
    return () => window.clearInterval(id);
  }, [tourActive, tourPaused, projected.length]);

  const handleSetIndex = useCallback((n: number) => {
    setTourIndex(n);
    setTourPaused(true);
  }, []);

  return (
    <div className="relative h-full w-full bg-black">
      <Canvas
        camera={{ position: [28, 22, 28], fov: 45, near: 0.1, far: 200 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={["#000000"]} />
        <ambientLight intensity={0.32} />
        <directionalLight position={[8, 10, 5]} intensity={0.6} />
        {smokeSources.map((s) => (
          <pointLight
            key={`pl_${s.key}`}
            position={[s.x, 0.6, s.z]}
            color={new THREE.Color(riskColor[0], riskColor[1], riskColor[2])}
            intensity={smokeSources.length > 1 ? 1.6 : 2.5}
            distance={smokeSources.length > 1 ? 7 : 10}
          />
        ))}
        <Stars radius={70} depth={50} count={1000} factor={1.6} fade speed={0.3} />

        {/* Cinematic intro is suppressed while a tour is active so the tour
            camera owns the view. */}
        <CinematicIntro enabled={!tourActive} />
        <CameraTour hotspots={projected} active={tourActive} index={tourIndex} />

        <Terrain fireGridRef={fireGridRef} windDirDeg={windDirDeg} windSpeedMs={windSpeedMs} />
        <SpreadRings
          predicted1hAcres={predicted1hAcres}
          predicted6hAcres={predicted6hAcres}
          predicted24hAcres={predicted24hAcres}
        />
        {emberClusters.map((c) => (
          <group key={`embers_${c.key}`} position={[c.x, 0, c.z]}>
            <Embers
              windDirDeg={windDirDeg}
              windSpeedMs={windSpeedMs}
              riskColor={riskColor}
              count={c.count}
            />
          </group>
        ))}
        {smokeSources.map((s) => (
          <group
            key={`smoke_${s.key}`}
            position={[s.x, 0, s.z]}
            scale={0.6 + Math.min(1.2, Math.sqrt(s.frp || 1) / 22)}
          >
            <SmokeColumn windDirDeg={windDirDeg} windSpeedMs={windSpeedMs} />
          </group>
        ))}
        <Landmarks landmarks={landmarks} showIncident={projected.length === 0} />
        {projected.length > 0 && <HotspotLabels hotspots={projected} />}
        {resources.map((r) => (
          <DispatchedUnit key={r.id} res={r} />
        ))}

        <OrbitControls
          enablePan
          enableZoom
          enableRotate
          minDistance={5}
          maxDistance={45}
          maxPolarAngle={Math.PI / 2.05}
          enabled={!tourActive}
        />
      </Canvas>
      {tourActive && (
        <TourControls
          hotspots={projected}
          index={tourIndex}
          setIndex={handleSetIndex}
          paused={tourPaused}
          setPaused={setTourPaused}
        />
      )}
    </div>
  );
}
