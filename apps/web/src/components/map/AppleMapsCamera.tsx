"use client";

// Apple-Maps-Flyover-style camera control for the SENTRY 3D fire simulator.
//
// Provides three named presets (tactical / regional / overview) and tweens the
// camera between them on a 1.2s ease-out cubic. OrbitControls is configured
// for a polished flyover feel: damped, bounded polar angle so mountains stay
// visible at every zoom, and a generous max-distance for the regional view.
//
// Wiring contract:
//   <AppleMapsCameraProvider>
//     <Canvas>
//       <AppleMapsCamera />
//       ...scene...
//     </Canvas>
//     <AppleMapsCameraControls />
//   </AppleMapsCameraProvider>
//
// The provider holds a small piece of shared state (preset + look-at target)
// so the in-Canvas <AppleMapsCamera /> and the out-of-Canvas
// <AppleMapsCameraControls /> can stay decoupled.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";

// ─────────────── Presets ───────────────

export type AppleMapsCameraPreset = "tactical" | "regional" | "overview";

interface PresetConfig {
  /** Camera world-space position for this preset. */
  position: readonly [number, number, number];
  /** Initial dolly distance — used as the OrbitControls initial radius. */
  distance: number;
  /** Human label for the UI. */
  label: string;
}

const PRESETS: Record<AppleMapsCameraPreset, PresetConfig> = {
  tactical: { position: [12, 8, 14], distance: 18, label: "Tactical" },
  regional: { position: [40, 30, 40], distance: 60, label: "Regional" },
  overview: { position: [75, 55, 75], distance: 110, label: "Overview" },
};

const PRESET_ORDER: ReadonlyArray<AppleMapsCameraPreset> = [
  "tactical",
  "regional",
  "overview",
];

const TWEEN_DURATION_SEC = 1.2;

// ─────────────── Context ───────────────

type Vec3 = readonly [number, number, number];

interface AppleMapsCameraContextValue {
  preset: AppleMapsCameraPreset;
  setPreset: (preset: AppleMapsCameraPreset) => void;
  target: Vec3;
  setTarget: (target: Vec3) => void;
}

const AppleMapsCameraContext =
  createContext<AppleMapsCameraContextValue | null>(null);

interface AppleMapsCameraProviderProps {
  children: ReactNode;
  initialPreset?: AppleMapsCameraPreset;
  initialTarget?: Vec3;
}

export function AppleMapsCameraProvider({
  children,
  initialPreset = "tactical",
  initialTarget = [0, 0, 0],
}: AppleMapsCameraProviderProps) {
  const [preset, setPreset] = useState<AppleMapsCameraPreset>(initialPreset);
  const [target, setTarget] = useState<Vec3>(initialTarget);

  const value = useMemo<AppleMapsCameraContextValue>(
    () => ({ preset, setPreset, target, setTarget }),
    [preset, target],
  );

  return (
    <AppleMapsCameraContext.Provider value={value}>
      {children}
    </AppleMapsCameraContext.Provider>
  );
}

/**
 * Imperative-ish controller hook. Returns the current preset and target plus
 * setters. Safe to call from anywhere inside <AppleMapsCameraProvider>, both
 * inside and outside <Canvas>.
 */
export function useAppleMapsCamera(): AppleMapsCameraContextValue {
  const ctx = useContext(AppleMapsCameraContext);
  if (!ctx) {
    throw new Error(
      "useAppleMapsCamera must be used inside <AppleMapsCameraProvider>",
    );
  }
  return ctx;
}

// ─────────────── In-Canvas camera component ───────────────

interface AppleMapsCameraProps {
  /** Initial preset on first mount. Ignored after mount. */
  initialPreset?: AppleMapsCameraPreset;
  /** Optional explicit look-at target. Falls back to context target. */
  target?: Vec3;
  /** When false, OrbitControls is disabled (e.g. during a cinematic tour). */
  enabled?: boolean;
}

/**
 * Renders <OrbitControls /> with Apple-Maps-Flyover-style settings and
 * smoothly tweens the camera on preset changes (1.2s ease-out cubic).
 *
 * MUST be rendered as a child of <Canvas> and inside
 * <AppleMapsCameraProvider>.
 */
