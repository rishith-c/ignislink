"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface HandCrewJeepProps {
  color: string;
  scale?: number;
}

const WHEEL_COLOR = "#0a0a0a";
const WINDOW_COLOR = "#0e1a24";
const ACCENT_DARK = "#1a1a1a";

/**
 * Procedural low-poly hand-crew jeep with roll cage and open bed.
 * Local space, faces +X.
 */
export function HandCrewJeep({ color, scale = 1 }: HandCrewJeepProps) {
  const wheelsRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (!wheelsRef.current) return;
    for (const child of wheelsRef.current.children) {
      child.rotation.z -= delta * 1.4;
    }
  });

  return (
    <group scale={scale}>
      {/* Chassis */}
      <mesh position={[0, 0.18, 0]}>
        <boxGeometry args={[0.85, 0.12, 0.4]} />
        <meshStandardMaterial color={color} flatShading roughness={0.6} metalness={0.2} />
      </mesh>

      {/* Cab — front compact box with windshield */}
      <mesh position={[0.18, 0.36, 0]}>
        <boxGeometry args={[0.32, 0.24, 0.38]} />
        <meshStandardMaterial color={color} flatShading roughness={0.55} />
      </mesh>
      {/* Windshield */}
      <mesh position={[0.345, 0.4, 0]} rotation={[0, 0, -0.25]}>
        <boxGeometry args={[0.02, 0.22, 0.34]} />
        <meshStandardMaterial color={WINDOW_COLOR} metalness={0.6} roughness={0.15} flatShading />
      </mesh>
      {/* Side windows */}
      <mesh position={[0.18, 0.42, 0.19]}>
        <boxGeometry args={[0.28, 0.14, 0.005]} />
        <meshStandardMaterial color={WINDOW_COLOR} metalness={0.6} roughness={0.15} flatShading />
      </mesh>
      <mesh position={[0.18, 0.42, -0.19]}>
        <boxGeometry args={[0.28, 0.14, 0.005]} />
        <meshStandardMaterial color={WINDOW_COLOR} metalness={0.6} roughness={0.15} flatShading />
      </mesh>

      {/* Open bed — slightly recessed box at rear */}
      <mesh position={[-0.22, 0.28, 0]}>
        <boxGeometry args={[0.42, 0.06, 0.36]} />
        <meshStandardMaterial color={ACCENT_DARK} flatShading roughness={0.8} />
      </mesh>
      {/* Bed walls */}
      <mesh position={[-0.22, 0.34, 0.18]}>
        <boxGeometry args={[0.42, 0.08, 0.02]} />
        <meshStandardMaterial color={color} flatShading roughness={0.6} />
      </mesh>
      <mesh position={[-0.22, 0.34, -0.18]}>
        <boxGeometry args={[0.42, 0.08, 0.02]} />
        <meshStandardMaterial color={color} flatShading roughness={0.6} />
      </mesh>
      <mesh position={[-0.43, 0.34, 0]}>
        <boxGeometry args={[0.02, 0.08, 0.36]} />
        <meshStandardMaterial color={color} flatShading roughness={0.6} />
      </mesh>

      {/* Roll cage — thin tubular frame over the bed */}
      {/* Front uprights */}
      <mesh position={[-0.02, 0.5, 0.18]}>
        <cylinderGeometry args={[0.018, 0.018, 0.32, 8]} />
        <meshStandardMaterial color={ACCENT_DARK} flatShading metalness={0.5} />
      </mesh>
      <mesh position={[-0.02, 0.5, -0.18]}>
        <cylinderGeometry args={[0.018, 0.018, 0.32, 8]} />
        <meshStandardMaterial color={ACCENT_DARK} flatShading metalness={0.5} />
      </mesh>
      {/* Rear uprights */}
      <mesh position={[-0.42, 0.5, 0.18]}>
        <cylinderGeometry args={[0.018, 0.018, 0.32, 8]} />
        <meshStandardMaterial color={ACCENT_DARK} flatShading metalness={0.5} />
      </mesh>
      <mesh position={[-0.42, 0.5, -0.18]}>
        <cylinderGeometry args={[0.018, 0.018, 0.32, 8]} />
        <meshStandardMaterial color={ACCENT_DARK} flatShading metalness={0.5} />
      </mesh>
      {/* Top longitudinal bars */}
      <mesh position={[-0.22, 0.66, 0.18]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.018, 0.018, 0.4, 8]} />
        <meshStandardMaterial color={ACCENT_DARK} flatShading metalness={0.5} />
      </mesh>
      <mesh position={[-0.22, 0.66, -0.18]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.018, 0.018, 0.4, 8]} />
        <meshStandardMaterial color={ACCENT_DARK} flatShading metalness={0.5} />
      </mesh>
      {/* Top cross bars (front/rear) */}
      <mesh position={[-0.02, 0.66, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.018, 0.018, 0.36, 8]} />
        <meshStandardMaterial color={ACCENT_DARK} flatShading metalness={0.5} />
      </mesh>
      <mesh position={[-0.42, 0.66, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.018, 0.018, 0.36, 8]} />
        <meshStandardMaterial color={ACCENT_DARK} flatShading metalness={0.5} />
      </mesh>

      {/* Headlights */}
      <mesh position={[0.36, 0.28, 0.13]}>
        <sphereGeometry args={[0.03, 8, 8]} />
        <meshBasicMaterial color="#fff7d6" toneMapped={false} />
      </mesh>
      <mesh position={[0.36, 0.28, -0.13]}>
        <sphereGeometry args={[0.03, 8, 8]} />
        <meshBasicMaterial color="#fff7d6" toneMapped={false} />
      </mesh>

      {/* Wheels */}
      <group ref={wheelsRef}>
        {(
          [
            [0.26, 0.1, 0.21],
            [0.26, 0.1, -0.21],
            [-0.26, 0.1, 0.21],
            [-0.26, 0.1, -0.21],
          ] as const
        ).map(([x, y, z]) => (
          <mesh key={`${x}-${z}`} position={[x, y, z]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.11, 0.11, 0.08, 12]} />
            <meshStandardMaterial color={WHEEL_COLOR} flatShading roughness={0.85} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
