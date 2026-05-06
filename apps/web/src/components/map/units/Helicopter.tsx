"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface HelicopterProps {
  color: string;
  scale?: number;
}

const ROTOR_RPS_MAIN = 25; // revolutions per second
const ROTOR_RPS_TAIL = 30;
const STROBE_HZ = 2.5;

const COCKPIT_COLOR = "#0e1a24";
const ACCENT_DARK = "#1a1a1a";

/**
 * Procedural low-poly helicopter rendered in local space at the origin.
 * Body extends along +X (nose forward). The parent group should translate
 * the entire unit; rotors keep spinning regardless of parent motion.
 */
export function Helicopter({ color, scale = 1 }: HelicopterProps) {
  const mainRotorRef = useRef<THREE.Group>(null);
  const tailRotorRef = useRef<THREE.Group>(null);
  const navRedRef = useRef<THREE.MeshBasicMaterial>(null);
  const navGreenRef = useRef<THREE.MeshBasicMaterial>(null);
  const navWhiteRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(({ clock }, delta) => {
    if (mainRotorRef.current) {
      mainRotorRef.current.rotation.y += delta * ROTOR_RPS_MAIN * Math.PI * 2;
    }
    if (tailRotorRef.current) {
      tailRotorRef.current.rotation.x += delta * ROTOR_RPS_TAIL * Math.PI * 2;
    }
    const t = clock.getElapsedTime();
    const pulse = 0.55 + 0.45 * Math.sin(t * Math.PI * 2 * STROBE_HZ);
    const altPulse = 0.55 + 0.45 * Math.sin(t * Math.PI * 2 * STROBE_HZ + Math.PI);
    if (navRedRef.current) navRedRef.current.opacity = pulse;
    if (navGreenRef.current) navGreenRef.current.opacity = pulse;
    if (navWhiteRef.current) navWhiteRef.current.opacity = altPulse;
  });

  return (
    <group scale={scale}>
      {/* Fuselage — cylinder along X axis */}
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.18, 0.18, 1.4, 12]} />
        <meshStandardMaterial color={color} flatShading roughness={0.55} metalness={0.3} />
      </mesh>

      {/* Cockpit nose — sphere at +X end, slightly elongated */}
      <mesh position={[0.7, 0.02, 0]} scale={[1.2, 1, 1]}>
        <sphereGeometry args={[0.18, 14, 12]} />
        <meshStandardMaterial
          color={COCKPIT_COLOR}
          metalness={0.7}
          roughness={0.1}
          flatShading
        />
      </mesh>

      {/* Tail boom — narrow tapered box from rear to tail rotor */}
      <mesh position={[-0.95, 0.05, 0]}>
        <boxGeometry args={[0.95, 0.1, 0.1]} />
        <meshStandardMaterial color={color} flatShading roughness={0.6} />
      </mesh>

      {/* Vertical tail fin */}
      <mesh position={[-1.38, 0.18, 0]}>
        <boxGeometry args={[0.18, 0.28, 0.04]} />
        <meshStandardMaterial color={color} flatShading roughness={0.6} />
      </mesh>

      {/* Tail rotor hub + blades (spin around X axis) */}
      <group ref={tailRotorRef} position={[-1.42, 0.05, 0.08]}>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.025, 0.025, 0.06, 8]} />
          <meshStandardMaterial color={ACCENT_DARK} flatShading />
        </mesh>
        <mesh>
          <boxGeometry args={[0.02, 0.32, 0.04]} />
          <meshStandardMaterial color={ACCENT_DARK} flatShading />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <boxGeometry args={[0.02, 0.32, 0.04]} />
          <meshStandardMaterial color={ACCENT_DARK} flatShading />
        </mesh>
      </group>

      {/* Main rotor mast — vertical cylinder above fuselage */}
      <mesh position={[0.05, 0.28, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 0.22, 8]} />
        <meshStandardMaterial color={ACCENT_DARK} flatShading metalness={0.6} roughness={0.4} />
      </mesh>

      {/* Main rotor — 4 crossed blades, additive blended for motion-blur disc */}
      <group ref={mainRotorRef} position={[0.05, 0.4, 0]}>
        {/* Hub */}
        <mesh>
          <cylinderGeometry args={[0.05, 0.05, 0.04, 8]} />
          <meshStandardMaterial color={ACCENT_DARK} flatShading />
        </mesh>
        {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((rot) => (
          <mesh key={rot} rotation={[0, rot, 0]}>
            <boxGeometry args={[1.6, 0.04, 0.06]} />
            <meshStandardMaterial
              color={ACCENT_DARK}
              transparent
              opacity={0.45}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              flatShading
            />
          </mesh>
        ))}
      </group>

      {/* Skids — two long thin cylinders below, parallel to X */}
      {[-0.18, 0.18].map((z) => (
        <group key={z} position={[0, -0.22, z]}>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.025, 0.025, 1.0, 8]} />
            <meshStandardMaterial color={ACCENT_DARK} flatShading metalness={0.4} roughness={0.5} />
          </mesh>
          {/* Strut connectors */}
          <mesh position={[0.25, 0.1, 0]}>
            <boxGeometry args={[0.025, 0.2, 0.025]} />
            <meshStandardMaterial color={ACCENT_DARK} flatShading />
          </mesh>
          <mesh position={[-0.25, 0.1, 0]}>
            <boxGeometry args={[0.025, 0.2, 0.025]} />
            <meshStandardMaterial color={ACCENT_DARK} flatShading />
          </mesh>
        </group>
      ))}

      {/* Nav lights — strobed via ref */}
      <mesh position={[0.85, 0.02, 0]}>
        <sphereGeometry args={[0.035, 8, 8]} />
        <meshBasicMaterial ref={navRedRef} color="#ff2d4a" toneMapped={false} transparent />
      </mesh>
      <mesh position={[-1.42, 0.05, -0.02]}>
        <sphereGeometry args={[0.03, 8, 8]} />
        <meshBasicMaterial ref={navGreenRef} color="#22ff7a" toneMapped={false} transparent />
      </mesh>
      <mesh position={[0.05, 0.52, 0]}>
        <sphereGeometry args={[0.03, 8, 8]} />
        <meshBasicMaterial ref={navWhiteRef} color="#ffffff" toneMapped={false} transparent />
      </mesh>
    </group>
  );
}
