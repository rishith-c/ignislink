"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface FireTruckProps {
  color: string;
  scale?: number;
}

const WHEEL_COLOR = "#0a0a0a";
const WINDOW_COLOR = "#0e1a24";
const ACCENT_DARK = "#1a1a1a";
const CHROME = "#9ca3af";
const LIGHTBAR_BLINK_HZ = 1.25;

/**
 * Procedural low-poly fire engine. Local space, faces +X.
 */
export function FireTruck({ color, scale = 1 }: FireTruckProps) {
  const wheelsRef = useRef<THREE.Group>(null);
  const lightRedRef = useRef<THREE.MeshBasicMaterial>(null);
  const lightBlueRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(({ clock }, delta) => {
    if (wheelsRef.current) {
      // Slow forward roll — wheels are oriented with axis along Z, so spin Z
      for (const child of wheelsRef.current.children) {
        child.rotation.z -= delta * 1.6;
      }
    }
    const t = clock.getElapsedTime();
    const phase = Math.floor(t * LIGHTBAR_BLINK_HZ * 2) % 2;
    if (lightRedRef.current) lightRedRef.current.opacity = phase === 0 ? 1 : 0.15;
    if (lightBlueRef.current) lightBlueRef.current.opacity = phase === 0 ? 0.15 : 1;
  });

  return (
    <group scale={scale}>
      {/* Chassis — long flat box */}
      <mesh position={[0, 0.18, 0]}>
        <boxGeometry args={[1.0, 0.12, 0.4]} />
        <meshStandardMaterial color={ACCENT_DARK} flatShading roughness={0.7} />
      </mesh>

      {/* Cab — front upper box */}
      <mesh position={[0.32, 0.39, 0]}>
        <boxGeometry args={[0.32, 0.3, 0.38]} />
        <meshStandardMaterial color={color} flatShading roughness={0.55} metalness={0.2} />
      </mesh>

      {/* Windshield — tinted glass slab on front of cab */}
      <mesh position={[0.49, 0.42, 0]}>
        <boxGeometry args={[0.02, 0.18, 0.34]} />
        <meshStandardMaterial
          color={WINDOW_COLOR}
          metalness={0.6}
          roughness={0.15}
          flatShading
        />
      </mesh>
      {/* Side windows */}
      <mesh position={[0.32, 0.44, 0.2]}>
        <boxGeometry args={[0.28, 0.14, 0.02]} />
        <meshStandardMaterial color={WINDOW_COLOR} metalness={0.6} roughness={0.15} flatShading />
      </mesh>
      <mesh position={[0.32, 0.44, -0.2]}>
        <boxGeometry args={[0.28, 0.14, 0.02]} />
        <meshStandardMaterial color={WINDOW_COLOR} metalness={0.6} roughness={0.15} flatShading />
      </mesh>

      {/* Tank / body — larger box at rear in unit color */}
      <mesh position={[-0.18, 0.4, 0]}>
        <boxGeometry args={[0.62, 0.34, 0.4]} />
        <meshStandardMaterial color={color} flatShading roughness={0.5} metalness={0.25} />
      </mesh>

      {/* White stripe accent along the tank */}
      <mesh position={[-0.18, 0.32, 0.205]}>
        <boxGeometry args={[0.6, 0.05, 0.005]} />
        <meshStandardMaterial color="#f5f5f5" flatShading roughness={0.4} />
      </mesh>
      <mesh position={[-0.18, 0.32, -0.205]}>
        <boxGeometry args={[0.6, 0.05, 0.005]} />
        <meshStandardMaterial color="#f5f5f5" flatShading roughness={0.4} />
      </mesh>

      {/* Hose reel — cylinder on rear */}
      <mesh position={[-0.46, 0.4, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.1, 0.1, 0.16, 12]} />
        <meshStandardMaterial color={CHROME} metalness={0.7} roughness={0.3} flatShading />
      </mesh>
      <mesh position={[-0.46, 0.4, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.07, 0.07, 0.18, 10]} />
        <meshStandardMaterial color={ACCENT_DARK} flatShading />
      </mesh>

      {/* Light bar on cab roof */}
      <mesh position={[0.32, 0.56, 0]}>
        <boxGeometry args={[0.22, 0.04, 0.34]} />
        <meshStandardMaterial color={ACCENT_DARK} flatShading roughness={0.5} />
      </mesh>
      {/* Red strobe */}
      <mesh position={[0.32, 0.585, -0.1]}>
        <boxGeometry args={[0.18, 0.03, 0.1]} />
        <meshBasicMaterial ref={lightRedRef} color="#ff2233" toneMapped={false} transparent />
      </mesh>
      {/* Blue strobe */}
      <mesh position={[0.32, 0.585, 0.1]}>
        <boxGeometry args={[0.18, 0.03, 0.1]} />
        <meshBasicMaterial ref={lightBlueRef} color="#2255ff" toneMapped={false} transparent />
      </mesh>

      {/* Headlights */}
      <mesh position={[0.5, 0.28, 0.13]}>
        <sphereGeometry args={[0.035, 8, 8]} />
        <meshBasicMaterial color="#fff7d6" toneMapped={false} />
      </mesh>
      <mesh position={[0.5, 0.28, -0.13]}>
        <sphereGeometry args={[0.035, 8, 8]} />
        <meshBasicMaterial color="#fff7d6" toneMapped={false} />
      </mesh>

      {/* Wheels — 4 short cylinders, axis along Z */}
      <group ref={wheelsRef}>
        {(
          [
            [0.32, 0.1, 0.21],
            [0.32, 0.1, -0.21],
            [-0.32, 0.1, 0.21],
            [-0.32, 0.1, -0.21],
          ] as const
        ).map(([x, y, z]) => (
          <mesh key={`${x}-${z}`} position={[x, y, z]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.12, 0.12, 0.08, 12]} />
            <meshStandardMaterial color={WHEEL_COLOR} flatShading roughness={0.85} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