export function AppleMapsCamera({
  initialPreset,
  target: targetProp,
  enabled = true,
}: AppleMapsCameraProps) {
  const ctx = useContext(AppleMapsCameraContext);
  if (!ctx) {
    throw new Error(
      "<AppleMapsCamera /> must be rendered inside <AppleMapsCameraProvider>",
    );
  }

  const { preset, setPreset, target: ctxTarget } = ctx;
  const target: Vec3 = targetProp ?? ctxTarget;

  const { camera } = useThree();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  // Tween state — re-armed on every preset change.
  const tweenStart = useRef<number | null>(null);
  const tweenFromPos = useRef<THREE.Vector3 | null>(null);
  const tweenToPos = useRef<THREE.Vector3 | null>(null);
  const tweenFromTarget = useRef<THREE.Vector3 | null>(null);
  const tweenToTarget = useRef<THREE.Vector3 | null>(null);

  // Apply initial preset exactly once on mount, before any tween fires.
  const initialised = useRef(false);
  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;
    const start = initialPreset ?? preset;
    const cfg = PRESETS[start];
    camera.position.set(cfg.position[0], cfg.position[1], cfg.position[2]);
    camera.lookAt(target[0], target[1], target[2]);
    if (initialPreset && initialPreset !== preset) {
      setPreset(initialPreset);
    }
    // We intentionally only run on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Arm a tween whenever the preset (or target) changes.
  useEffect(() => {
    if (!initialised.current) return;
    const cfg = PRESETS[preset];
    tweenFromPos.current = camera.position.clone();
    tweenToPos.current = new THREE.Vector3(
      cfg.position[0],
      cfg.position[1],
      cfg.position[2],
    );
    const currentTarget = controlsRef.current?.target.clone() ??
      new THREE.Vector3(target[0], target[1], target[2]);
    tweenFromTarget.current = currentTarget;
    tweenToTarget.current = new THREE.Vector3(target[0], target[1], target[2]);
    tweenStart.current = null;
  }, [preset, target, camera]);

  useFrame(({ clock }) => {
    const fromPos = tweenFromPos.current;
    const toPos = tweenToPos.current;
    const fromTarget = tweenFromTarget.current;
    const toTarget = tweenToTarget.current;
    if (!fromPos || !toPos || !fromTarget || !toTarget) return;

    if (tweenStart.current === null) {
      tweenStart.current = clock.getElapsedTime();
    }
    const elapsed = clock.getElapsedTime() - tweenStart.current;
    const t = Math.min(1, elapsed / TWEEN_DURATION_SEC);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic

    camera.position.lerpVectors(fromPos, toPos, eased);

    const controls = controlsRef.current;
    if (controls) {
      controls.target.lerpVectors(fromTarget, toTarget, eased);
      controls.update();
    } else {
      // Fallback if controls aren't ready yet.
      const lookAt = new THREE.Vector3().lerpVectors(fromTarget, toTarget, eased);
      camera.lookAt(lookAt);
    }

    if (t >= 1) {
      tweenFromPos.current = null;
      tweenToPos.current = null;
      tweenFromTarget.current = null;
      tweenToTarget.current = null;
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.08}
      minDistance={6}
      maxDistance={140}
      maxPolarAngle={Math.PI / 2.05}
      minPolarAngle={Math.PI / 8}
      rotateSpeed={0.7}
      zoomSpeed={0.9}
      panSpeed={0.6}
      target={target}
      enabled={enabled}
    />
  );
}

// ─────────────── Out-of-Canvas UI overlay ───────────────

interface AppleMapsCameraControlsProps {
  /** Optional callback fired after a preset is selected. */
  onChange?: (preset: AppleMapsCameraPreset) => void;
  /** Extra Tailwind classes appended to the root pill. */
  className?: string;
}

/**
 * Glassy top-right button group for switching between presets. Render OUTSIDE
 * the Canvas, anywhere inside <AppleMapsCameraProvider>.
 */
export function AppleMapsCameraControls({
  onChange,
  className,
}: AppleMapsCameraControlsProps) {
  const { preset, setPreset } = useAppleMapsCamera();

  const handleSelect = useCallback(
    (next: AppleMapsCameraPreset) => {
      if (next === preset) return;
      setPreset(next);
      onChange?.(next);
    },
    [preset, setPreset, onChange],
  );

  const baseClasses =
    "flex items-center gap-1 bg-black/70 backdrop-blur border border-white/10 rounded-full text-xs text-white/80 px-1 py-1 shadow-lg pointer-events-auto";
  const rootClasses = className ? `${baseClasses} ${className}` : baseClasses;

  return (
    <div className={rootClasses} role="radiogroup" aria-label="Camera preset">
      {PRESET_ORDER.map((name) => {
        const cfg = PRESETS[name];
        const active = preset === name;
        const buttonClasses = [
          "px-3 py-1 rounded-full transition-colors",
          active
            ? "bg-white/15 text-white"
            : "text-white/60 hover:text-white hover:bg-white/5",
        ].join(" ");
        return (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => handleSelect(name)}
            className={buttonClasses}
          >
            {cfg.label}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────── Exports ───────────────

export { PRESETS as APPLE_MAPS_CAMERA_PRESETS };
