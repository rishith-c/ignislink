"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface FixedWingProps {
  color: string;
  scale?: number;
}

const COCKPIT_COLOR = "#0e1a24";
const ACCENT_DARK = "#1a1a1a";
const PROP_RPS = 22;
const STROBE_HZ = 2.0;

/**
 * Procedural low-poly fixed-wing air-tanker. Local space, faces +X.
 */
export function FixedWing({ color, scale = 1 }: FixedWingProps) {
  const propLeftRef = useRef<THREE.Group>(null);
  const propRightRef = useRef<THREE.Group>(null);
  const strobeTailRef = useRef<THREE.MeshBasicMaterial>(null);
  const strobeWingLRef = useRef<THREE.MeshBasicMaterial>(null);
  const strobeWingRRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(({ clock }, delta) => {
    if (propLeftRef.current) {
      propLeftRef.current.rotation.x += delta * PROP_RPS * Math.PI * 2;
    }
    if (propRightRef.current) {
      propRightRef.current.rotation.x += delta * PROP_RPS * Math.PI * 2;
    }
    const t = clock.getElapsedTime();
    const pulse = 0.4 + 0.6 * Math.abs(Math.sin(t * Math.PI * STROBE_HZ));
    if (strobeTailRef.current) strobeTailRef.current.opacity = pulse;
    if (strobeWingLRef.current) strobeWingLRef.current.opacity = pulse;
    if (strobeWingRRef.current) strobeWingRRef.current.opacity = pulse;
  });

  return (
    <group scale={scale}>
      {/* Fuselage — long cylinder along X */}
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.16, 0.16, 1.8, 14]} />
        <meshStandardMaterial color={color} flatShading roughness={0.45} metalness={0.35} />
      </mesh>

      {/* Nose cone */}
      <mesh position={[0.92, 0, 0]} scale={[1.1, 1, 1]}>
        <sphereGeometry args={[0.16, 14, 12]} />
        <meshStandardMaterial color={color} flatShading roughness={0.45} metalness={0.35} />
      </mesh>

      {/* Cockpit canopy */}
      <mesh position={[0.6, 0.12, 0]} scale={[1.4, 0.6, 0.9]}>
        <sphereGeometry args={[0.16, 14, 12]} />
        <meshStandardMaterial color={COCKPIT_COLOR} metalness={0.7} roughness={0.1} flatShading />
      </mesh>

      {/* Tail cone — slight taper */}
      <mesh position={[-0.92, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <coneGeometry args={[0.16, 0.3, 12]} />
        <meshStandardMaterial color={color} flatShading roughness={0.5} />
      </mesh>

      {/* Main wings — swept thin boxes along Z */}
      <mesh position={[0.05, 0, 0]} rotation={[0, 0.08, 0]}>
        <boxGeometry args={[0.55, 0.05, 2.2]} />
        <meshStandardMaterial color={color} flatShading roughness={0.5} metalness={0.3} />
      </mesh>

      {/* Vertical stabilizer */}
      <mesh position={[-0.85, 0.25, 0]}>
        <boxGeometry args={[0.32, 0.4, 0.04]} />
        <meshStandardMaterial color={color} flatShading roughness={0.5} />
      </mesh>

      {/* Horizontal stabilizers */}
      <mesh position={[-0.92, 0.05, 0]}>
        <boxGeometry args={[0.28, 0.04, 0.9]} />
        <meshStandardMaterial color={color} flatShading roughness={0.5} />
      </mesh>

      {/* Engine nacelles + propellers */}
      {([0.55, -0.55] as const).map((z) => (
        <group key={z} position={[0.18, -0.08, z]}>
          {/* Nacelle */}
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.09, 0.09, 0.42, 12]} />
            <meshStandardMaterial color={ACCENT_DARK} flatShading roughness={0.5} metalness={0.4} />
          </mesh>
          {/* Spinner */}
          <mesh position={[0.23, 0, 0]}>
            <coneGeometry args={[0.06, 0.1, 10]} />
            <meshStandardMaterial color="#cccccc" metalness={0.7} roughness={0.3} flatShading />
          </mesh>
          {/* Propeller — spinning blades */}
          <group ref={z > 0 ? propLeftRef : propRightRef} position={[0.27, 0, 0]}>
            <mesh>
              <boxGeometry args={[0.02, 0.34, 0.04]} />
              <meshStandardMaterial
                color={ACCENT_DARK}
                transparent
                opacity={0.55}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
                flatShading
              />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <boxGeometry args={[0.02, 0.34, 0.04]} />
              <meshStandardMaterial
                color={ACCENT_DARK}
                transparent
                opacity={0.55}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
                flatShading
              />
            </mesh>
          </group>
        </group>
      ))}

      {/* Strobes — tail and wingtips */}
      <mesh position={[-1.05, 0.05, 0]}>
        <sphereGeometry args={[0.035, 8, 8]} />
        <meshBasicMaterial ref={strobeTailRef} color="#ff2d4a" toneMapped={false} transparent />
      </mesh>
      <mesh position={[0.05, 0, 1.1]}>
        <sphereGeometry args={[0.035, 8, 8]} />
        <meshBasicMaterial ref={strobeWingLRef} color="#22ff7a" toneMapped={false} transparent />
      </mesh>
      <mesh position={[0.05, 0, -1.1]}>
        <sphereGeometry args={[0.035, 8, 8]} />
        <meshBasicMaterial ref={strobeWingRRef} color="#ff2d4a" toneMapped={false} transparent />
      </mesh>
    </group>
  );
}
