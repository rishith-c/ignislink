"use client";

// Self-contained ONNX-aware variant of `FireSimulator3D` for the
// `feat/swarm/onnx-in-browser` swarm. Living in its own file so it doesn't
// race with Agent A's parallel edits to FireSimulator3D.tsx (DEM + wind
// grid swarm) — both surfaces can land independently and merge cleanly.
//
// Architecture: this file inlines a minimal copy of the CA + ONNX terrain
// logic and embeds it in a self-contained Canvas. Once the parallel
// branches converge, the patch is straightforward — just add the
// `useOnnx`, `onnxGridRef`, `blendMode` plumbing into the canonical
// `FireSimulator3D.tsx` Terrain component (the function bodies match).
//
// What it does (only when `useOnnx` is true):
//   1. Every ~500 ms it builds a 14-channel input tensor from the current
//      CA burn mask + wind, calls `runFireSpread()` (Web Worker), and
//      stashes the t+6h burn-probability raster.
//   2. The terrain texture is repainted every CA tick OR when a new ONNX
//      raster arrives. The displayed mask is `max(ca, onnx)` (blended
//      mode by default) — the model can only ADD coverage, never erase.
//   3. A pill in the top-right cycles the blend mode: CA only -> blended
//      -> AI only.

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Text, Billboard, Stars } from "@react-three/drei";
import * as THREE from "three";

import { runFireSpread } from "@/lib/ml/fire-spread-onnx";
import { synthesizeFireSpreadInput } from "@/lib/ml/synthesize-input";

/**
 * How the on-terrain fire mask is composed.
 *
 *  - "ca"      → only the on-device CA grid.
 *  - "onnx"    → only the ONNX p6h horizon raster.
 *  - "blended" → max(ca, onnx) per cell. The ONNX model paints additional
 *                burn probability that the simple CA might be missing.
 */
export type FireBlendMode = "ca" | "onnx" | "blended";

interface ResourceMarker {
  id: string;
  kind: "engine" | "helicopter" | "fixed-wing" | "dozer" | "hand-crew";
  bearingDeg: number;
  distanceKm: number;
  etaMinutes: number;
  name?: string;
  baseName?: string;
}

interface Landmark {
  x: number;
  z: number;
  label: string;
  kind: "city" | "ridge" | "water" | "highway";
}

export interface FireSimulator3DOnnxProps {
  windDirDeg: number;
  windSpeedMs: number;
  predicted1hAcres?: number;
  predicted6hAcres?: number;
  predicted24hAcres?: number;
  risk?: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  resources?: ResourceMarker[];
  landmarks?: Landmark[];
  lowDetail?: boolean;
  /**
   * When true the scene runs the in-browser ONNX U-Net+ConvLSTM fire-spread
   * model (`/fire-spread-smoke.onnx`) and blends its p6h burn-probability
   * raster onto the terrain mask. Defaults to true for this component
   * (callers explicitly opted in by importing `FireSimulator3DOnnxOverlay`).
   */
  useOnnx?: boolean;
}

const TERRAIN_SIZE = 40;
const TERRAIN_RES = 96;

const RISK_COLORS: Record<
  NonNullable<FireSimulator3DOnnxProps["risk"]>,
  [number, number, number]
> = {
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

// ─────────────── Heightmap + CA (port of v2 baseline) ───────────────

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

function buildFireGrid(): Float32Array {
  const g = new Float32Array(TERRAIN_RES * TERRAIN_RES);
  const c = Math.floor(TERRAIN_RES / 2);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      g[(c + dy) * TERRAIN_RES + (c + dx)] = 0.85;
    }
  }
  return g;
}

