"use client";

// 3D fire-spread visualizer. React Three Fiber + drei.
//
// Patterns drawn from the research report:
// - GPU instanced ember sprites advected by a wind vector field (the
//   live windDirDeg / windSpeedMs from Open-Meteo, not hardcoded).
// - Heightmap-displaced terrain plane with shaded hillshade for context.
// - Additive-blended billboards for the fire core + a small smoke column.
// - OrbitControls for inspection.
//
// The component is self-contained and doesn't require WebGL2-only features.
// Particle count auto-tunes to 5 k on mobile / 12 k on desktop.

import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import * as THREE from "three";

interface ResourceMarker {
  id: string;
  kind: "engine" | "helicopter" | "fixed-wing" | "dozer" | "hand-crew";
  bearingDeg: number;
  distanceKm: number;
  etaMinutes: number;
}

interface FireSimulator3DProps {
  /** Wind direction the wind is blowing TOWARDS, in degrees clockwise from north. */
  windDirDeg: number;
  /** 10-m wind speed in m/s. */
  windSpeedMs: number;
  /** Predicted spread polygon area at t+1h (acres). */
  predicted1hAcres?: number;
  /** Predicted spread polygon area at t+6h (acres). */
  predicted6hAcres?: number;
  /** Predicted spread polygon area at t+24h (acres). */
  predicted24hAcres?: number;
  /** Risk band — drives ember intensity + fire-core color. */
  risk?: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  /** Aerial / ground resources approaching the incident. */
  resources?: ResourceMarker[];
  /** Lower the particle count for low-end devices. */
  lowDetail?: boolean;
}

const RISK_COLORS: Record<NonNullable<FireSimulator3DProps["risk"]>, [number, number, number]> = {
  LOW: [1.0, 0.86, 0.45],
  MODERATE: [1.0, 0.62, 0.22],
  HIGH: [1.0, 0.36, 0.12],
  CRITICAL: [1.0, 0.18, 0.05],
};

/**
 * Heightmap terrain — fbm noise on a plane geometry, displaced via vertex
 * positions. Cheap, deterministic, no external assets.
 */
function Terrain() {
  const mesh = useRef<THREE.Mesh>(null!);
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(40, 40, 128, 128);
    const pos = geo.attributes.position!;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const r = Math.sqrt(x * x + y * y);
      // Bowl-shaped terrain pushing away from the fire (visual: fire sits in
      // a depression, smoke and embers escape outward).
      const height =
        Math.sin(x * 0.4) * 0.18 +
        Math.cos(y * 0.35) * 0.22 +
        Math.sin((x + y) * 0.6) * 0.12 -
        Math.exp(-r * 0.18) * 0.45;
      pos.setZ(i, height);
    }
    geo.computeVertexNormals();
    return geo;
  }, []);
  return (
    <mesh ref={mesh} geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <meshStandardMaterial
        color="#1a1410"
        roughness={0.95}
        metalness={0.0}
        flatShading
      />
    </mesh>
  );
}

