"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface DozerProps {
  color: string;
  scale?: number;
}

const TRACK_COLOR = "#1a1a1a";
const ACCENT_DARK = "#262626";
const WINDOW_COLOR = "#0e1a24";
const EXHAUST_PUFF_HZ = 1.6;

/**
 * Procedural low-poly bulldozer / fire-line cutter. Local space, faces +X.
 * The blade and chassis use the supplied color; tracks are dark.
 */
export function Dozer({ color, scale = 1 }: DozerProps) {
  const exhaustRef = useRef<THREE.MeshBasicMaterial>(null);
  // Slightly different yellow for the blade — derive a darker variant.
  const bladeColor = useDarkerVariant(color, 0.85);

  useFrame(({ clock }) => {
    if (exhaustRef.current) {
      const t = clock.getElapsedTime();
      exhaustRef.current.opacity =
        0.25 + 0.35 * Math.abs(Math.sin(t * Math.PI * EXHAUST_PUFF_HZ));
    }
  });

  return (
    <group scale={scale}>
      {/* Tracks — two long boxes flanking the chassis */}
      {[0.22, -0.22].map((z) => (
        <mesh key={z} position={[0, 0.11, z]}>
          <boxGeometry args={[0.95, 0.18, 0.16]} />
          <meshStandardMaterial color={TRACK_COLOR} flatShading roughness={0.95} />
        </mesh>
      ))}
      {/* Track wheels (visual indents) */}
      {[0.22, -0.22].map((z) =>
        [-0.32, -0.1, 0.12, 0.34].map((x) => (
          <mesh
            key={`${z}-${x}`}
            position={[x, 0.11, z]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <cylinderGeometry args={[0.07, 0.07, 0.18, 10]} />
            <meshStandardMaterial color={ACCENT_DARK} flatShading roughness={0.8} />
          </mesh>
        )),
      )}

      {/* Chassis */}
      <mesh position={[-0.05, 0.28, 0]}>
        <boxGeometry args={[0.7, 0.16, 0.46]} />
        <meshStandardMaterial color={color} flatShading roughness={0.7} />
      </mesh>

      {/* Cab — small box with windows */}
      <mesh position={[-0.18, 0.5, 0]}>
        <boxGeometry args={[0.34, 0.3, 0.36]} />
        <meshStandardMaterial color={color} flatShading roughness={0.65} />
      </mesh>
      {/* Cab windows (front + sides) */}
      <mesh position={[-0.005, 0.52, 0]}>
        <boxGeometry args={[0.005, 0.18, 0.32]} />
        <meshStandardMaterial color={WINDOW_COLOR} metalness={0.6} roughness={0.15} flatShading />
      </mesh>
      <mesh position={[-0.18, 0.54, 0.185]}>
        <boxGeometry args={[0.3, 0.16, 0.005]} />
        <meshStandardMaterial color={WINDOW_COLOR} metalness={0.6} roughness={0.15} flatShading />
      </mesh>
      <mesh position={[-0.18, 0.54, -0.185]}>
        <boxGeometry args={[0.3, 0.16, 0.005]} />
        <meshStandardMaterial color={WINDOW_COLOR} metalness={0.6} roughness={0.15} flatShading />
      </mesh>

      {/* Blade at front — angled slab */}
      <group position={[0.42, 0.22, 0]} rotation={[0, 0, -0.18]}>
        <mesh>
          <boxGeometry args={[0.06, 0.42, 0.7]} />
          <meshStandardMaterial color={bladeColor} flatShading roughness={0.6} metalness={0.4} />
        </mesh>
        {/* Blade edge */}
        <mesh position={[0, -0.22, 0]}>
          <boxGeometry args={[0.1, 0.04, 0.72]} />
          <meshStandardMaterial color="#9ca3af" metalness={0.7} roughness={0.3} flatShading />
        </mesh>
      </group>

      {/* Hydraulic arms connecting blade to chassis */}
      {[0.18, -0.18].map((z) => (
        <mesh key={z} position={[0.22, 0.26, z]} rotation={[0, 0, -0.15]}>
          <cylinderGeometry args={[0.025, 0.025, 0.34, 8]} />
          <meshStandardMaterial color={ACCENT_DARK} flatShading metalness={0.5} />
        </mesh>
      ))}

      {/* Exhaust pipe — vertical thin cylinder behind cab */}
      <mesh position={[-0.32, 0.62, 0.12]}>
        <cylinderGeometry args={[0.03, 0.03, 0.34, 10]} />
        <meshStandardMaterial color={ACCENT_DARK} flatShading metalness={0.5} roughness={0.5} />
      </mesh>
      {/* Exhaust puff */}
      <mesh position={[-0.32, 0.84, 0.12]}>
        <sphereGeometry args={[0.07, 8, 8]} />
        <meshBasicMaterial
          ref={exhaustRef}
          color="#3a3a3a"
          transparent
          opacity={0.4}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

/**
 * Returns a slightly darker hex color. Pure helper, no React state.
 */
function useDarkerVariant(hex: string, factor: number): string {
  const c = new THREE.Color(hex);
  c.multiplyScalar(factor);
  return `#${c.getHexString()}`;
}
