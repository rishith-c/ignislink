"use client";

import { useEffect, useRef } from "react";
import { ALBERS_WIDTH, ALBERS_HEIGHT } from "./projection";

export interface ParticleSource {
  id: string;
  /** Pixel coords in the 975×610 albers viewport. */
  x: number;
  y: number;
  /** Wind direction degrees (meteorological "from" convention — 0 = wind from N).
   *  Particles drift TO the opposite direction (where the fire is going). */
  windDirDeg: number;
  /** Wind speed m/s — drives particle velocity. */
  windSpeedMs: number;
  /** Active = spawn particles. EMERGING + UNREPORTED + CREWS_ACTIVE only. */
  active: boolean;
  /** Color tint (hex). */
  color: string;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  color: string;
}

interface FireParticlesProps {
  sources: ParticleSource[];
  /** Match the SVG viewport so canvas overlays pixel-for-pixel. */
  className?: string;
}

const SPAWN_PER_SOURCE_PER_FRAME = 0.9;
const PARTICLE_LIFE_FRAMES = 130; // ~2.2 s at 60 fps
const FADE_BASE = 0.92; // background trail fade per frame
const SPREAD_VELOCITY_SCALE = 0.085; // pixels per (m/s) per frame

export function FireParticles({ sources, className }: FireParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const sourcesRef = useRef<ParticleSource[]>(sources);
  const rafRef = useRef<number | null>(null);

  // Keep sources fresh in the rAF closure.
  useEffect(() => {
    sourcesRef.current = sources;
  }, [sources]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const ctx: CanvasRenderingContext2D = context;

    // Internal canvas resolution = albers viewport, scaled by DPR for crispness.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = ALBERS_WIDTH * dpr;
    canvas.height = ALBERS_HEIGHT * dpr;
    ctx.scale(dpr, dpr);

    let spawnAccumulator = 0;

    function tick() {
      // Slowly fade the prior frame to leave a trail.
      ctx.globalCompositeOperation = "destination-in";
      ctx.fillStyle = `rgba(0, 0, 0, ${FADE_BASE})`;
      ctx.fillRect(0, 0, ALBERS_WIDTH, ALBERS_HEIGHT);
      ctx.globalCompositeOperation = "lighter";

      // Spawn new particles for each active source.
      spawnAccumulator += SPAWN_PER_SOURCE_PER_FRAME;
      const spawnEach = Math.floor(spawnAccumulator);
      spawnAccumulator -= spawnEach;
      if (spawnEach > 0) {
        for (const s of sourcesRef.current) {
          if (!s.active) continue;
          for (let i = 0; i < spawnEach; i++) {
            // Wind FROM dir → particles drift TO the opposite direction.
            const toDeg = (s.windDirDeg + 180) % 360;
            const toRad = (toDeg * Math.PI) / 180;
            // 0° = north (up). x = sin, y = -cos.
            const baseVx = Math.sin(toRad);
            const baseVy = -Math.cos(toRad);
            // Small angular jitter for an ember-like spread cone.
            const jitter = (Math.random() - 0.5) * 0.45;
            const c = Math.cos(jitter);
            const sn = Math.sin(jitter);
            const vx = (baseVx * c - baseVy * sn) * s.windSpeedMs * SPREAD_VELOCITY_SCALE;
            const vy = (baseVx * sn + baseVy * c) * s.windSpeedMs * SPREAD_VELOCITY_SCALE;

            // Slight initial offset so particles don't all start exactly on the dot.
            const r0 = Math.random() * 2.5;
            const a0 = Math.random() * Math.PI * 2;
            particlesRef.current.push({
              x: s.x + Math.cos(a0) * r0,
              y: s.y + Math.sin(a0) * r0,
              vx,
              vy,
              age: 0,
              life: PARTICLE_LIFE_FRAMES * (0.7 + Math.random() * 0.6),
              color: s.color,
            });
          }
        }
      }

      // Update + draw.
      const next: Particle[] = [];
      for (const p of particlesRef.current) {
        p.age += 1;
        if (p.age >= p.life) continue;
        // Slight buoyant drift up — fire convection.
        p.vy -= 0.0035;
        // Decay velocity a hair so very long-lived particles don't fly off.
        p.vx *= 0.997;
        p.vy *= 0.997;
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > ALBERS_WIDTH || p.y < 0 || p.y > ALBERS_HEIGHT) continue;

        const lifeFrac = p.age / p.life;
        const alpha = Math.max(0, 1 - lifeFrac) * 0.9;
        // Color shifts ember → smoke: start saturated, end gray.
        const r = parseInt(p.color.slice(1, 3), 16);
        const g = parseInt(p.color.slice(3, 5), 16);
        const b = parseInt(p.color.slice(5, 7), 16);
        const t = Math.min(1, lifeFrac * 1.3);
        const er = Math.round(r * (1 - t) + 110 * t);
        const eg = Math.round(g * (1 - t) + 110 * t);
        const eb = Math.round(b * (1 - t) + 110 * t);
        ctx.fillStyle = `rgba(${er}, ${eg}, ${eb}, ${alpha})`;
        const radius = 1.6 + (1 - lifeFrac) * 1.4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();
        next.push(p);
      }
      // Hard cap to keep mem stable (worst case ~ #sources × frames × spawn-rate).
      particlesRef.current = next.length > 8000 ? next.slice(-8000) : next;

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        width: "100%",
        height: "100%",
        display: "block",
        pointerEvents: "none",
      }}
      aria-hidden
    />
  );
}