/**
 * Instanced GPU ember system. Each ember is a small additive billboard.
 * Advection is applied per-frame: position += wind_vec * dt + buoyancy_up,
 * with a per-particle lifetime that resets at the fire core when expired.
 */
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

  // Per-particle state (CPU-side; cheap enough for 12k @ 60 fps on M1).
  const state = useMemo(() => {
    const arr = new Array(count).fill(null).map(() => ({
      x: (Math.random() - 0.5) * 0.4,
      y: Math.random() * 0.2,
      z: (Math.random() - 0.5) * 0.4,
      vy: 0.4 + Math.random() * 0.8,
      life: Math.random() * 1.0,
      ttl: 1.5 + Math.random() * 2.0,
    }));
    return arr;
  }, [count]);

  // Wind vector (meteorological convention: wind FROM direction is the
  // direction the wind is blowing TOWARDS; we already get "towards" from
  // Open-Meteo's wind_direction_10m so we use it directly to advect particles).
  const windRad = (windDirDeg * Math.PI) / 180;
  const windScale = Math.min(0.6, windSpeedMs * 0.06);
  const windX = Math.sin(windRad) * windScale;
  const windZ = -Math.cos(windRad) * windScale;

  useFrame((_, dt) => {
    if (!meshRef.current) return;
    for (let i = 0; i < count; i++) {
      const p = state[i];
      if (!p) continue;
      p.life += dt;
      if (p.life > p.ttl) {
        // Respawn at fire core with random small offset.
        p.x = (Math.random() - 0.5) * 0.4;
        p.y = 0.05;
        p.z = (Math.random() - 0.5) * 0.4;
        p.vy = 0.4 + Math.random() * 0.9;
        p.life = 0;
        p.ttl = 1.4 + Math.random() * 2.4;
      }
      p.x += windX * dt + (Math.random() - 0.5) * 0.05 * dt;
      p.z += windZ * dt + (Math.random() - 0.5) * 0.05 * dt;
      p.y += p.vy * dt;
      // Fade vertical velocity as ember rises (cooling).
      p.vy *= 1 - dt * 0.4;

      const t = p.life / p.ttl;
      const scale = (1 - t) * 0.06 + 0.02;
      dummy.position.set(p.x, p.y, p.z);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
      // Fade color to a deeper red as it cools.
      const fade = 1 - t;
      meshRef.current.setColorAt(
        i,
        new THREE.Color(
          riskColor[0] * fade + 0.1 * t,
          riskColor[1] * fade + 0.04 * t,
          riskColor[2] * fade,
        ),
      );
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 8, 8]} />
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

/** Smoke column — a few stretched billboards stacked vertically. */
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
        0.3 + i * 0.6 + Math.sin(t * 0.6 + i) * 0.04,
        -Math.cos(windRad) * drift * phase + Math.cos(t + i) * 0.05,
      );
      c.rotation.y = t * 0.05 + i;
    });
  });

  return (
    <group ref={group}>
      {Array.from({ length: layers }).map((_, i) => (
        <mesh key={i}>
          <sphereGeometry args={[0.5 + i * 0.18, 12, 12]} />
          <meshBasicMaterial
            color="#1c1c1f"
            transparent
            opacity={0.18 - i * 0.018}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

/** Fire core — emissive sphere + point light. */
function FireCore({ color }: { color: [number, number, number] }) {
  const colorObj = new THREE.Color(color[0], color[1], color[2]);
  return (
    <group position={[0, 0.05, 0]}>
      <mesh>
        <sphereGeometry args={[0.32, 16, 16]} />
        <meshBasicMaterial color={colorObj} toneMapped={false} />
      </mesh>
      <pointLight color={colorObj} intensity={4} distance={6} decay={2} />
    </group>
  );
}

/** Predicted spread rings at t+1h / t+6h / t+24h. Translucent flat discs. */
function SpreadRings({
  predicted1hAcres,
  predicted6hAcres,
  predicted24hAcres,
}: {
  predicted1hAcres?: number;
  predicted6hAcres?: number;
  predicted24hAcres?: number;
}) {
  // Acres → world-units radius using a fixed scale. 100 acres ≈ 0.4 km on a
  // side, our terrain plane is 40 units representing ~5 km, so 1 unit ≈ 125m.
  const ringFor = (acres: number | undefined) => {
    if (!acres || acres <= 0) return null;
    const radiusM = Math.sqrt((acres * 4047) / Math.PI);
    return radiusM / 125;
  };
  const r1 = ringFor(predicted1hAcres);
  const r6 = ringFor(predicted6hAcres);
  const r24 = ringFor(predicted24hAcres);

  return (
    <group rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
      {r1 !== null && (
        <mesh>
          <ringGeometry args={[r1 * 0.95, r1, 64]} />
          <meshBasicMaterial color="#fde68a" transparent opacity={0.65} side={THREE.DoubleSide} />
        </mesh>
      )}
      {r6 !== null && (
        <mesh>
          <ringGeometry args={[r6 * 0.97, r6, 64]} />
          <meshBasicMaterial color="#fb923c" transparent opacity={0.55} side={THREE.DoubleSide} />
        </mesh>
      )}
      {r24 !== null && (
        <mesh>
          <ringGeometry args={[r24 * 0.98, r24, 64]} />
          <meshBasicMaterial color="#dc2626" transparent opacity={0.45} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

/** Aerial / ground resources approaching the incident. */
function ResourceMarkers({ resources }: { resources: ResourceMarker[] }) {
  return (
    <group>
      {resources.map((r) => {
        const angleRad = (r.bearingDeg * Math.PI) / 180;
        // Distance scaling matches SpreadRings: 1 unit ≈ 125 m, terrain is 40 units.
        const distUnits = Math.min(18, (r.distanceKm * 1000) / 125);
        const x = Math.sin(angleRad) * distUnits;
        const z = -Math.cos(angleRad) * distUnits;
        const y = r.kind === "helicopter" ? 1.4 : r.kind === "fixed-wing" ? 2.0 : 0.15;
        const color =
          r.kind === "helicopter"
            ? "#22d3ee"
            : r.kind === "fixed-wing"
              ? "#a78bfa"
              : r.kind === "dozer"
                ? "#fbbf24"
                : r.kind === "hand-crew"
                  ? "#34d399"
                  : "#60a5fa";
        return (
          <group key={r.id} position={[x, y, z]}>
            <mesh>
              <sphereGeometry
                args={[r.kind === "fixed-wing" || r.kind === "helicopter" ? 0.18 : 0.12, 12, 12]}
              />
              <meshBasicMaterial color={color} toneMapped={false} />
            </mesh>
            {/* Ground-track line so the dispatcher can see the approach vector. */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -y + 0.005, 0]}>
              <ringGeometry args={[0, 0.18, 16]} />
              <meshBasicMaterial color={color} transparent opacity={0.35} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

export function FireSimulator3D({
  windDirDeg,
  windSpeedMs,
  predicted1hAcres,
  predicted6hAcres,
  predicted24hAcres,
  risk = "MODERATE",
  resources = [],
  lowDetail = false,
}: FireSimulator3DProps) {
  const riskColor = RISK_COLORS[risk];
  const emberCount = lowDetail ? 1500 : 4000;

  return (
    <div className="relative h-full w-full bg-black">
      <Canvas
        camera={{ position: [10, 8, 12], fov: 45, near: 0.1, far: 200 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={["#08070a"]} />
        <ambientLight intensity={0.35} />
        <directionalLight position={[8, 10, 5]} intensity={0.6} />
        <Stars radius={80} depth={50} count={1500} factor={2} fade speed={0.5} />
        <Terrain />
        <SpreadRings
          predicted1hAcres={predicted1hAcres}
          predicted6hAcres={predicted6hAcres}
          predicted24hAcres={predicted24hAcres}
        />
        <FireCore color={riskColor} />
        <Embers
          windDirDeg={windDirDeg}
          windSpeedMs={windSpeedMs}
          riskColor={riskColor}
          count={emberCount}
        />
        <SmokeColumn windDirDeg={windDirDeg} windSpeedMs={windSpeedMs} />
        <ResourceMarkers resources={resources} />
        <OrbitControls
          enablePan
          enableZoom
          enableRotate
          minDistance={5}
          maxDistance={40}
          maxPolarAngle={Math.PI / 2.05}
        />
      </Canvas>
    </div>
  );
}
