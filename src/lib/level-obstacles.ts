/**
 * Official per-level obstacle pool — driven by the Flapy_Gtech_100_Level_Breakdown PDF.
 *
 * Each entry is the set of obj_type values that are allowed to render on that
 * level. `null` means "all obstacles allowed". Bull + flying bear are always
 * allowed (they are scheduled by the engine, not by level data).
 *
 * Mapping from PDF names → engine obj_type:
 *   Gold Pipes        → "pipe"
 *   Gold Poles Bottom → "poll"
 *   Brick Wall Poles  → "wall"
 *   Blocks            → "block"
 *   Spikes            → "spike"
 *   Hanging Hammers   → "hammer"
 *   Rotating Blades   → "blade"
 *   Spinning Blades   → "blade"
 *   Laser Beams       → "laser"
 *   Bear Coin         → "coin"
 */
export type ObsType =
  | "pipe" | "coin" | "bear" | "spike" | "spike_wall" | "poll"
  | "wall" | "block" | "gate" | "blade" | "hammer" | "laser" | "shooter";

const ALL: ObsType[] = ["pipe", "poll", "wall", "block", "spike", "hammer", "blade", "laser", "coin"];

const RAW: Record<number, ObsType[] | "all"> = {
  // Level 1 is intentionally simple per product direction — only pipes + coins.
  1: ["pipe", "coin"],
  2: ["poll", "block"],
  3: ["pipe", "coin"],
  4: ["wall", "coin"],
  5: ["pipe", "spike"],
  6: ["block", "spike"],
  7: ["poll", "coin"],
  8: ["wall", "spike"],
  9: ["pipe", "hammer"],
  10: ["block", "hammer"],
  11: "all",
  12: ["blade", "block"],
  13: ["blade", "coin"],
  14: ["blade", "spike"],
  15: ["wall", "blade"],
  16: ["pipe", "blade"],
  17: ["hammer", "coin"],
  18: ["blade", "spike"],
  19: ["blade", "block"],
  20: ["pipe", "hammer"],
  21: "all",
  22: ["laser", "pipe"],
  23: ["laser", "coin"],
  24: ["laser", "spike"],
  25: ["laser", "hammer"],
  26: ["blade", "laser"],
  27: ["blade", "laser"],
  28: ["wall", "laser"],
  29: ["poll", "laser"],
  30: ["laser", "coin"],
  31: ["laser", "blade"], 32: ["laser", "blade"], 33: ["spike", "hammer"], 34: ["wall", "laser"],
  35: ["pipe", "blade"], 36: ["poll", "spike"], 37: ["coin", "laser"], 38: ["hammer", "blade"],
  39: ["block", "spike"], 40: ["block", "laser"],
  41: ["laser", "blade"], 42: ["laser", "blade"], 43: ["spike", "hammer"], 44: ["wall", "laser"],
  45: ["pipe", "blade"], 46: ["poll", "spike"], 47: ["coin", "laser"], 48: ["hammer", "blade"],
  49: ["block", "spike"], 50: "all",
  51: ["laser", "blade"], 52: ["laser", "blade"], 53: ["spike", "hammer"], 54: ["wall", "laser"],
  55: ["pipe", "blade"], 56: ["poll", "spike"], 57: ["coin", "laser"], 58: ["hammer", "blade"],
  59: ["block", "spike"], 60: ["block", "laser"],
  61: ["laser", "blade"], 62: ["laser", "blade"], 63: ["spike", "hammer"], 64: ["wall", "laser"],
  65: ["pipe", "blade"], 66: ["poll", "spike"], 67: ["coin", "laser"], 68: ["hammer", "blade"],
  69: ["block", "spike"], 70: ["block", "laser"],
  71: ["laser", "blade"], 72: ["laser", "blade"], 73: ["spike", "hammer"], 74: ["wall", "laser"],
  75: "all", 76: ["poll", "spike"], 77: ["coin", "laser"], 78: ["hammer", "blade"],
  79: ["block", "spike"], 80: ["block", "laser"],
  81: ["laser", "blade"], 82: ["laser", "blade"], 83: ["spike", "hammer"], 84: ["wall", "laser"],
  85: ["pipe", "blade"], 86: ["poll", "spike"], 87: ["coin", "laser"], 88: ["hammer", "blade"],
  89: ["block", "spike"], 90: ["block", "laser"],
  91: ["laser", "blade"], 92: ["laser", "blade"], 93: ["spike", "hammer"], 94: ["wall", "laser"],
  95: ["pipe", "blade"], 96: ["poll", "spike"], 97: ["coin", "laser"], 98: ["hammer", "blade"],
  99: "all", 100: "all",
};

/**
 * Returns the allowed obstacle types for a level. Per product direction, every
 * level now permits every obstacle that the dev placed in /dev — real players
 * see exactly what the developer built. Returning null = "no restriction".
 */
export function getAllowedTypesForLevel(_levelIndex: number): Set<ObsType> | null {
  return null;
}

/** Pretty obstacle list for level pickers / HUD overlays. */
export function describeLevel(_levelIndex: number): string {
  return "Gold Pipes, Poles, Walls, Blocks, Spikes, Hammers, Blades, Lasers, Coins";
}

export const ALL_OBSTACLES = ALL;


