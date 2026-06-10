/**
 * Level generator — ported from the Java Flappy Bird reference.
 *
 * Reference (see uploaded Flappy zip, GameLoop.java / Pipe.java / Map.java):
 *   • Canvas 1280×720, 6 pipes recycled across the screen.
 *   • pipeWidth = 52, pipeGap = 180, top-pipe offset random in [100..350].
 *   • Spacing between pipes = 1280 / 6 ≈ 213 px.
 *   • Scroll = 3 px every 20 ms = 150 px/s ⇒ scroll_speed = 2.5 (×60fps).
 *
 * All levels now use this same arrangement. Background image, obstacle art
 * and per-level metadata stay intact — only the pipe arrangement / gap /
 * spacing are normalized to the Java reference.
 */
import type { LevelObject } from "@/lib/game.functions";

export type BgKind = "sunset_city" | "night_city" | "nebula" | "desert" | "neon_grid" | "aurora";

export type MapTemplate = {
  id: number;
  name: string;
  bg_color: string;
  bg_kind?: BgKind;
  gravity: number;
  jump_strength: number;
  scroll_speed: number;
  pipe_gap: number;
  pool: LevelObject["obj_type"][];
};

const rnd = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
};

const obj = (
  t: LevelObject["obj_type"],
  x_time: number,
  y: number,
  props: Record<string, number | string | boolean> = {},
): Omit<LevelObject, "id"> => ({ obj_type: t, x_time, y, props });

/* ─── Java reference constants ───────────────────────────────────── */
const REF_W = 1280;
const REF_H = 720;
const REF_PIPE_GAP = 180;
const REF_SPACING_PX = REF_W / 6;        // 213.33 px
const REF_SPEED_PX_PER_SEC = 150;        // 3 px / 20 ms
const REF_OFFSET_MIN = 100;              // Java: (int)(100 + rand*250)
const REF_OFFSET_MAX = 350;

// Spawn interval in seconds (framerate-independent).
const SPAWN_INTERVAL_SEC = REF_SPACING_PX / REF_SPEED_PX_PER_SEC; // ≈ 1.422 s

// Normalized gap-center range derived from the Java random offset:
//   gapCenter = topOffset + pipeGap/2
const GAP_Y_MIN = (REF_OFFSET_MIN + REF_PIPE_GAP / 2) / REF_H; // ≈ 0.264
const GAP_Y_MAX = (REF_OFFSET_MAX + REF_PIPE_GAP / 2) / REF_H; // ≈ 0.611

/* ─── Difficulty tiers ─────────────────────────────────────────────
 * Levels 1-30   → "moon" gravity (low), 8 pipe pairs, wide gap, large spacing.
 * Levels 31-100 → "earth" gravity, 10 pipe pairs, large gap.
 * No spikes / blades / poles — only pipes and a handful of coins.
 */
const MOON_GRAVITY = 0.12;
const MOON_JUMP = -4;
const EARTH_GRAVITY = 0.5;
const EARTH_JUMP = -8;
const MOON_PIPE_GAP = 280;
const EARTH_PIPE_GAP = 240;

type Tier = { pipes: number; gap: number; gravity: number; jump: number; coins: number };

function tierFor(levelIndex: number): Tier {
  if (levelIndex <= 30) {
    return { pipes: 8, gap: MOON_PIPE_GAP, gravity: MOON_GRAVITY, jump: MOON_JUMP, coins: 20 };
  }
  return { pipes: 10, gap: EARTH_PIPE_GAP, gravity: EARTH_GRAVITY, jump: EARTH_JUMP, coins: 24 };
}

/* ─── Map templates (background flavours only) ── */
export const MAP_TEMPLATES: MapTemplate[] = [
  { id: 1,  name: "Classic Pipes",  bg_color: "#0a0a0f", bg_kind: "sunset_city", gravity: EARTH_GRAVITY, jump_strength: EARTH_JUMP, scroll_speed: 2.5, pipe_gap: REF_PIPE_GAP, pool: ["pipe"] },
  { id: 2,  name: "Night Run",      bg_color: "#0f0a14", bg_kind: "night_city",  gravity: EARTH_GRAVITY, jump_strength: EARTH_JUMP, scroll_speed: 2.5, pipe_gap: REF_PIPE_GAP, pool: ["pipe"] },
  { id: 3,  name: "Nebula",         bg_color: "#150f0a", bg_kind: "nebula",      gravity: EARTH_GRAVITY, jump_strength: EARTH_JUMP, scroll_speed: 2.5, pipe_gap: REF_PIPE_GAP, pool: ["pipe"] },
  { id: 4,  name: "Desert Flight",  bg_color: "#0a0f14", bg_kind: "desert",      gravity: EARTH_GRAVITY, jump_strength: EARTH_JUMP, scroll_speed: 2.5, pipe_gap: REF_PIPE_GAP, pool: ["pipe"] },
  { id: 5,  name: "Neon Grid",      bg_color: "#100b04", bg_kind: "neon_grid",   gravity: EARTH_GRAVITY, jump_strength: EARTH_JUMP, scroll_speed: 2.5, pipe_gap: REF_PIPE_GAP, pool: ["pipe"] },
  { id: 6,  name: "Aurora",         bg_color: "#14080a", bg_kind: "aurora",      gravity: EARTH_GRAVITY, jump_strength: EARTH_JUMP, scroll_speed: 2.5, pipe_gap: REF_PIPE_GAP, pool: ["pipe"] },
];

/**
 * Simple easy pipe builder: evenly-spaced pipes across the level duration,
 * no spikes / blades / poles, and a small sprinkle of collectible coins.
 */
function buildPipes(
  duration: number,
  seed: number,
  levelIndex: number,
): Omit<LevelObject, "id">[] {
  const r = rnd(seed);
  const out: Omit<LevelObject, "id">[] = [];
  const tier = tierFor(levelIndex);

  // Spread N pipe pairs evenly between t=2 and t=duration-2.
  const startT = 2;
  const endT = Math.max(startT + 1, duration - 2);
  const span = endT - startT;
  for (let i = 0; i < tier.pipes; i++) {
    const t = startT + ((i + 0.5) / tier.pipes) * span;
    const y = GAP_Y_MIN + r() * (GAP_Y_MAX - GAP_Y_MIN);
    out.push(obj("pipe", t, y));
  }

  // Light coin trail along the safe band.
  const coinStart = 1.5;
  const coinEnd = Math.max(coinStart + 1, duration - 1);
  const step = (coinEnd - coinStart) / tier.coins;
  for (let i = 0; i < tier.coins; i++) {
    const t = coinStart + i * step + (r() - 0.5) * step * 0.3;
    const yWeave = 0.4 + Math.sin(i * 0.6 + r() * 2) * 0.18;
    const y = Math.max(0.2, Math.min(0.8, yWeave));
    out.push(obj("coin", t, y));
  }
  return out;
}

/** Pick a deterministic background flavour for a given level index. */
export function pickMap(
  levelIndex: number,
  seed = 0,
): MapTemplate & { build: (d: number) => Omit<LevelObject, "id">[] } {
  const r = rnd(seed + levelIndex * 7919);
  const base = MAP_TEMPLATES[Math.floor(r() * MAP_TEMPLATES.length)];

  const tier = tierFor(levelIndex);
  return {
    ...base,
    gravity: tier.gravity,
    jump_strength: tier.jump,
    pipe_gap: tier.gap,
    scroll_speed: 2.5,
    pool: ["pipe"],
    build: (duration: number) =>
      buildPipes(duration, seed + levelIndex * 104729, levelIndex),
  };
}
