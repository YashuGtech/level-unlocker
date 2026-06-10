/**
 * Client-side level builder for the Trial Access mode (external browser play).
 *
 * Mirrors src/lib/maps.server.ts but runs entirely in the browser so users
 * without a Telegram session can preview every level. Obstacles are picked
 * from the official per-level pool (level-obstacles.ts).
 */
import type { LevelObject } from "@/lib/game.functions";
import type { Level } from "@/components/flappy";
import { getAllowedTypesForLevel, ALL_OBSTACLES, type ObsType } from "@/lib/level-obstacles";

const rnd = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
};

const REF_H = 720;
const REF_PIPE_GAP = 180;
const GAP_Y_MIN = (100 + REF_PIPE_GAP / 2) / REF_H;
const GAP_Y_MAX = (350 + REF_PIPE_GAP / 2) / REF_H;

export type TrialBuilt = {
  level: Level;
  objects: LevelObject[];
};

export function buildTrialLevel(levelIndex: number): TrialBuilt {
  const easy = levelIndex <= 30;
  const lvl1 = levelIndex === 1;

  const duration = 60;
  const level: Level = {
    id: `trial-${levelIndex}`,
    name: `Trial · Level ${levelIndex}`,
    duration_seconds: duration,
    gravity: easy ? 0.18 : 0.38,
    jump_strength: easy ? -6 : -8.5,
    scroll_speed: lvl1 ? 1.4 : easy ? 1.8 : 2.5,
    pipe_gap: lvl1 ? 280 : easy ? 240 : 200,
    bg_color: "#0a0a14",
    bg_kind: "night_city",
    repeat_loop: false,
    reward_per_coin: 1,
  };

  const allowed = getAllowedTypesForLevel(levelIndex);
  const pool: ObsType[] = (allowed
    ? Array.from(allowed)
    : [...ALL_OBSTACLES]
  ).filter((t) => t !== "coin");

  const r = rnd(levelIndex * 104729 + 7);
  const out: LevelObject[] = [];
  let id = 0;
  const push = (
    t: ObsType,
    x_time: number,
    y: number,
    props: Record<string, number | string | boolean> = {},
  ) =>
    out.push({ id: `t${id++}`, obj_type: t, x_time, y, props });

  // Pipe / pole / wall pairs — backbone of the level.
  const pipeCount = lvl1 ? 6 : easy ? 8 : 10;
  const startT = 2;
  const endT = duration - 2;
  const span = endT - startT;
  // Always include "pipe" so there's a flight backbone — unless the level
  // explicitly only allows poll/wall, then use those.
  const backbone: ObsType =
    pool.includes("pipe") ? "pipe" :
    pool.includes("poll") ? "poll" :
    pool.includes("wall") ? "wall" : "pipe";
  for (let i = 0; i < pipeCount; i++) {
    const t = startT + ((i + 0.5) / pipeCount) * span;
    const y = GAP_Y_MIN + r() * (GAP_Y_MAX - GAP_Y_MIN);
    push(backbone, t, y);
  }

  // Coin trail.
  const coinCount = lvl1 ? 18 : 24;
  for (let i = 0; i < coinCount; i++) {
    const t = 1.5 + ((i + 0.5) / coinCount) * (duration - 3);
    const y = Math.max(0.2, Math.min(0.8, 0.4 + Math.sin(i * 0.6) * 0.18));
    push("coin", t, y);
  }

  // Sprinkle other obstacles allowed by the level (skip on level 1 to keep it gentle).
  if (!lvl1) {
    const extras = pool.filter(
      (t) => t !== backbone && ["spike", "blade", "hammer", "laser", "block"].includes(t),
    );
    const count = easy ? 4 : 8;
    for (let i = 0; i < count && extras.length > 0; i++) {
      const t = 4 + ((i + 0.5) / count) * (duration - 8);
      const ty = extras[i % extras.length];
      // For blades, force edge placement; for floor blocks use y=0.95; hammers ceiling.
      const y =
        ty === "blade" ? (i % 2 === 0 ? 0.1 : 0.9) :
        ty === "block" ? 0.95 :
        ty === "hammer" ? 0.1 :
        ty === "spike" ? (i % 2 === 0 ? 0.05 : 0.95) :
        0.5;
      push(ty, t, y);
    }
  }

  // Sort by time.
  out.sort((a, b) => a.x_time - b.x_time);
  return { level, objects: out };
}