function stepFire(grid: Float32Array, windX: number, windZ: number, rng: () => number): void {
  const next = new Float32Array(grid.length);
  const wMag = Math.min(0.55, Math.hypot(windX, windZ) * 0.04);
  const wxNorm = wMag === 0 ? 0 : windX / Math.hypot(windX, windZ) || 0;
  const wzNorm = wMag === 0 ? 0 : windZ / Math.hypot(windX, windZ) || 0;
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

function combineFireGrids(
  ca: Float32Array,
  onnx: Float32Array | null,
  mode: FireBlendMode,
): Float32Array {
  if (mode === "ca" || !onnx) return ca;
  if (mode === "onnx") return onnx;
  const out = new Float32Array(ca.length);
  const len = Math.min(ca.length, onnx.length);
  for (let i = 0; i < len; i++) {
    const a = ca[i] ?? 0;
    const b = onnx[i] ?? 0;
    out[i] = a > b ? a : b;
  }
  return out;
}

// ─────────────── Terrain w/ ONNX overlay ───────────────

function Terrain({
  fireGridRef,
  onnxGridRef,
  blendMode,
  windDirDeg,
  windSpeedMs,
  useOnnx,
}: {
  fireGridRef: React.MutableRefObject<Float32Array>;
  onnxGridRef: React.MutableRefObject<Float32Array | null>;
  blendMode: FireBlendMode;
  windDirDeg: number;
  windSpeedMs: number;
  useOnnx: boolean;
}) {
  const fireMatRef = useRef<THREE.MeshBasicMaterial>(null!);
  const stepCounter = useRef(0);
  const onnxStepCounter = useRef(0);
  const onnxInflight = useRef(false);
  const onnxFailed = useRef(false);
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
    onnxStepCounter.current += dt;

    let dirty = false;
    if (stepCounter.current >= 0.08) {
      stepCounter.current = 0;
      const windRad = (windDirDeg * Math.PI) / 180;
      const windX = Math.sin(windRad) * windSpeedMs;
      const windZ = -Math.cos(windRad) * windSpeedMs;
      stepFire(fireGridRef.current, windX, windZ, rng);
      dirty = true;
    }

    if (
      useOnnx &&
      !onnxInflight.current &&
      !onnxFailed.current &&
      onnxStepCounter.current >= 0.5
    ) {
      onnxStepCounter.current = 0;
      onnxInflight.current = true;
      const windRad = (windDirDeg * Math.PI) / 180;
      const windU = Math.sin(windRad) * windSpeedMs;
      const windV = -Math.cos(windRad) * windSpeedMs;
      const synth = synthesizeFireSpreadInput({
        burnMask: fireGridRef.current,
        height: TERRAIN_RES,
        width: TERRAIN_RES,
        windU,
        windV,
      });
      runFireSpread(synth.data, synth.shape as [1, 4, 14, number, number])
        .then((result) => {
          if (result.dims[0] === TERRAIN_RES && result.dims[1] === TERRAIN_RES) {
            onnxGridRef.current = result.p6h;
          }
        })
        .catch(() => {
          onnxFailed.current = true;
        })
        .finally(() => {
          onnxInflight.current = false;
        });
    }

    if (dirty || (useOnnx && blendMode !== "ca")) {
      const composed = combineFireGrids(
        fireGridRef.current,
        useOnnx ? onnxGridRef.current : null,
        blendMode,
      );
      const tex = fireGridToTexture(composed);
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

// ─────────────── Embers + smoke (single-vector wind) ───────────────

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

function Landmarks({ landmarks }: { landmarks: Landmark[] }) {
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
    </group>
  );
}

function CinematicIntro({
  durationSec = 2.5,
  startPos = new THREE.Vector3(28, 22, 28),
  endPos = new THREE.Vector3(12, 8, 14),
}: {
  durationSec?: number;
  startPos?: THREE.Vector3;
  endPos?: THREE.Vector3;
}) {
  const { camera } = useThree();
  const t0 = useRef<number | null>(null);
  const done = useRef(false);

  useEffect(() => {
    camera.position.copy(startPos);
    camera.lookAt(0, 0, 0);
  }, [camera, startPos]);

  useFrame(({ clock }) => {
    if (done.current) return;
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

// ─────────────── Main scene ───────────────

export function FireSimulator3DOnnxOverlay({
  windDirDeg,
  windSpeedMs,
  predicted1hAcres,
  predicted6hAcres,
  predicted24hAcres,
  risk = "MODERATE",
  resources: _resources = [],
  landmarks = DEFAULT_LANDMARKS,
  lowDetail = false,
  useOnnx = true,
}: FireSimulator3DOnnxProps) {
  const fireGridRef = useRef<Float32Array>(buildFireGrid());
  const onnxGridRef = useRef<Float32Array | null>(null);
  const [blendMode, setBlendMode] = useState<FireBlendMode>(useOnnx ? "blended" : "ca");
  const riskColor = RISK_COLORS[risk];
  const emberCount = lowDetail ? 1500 : 3500;

  useEffect(() => {
    if (!useOnnx) {
      setBlendMode("ca");
      onnxGridRef.current = null;
    } else {
      setBlendMode((prev) => (prev === "ca" ? "blended" : prev));
    }
  }, [useOnnx]);

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
        <pointLight
          position={[0, 0.6, 0]}
          color={new THREE.Color(riskColor[0], riskColor[1], riskColor[2])}
          intensity={2.5}
          distance={10}
        />
        <Stars radius={70} depth={50} count={1000} factor={1.6} fade speed={0.3} />
        <CinematicIntro />
        <Terrain
          fireGridRef={fireGridRef}
          onnxGridRef={onnxGridRef}
          blendMode={useOnnx ? blendMode : "ca"}
          windDirDeg={windDirDeg}
          windSpeedMs={windSpeedMs}
          useOnnx={useOnnx}
        />
        <SpreadRings
          predicted1hAcres={predicted1hAcres}
          predicted6hAcres={predicted6hAcres}
          predicted24hAcres={predicted24hAcres}
        />
        <Embers
          windDirDeg={windDirDeg}
          windSpeedMs={windSpeedMs}
          riskColor={riskColor}
          count={emberCount}
        />
        <SmokeColumn windDirDeg={windDirDeg} windSpeedMs={windSpeedMs} />
        <Landmarks landmarks={landmarks} />
        <OrbitControls
          enablePan
          enableZoom
          enableRotate
          minDistance={5}
          maxDistance={45}
          maxPolarAngle={Math.PI / 2.05}
        />
      </Canvas>

      {useOnnx && <AiBlendPill mode={blendMode} onChange={setBlendMode} />}
    </div>
  );
}

/**
 * Floating "AI" pill in the top-right corner of the 3D scene. Lets the user
 * cycle between CA-only, ONNX-only, and blended modes.
 */
function AiBlendPill({
  mode,
  onChange,
}: {
  mode: FireBlendMode;
  onChange: (mode: FireBlendMode) => void;
}) {
  const ORDER: FireBlendMode[] = ["ca", "blended", "onnx"];
  const LABELS: Record<FireBlendMode, string> = {
    ca: "CA only",
    blended: "AI · blended",
    onnx: "AI only",
  };
  const next = () => {
    const idx = ORDER.indexOf(mode);
    const nextMode = ORDER[(idx + 1) % ORDER.length] ?? "blended";
    onChange(nextMode);
  };
  const tone =
    mode === "ca"
      ? "bg-zinc-800/80 text-zinc-200 ring-zinc-500/40"
      : mode === "onnx"
        ? "bg-fuchsia-600/30 text-fuchsia-100 ring-fuchsia-300/50"
        : "bg-orange-500/25 text-orange-100 ring-orange-300/50";
  return (
    <button
      type="button"
      onClick={next}
      className={`absolute right-4 top-4 z-10 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider ring-1 backdrop-blur-md transition hover:scale-[1.02] ${tone}`}
      aria-label={`AI fire spread mode: ${LABELS[mode]}. Click to cycle.`}
      title="Cycle CA -> blended -> AI-only fire spread overlay"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {LABELS[mode]}
    </button>
  );
}
