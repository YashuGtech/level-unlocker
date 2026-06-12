/**
 * Flappy GTECH canvas engine — premium gold visuals matching the reference.
 * Pipes have gold gradient + caps, bears are glowing gold coin-bears,
 * coins are bright gold, backgrounds rotate through painted themes,
 * and SFX play on flap/coin/hit/win.
 */
import { useEffect, useRef, useState } from "react";
import type { LevelObject } from "@/lib/game.functions";

import { sfx } from "@/lib/sfx";
import bg1Url from "@/assets/flappy-bg/bg1.jpg";
import bg2Url from "@/assets/flappy-bg/bg2.jpg";
import bg3Url from "@/assets/flappy-bg/bg3.jpg";
import bullUrl from "@/assets/bull.png";
import bearUrl from "@/assets/bear.png";
import spikeUrl from "@/assets/spike-brick.png";
import pipeBrickUrl from "@/assets/pipe-brick.png";
import bladeChainUrl from "@/assets/blade-chain.png";

// Kept for backwards compat with existing level configs in DB.
export type BgKind = "sunset_city" | "night_city" | "nebula" | "desert" | "neon_grid" | "aurora";

const KOMMODO_BG_URLS = [bg1Url, bg2Url, bg3Url];

// Module-level image cache so we decode each background once.
const bgImageCache: HTMLImageElement[] = [];
function getBgImages(): HTMLImageElement[] {
  if (bgImageCache.length === 0 && typeof window !== "undefined") {
    for (const url of KOMMODO_BG_URLS) {
      const img = new Image();
      img.src = url;
      bgImageCache.push(img);
    }
  }
  return bgImageCache;
}

let bullImg: HTMLImageElement | null = null;
let bearImg: HTMLImageElement | null = null;
let spikeImg: HTMLImageElement | null = null;
let pipeBrickImg: HTMLImageElement | null = null;
let bladeChainImg: HTMLImageElement | null = null;
function loadImg(ref: HTMLImageElement | null, url: string): HTMLImageElement | null {
  if (typeof window === "undefined") return null;
  if (ref) return ref;
  const i = new Image();
  i.src = url;
  return i;
}
function getBullImg() { return (bullImg ||= loadImg(bullImg, bullUrl)); }
function getBearImg() { return (bearImg ||= loadImg(bearImg, bearUrl)); }
function getSpikeImg() { return (spikeImg ||= loadImg(spikeImg, spikeUrl)); }
function getPipeBrickImg() { return (pipeBrickImg ||= loadImg(pipeBrickImg, pipeBrickUrl)); }
function getBladeChainImg() { return (bladeChainImg ||= loadImg(bladeChainImg, bladeChainUrl)); }

export type Level = {
  id: string;
  name: string;
  duration_seconds: number;
  gravity: number;
  jump_strength: number;
  scroll_speed: number;
  pipe_gap: number;
  bg_color: string;
  bg_kind?: BgKind;
  repeat_loop: boolean;
  reward_per_coin: number;
};

type FlappyProps = {
  level: Level;
  objects: LevelObject[];
  /** 1..1000 — controls bull/bear scheduling (combined window unlocks at 30+). */
  levelIndex?: number;
  /** Admin dev mode — bird is invincible until the level timer ends. */
  devMode?: boolean;
  /**
   * Admin/editor preview — disables the per-level allow-list (PDF
   * breakdown) and ultra-easy tuning so every obstacle the user placed in
   * the editor actually renders during preview play.
   */
  editorPreview?: boolean;
  /** Seconds of post-resume invincibility (used after Resume / Revive). */
  resumeGraceSec?: number;
  /** Seconds into the level to start at (used by "Resume from death point"). */
  initialRunTime?: number;
  onEnd: (result: { completed: boolean; coins: number; elapsed: number }) => void;
};

// ── Pipe arrangement ported from the Java Flappy Bird reference ─────
// Reference: 1280×720, pipeWidth=52, pipeHeight=425, pipeGap=180,
// 6 pipes spaced evenly across the canvas (distance = W/6 ≈ 213px),
// top-pipe offset randomized in [100..350], scroll 3px / 20ms = 150px/s.
const BIRD_X_RATIO = 0.28;
const BIRD_SIZE = 32;
const PIPE_W = 52;            // Java Pipe.pipeWidth
const PIPE_CAP_H = 22;
const PIPE_CAP_OVERHANG = 8;
const FIXED_PIPE_GAP = 180;   // Java Map.pipeGap
const PIPE_SPACING_PX = 213;  // Java GameLoop distance = 1280 / nP(6)
const GAP_MIN_CENTER = 190;   // topOffset(100) + pipeGap/2(90)
const GAP_BOTTOM_PAD = 280;   // 720 - (topOffset_max 350 + pipeGap/2 90)
const COIN_R = 14;
const BEAR_R = 22;
const SPIKE_W = 72;
const SPIKE_H = 56;


type Active = LevelObject & { spawnX: number; consumed?: boolean; pipeVariant?: "gold" | "brick" };

export function Flappy({ level, objects, levelIndex = 1, devMode = false, editorPreview = false, resumeGraceSec = 0, initialRunTime = 0, onEnd }: FlappyProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [coins, setCoins] = useState(0);
  const [timeLeft, setTimeLeft] = useState(level.duration_seconds);
  const ended = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    // Cap DPR to 1 — high-DPR mobile screens were rendering at 4× pixel
    // count which thrashed the canvas (every gradient/shine fill scales
    // with pixel area). Visually identical, ~3-4× faster on phones.
    const dpr = 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width;
    const H = rect.height;
    const bgKind: BgKind = level.bg_kind ?? "night_city";
    // Pick one of the 3 kommodo backgrounds deterministically from the
    // level config — same level always renders against the same backdrop.
    const bgImages = getBgImages();
    const bgPickSeed = (level.id || level.name || bgKind)
      .split("")
      .reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    const heroBg = bgImages[bgPickSeed % bgImages.length] ?? bgImages[0];

    const bird = { x: W * BIRD_X_RATIO, y: H / 2, vy: 0 };
    let coinCount = 0;
    let lastT = performance.now();
    let runTime = Math.max(0, initialRunTime || 0);
    let raf = 0;
    let active: Active[] = [];
    let nextIdx = 0;
    const sortedObjs = [...objects].sort((a, b) => a.x_time - b.x_time);
    // If resuming mid-level, fast-forward the spawn pointer past obstacles
    // whose x_time is already in the past so we don't pile up off-screen.
    while (nextIdx < sortedObjs.length && sortedObjs[nextIdx].x_time < runTime - 0.5) {
      nextIdx++;
    }

    // ── Dev-authored physics ─────────────────────────────────────
    // Use EXACTLY what the dev set in /dev for this level. No tier
    // overrides — gravity, jump, scroll, and pipe gap come from the
    // level row so changes saved in /dev apply instantly to all
    // real-time players and Dev Trial previews.
    const eGravity = level.gravity;
    const eJump = level.jump_strength;
    const eScroll = level.scroll_speed;
    const ePipeGap = level.pipe_gap;

    // BACKEND-ONLY MODE: render exactly what the dev team placed in the
    // editor. The per-level PDF allow-list has been removed so every gold
    // pipe, pole, wall, blade, hammer, laser, etc. saved in /dev shows up
    // for real players. No random/template fallback obstacles are spawned.
    
    const TIER_51_PLUS = levelIndex >= 51;

    // ── Scheduled bull + flying bear windows ─────────────────────
    // Bull chases for 6s; bear appears 5s and fires 1 laser/sec.
    type Window = { start: number; end: number };
    const D = level.duration_seconds;
    const BULL_CHASE_SEC = 6;
    const BEAR_APPEAR_SEC = 5;
    // Bull first, then bear — strictly non-overlapping, mandatory every level.
    const bullWindow: Window = { start: Math.max(5, D * 0.18), end: 0 };
    bullWindow.end = bullWindow.start + BULL_CHASE_SEC;
    const bearWindow: Window = { start: bullWindow.end + 4, end: 0 };
    bearWindow.end = bearWindow.start + BEAR_APPEAR_SEC;
    // No combined/simultaneous window — they must never appear together.
    const combinedWindow: Window | null = null;
    const inWindow = (w: Window | null, t: number) =>
      !!w && t >= w.start && t < w.end;

    const bull = { x: -200, y: H / 2, alive: false, baseSpeed: 0 };
    let bullWall = 0; // seconds since this bull-window opened
    let graceTimer = Math.max(0, resumeGraceSec); // post-resume invincibility
    function SCROLL_PX_PER_SEC_INIT() { return eScroll * 60; }
    type Proj = { x: number; y: number; vx: number; vy: number; kind: "arrow" | "laser"; life: number };
    const projectiles: Proj[] = [];
    let lastBearShot = 0;
    const flyingBear = { x: W * 0.8, y: 80, t: 0, alive: false };

    // ── Universal obstacles visible in ALL levels (1–100) ────────────
    // Swinging hammers hang from the ceiling — they sweep through the
    // TOP THIRD of the canvas only, never blocking the main flight path.
    // Block stacks sit on the floor — they occupy the BOTTOM THIRD only.
    // A central safe lane (~40% of H) is always clear so timing the swing
    // is optional; players can simply fly the middle to pass.
    type Hammer = { x: number; phase: number; period: number; len: number };
    type BlockStack = { x: number; cols: number; rows: number };
    const hammers: Hammer[] = [];
    const blocks: BlockStack[] = [];
    let lastBlockSpawnX = -Infinity;
    const BLOCK_SPACING = 380;
    const HAMMER_PIVOT_Y = 0;
    // Reduced hammer head + arm size — smaller silhouette, bigger flight gap.
    const HAMMER_HEAD_W = 32;
    const HAMMER_HEAD_H = 18;
    const BLOCK_TILE = 30;

    // BACKEND-ONLY MODE: no auto-scheduled hammers. Hammers are placed by
    // the dev team in the level editor and rendered through the per-object
    // hammer branch below.
    const hammersAllowed = false;
    const HAMMER_COUNT = 0;
    const hammerSchedule: number[] = [];
    let hammerCursor = 0;
    // Tier 51+: cap rotating blades to 4–6 per level (consumed from level data).
    // Mandatory 5 blades per level (editor-locked) — never cap below that.
    const BLADE_CAP_51 = Infinity;
    let bladeUsed = 0;
    // Cached "seconds left" value so we only call setTimeLeft when it changes.
    let lastShownTL = level.duration_seconds;


    const flap = () => {
      if (ended.current) return;
      bird.vy = eJump * 60;
      sfx.flap();
    };

    const onPointer = () => flap();
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        flap();
      }
    };
    canvas.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);

    const stop = (completed: boolean) => {
      if (ended.current) return;
      // Dev mode (admin): cannot die from obstacles, only the timer can end
      // the run (which calls stop(true)).
      if (!completed && devMode) return;
      // Post-resume grace: obstacles do not kill during the grace window.
      if (!completed && graceTimer > 0) return;
      ended.current = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
      if (completed) sfx.win();
      else sfx.hit();
      onEnd({ completed, coins: coinCount, elapsed: runTime });
    };


    /* ── BACKGROUNDS ─────────────────────────────────────────────── */
    const drawSky = (top: string, mid: string, bot: string) => {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, top);
      g.addColorStop(0.55, mid);
      g.addColorStop(1, bot);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    };

    const drawStars = (count: number, seed: number) => {
      ctx.fillStyle = "rgba(255,240,200,0.85)";
      for (let i = 0; i < count; i++) {
        const x = ((Math.sin(i * seed) + 1) * 0.5 * W) % W;
        const y = ((Math.cos(i * (seed + 0.3)) + 1) * 0.5 * H * 0.55) % (H * 0.55);
        const r = (i % 3 === 0) ? 1.4 : 0.8;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const drawSkyline = (yBase: number, color: string, parallax: number, density: number, seed: number) => {
      ctx.fillStyle = color;
      const shift = (runTime * level.scroll_speed * 60 * parallax) % 80;
      let x = -shift;
      let i = seed;
      while (x < W + 80) {
        const w = 24 + ((Math.sin(i * 1.7) + 1) * 18);
        const h = 40 + ((Math.cos(i * 1.3) + 1) * density);
        ctx.fillRect(x, yBase - h, w, h);
        // window lights
        ctx.save();
        ctx.fillStyle = "rgba(255,200,90,0.55)";
        for (let wy = yBase - h + 6; wy < yBase - 4; wy += 7) {
          for (let wx = x + 3; wx < x + w - 3; wx += 5) {
            if ((wx * 7 + wy * 3 + i) % 5 === 0) ctx.fillRect(wx, wy, 2, 3);
          }
        }
        ctx.restore();
        ctx.fillStyle = color;
        x += w + 2;
        i += 0.7;
      }
    };

    const drawDunes = (yBase: number, color: string, parallax: number, amp: number) => {
      const shift = runTime * level.scroll_speed * 60 * parallax;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 16) {
        const y = yBase + Math.sin((x + shift) * 0.012) * amp + Math.sin((x + shift) * 0.04) * (amp * 0.3);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
    };

    const drawGrid = () => {
      ctx.strokeStyle = "rgba(212,162,76,0.08)";
      ctx.lineWidth = 1;
      const grid = 32;
      const shift = (runTime * level.scroll_speed * 60) % grid;
      for (let x = -shift; x < W; x += grid) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
      for (let y = 0; y < H; y += grid) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
    };

    const drawBg = () => {
      // Always render one of the 3 kommodo backgrounds. If the image hasn't
      // decoded yet on the first frame, fall back to a dark fill so we never
      // flash white.
      if (heroBg && heroBg.complete && heroBg.naturalWidth > 0) {
        // cover-fit: scale to fill the canvas while preserving aspect ratio.
        const iw = heroBg.naturalWidth;
        const ih = heroBg.naturalHeight;
        const scale = Math.max(W / iw, H / ih);
        const dw = iw * scale;
        const dh = ih * scale;
        // Slow horizontal parallax so the scene feels alive.
        const drift = ((runTime * level.scroll_speed * 18) % Math.max(1, dw - W));
        const dx = -drift;
        const dy = (H - dh) / 2;
        ctx.drawImage(heroBg, dx, dy, dw, dh);
      } else {
        ctx.fillStyle = "#0a0a14";
        ctx.fillRect(0, 0, W, H);
      }
      // Subtle vignette so foreground entities stay readable.
      const vg = ctx.createLinearGradient(0, 0, 0, H);
      vg.addColorStop(0, "rgba(0,0,0,0.35)");
      vg.addColorStop(0.55, "rgba(0,0,0,0.05)");
      vg.addColorStop(1, "rgba(0,0,0,0.55)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    };

    /* ── ENTITIES ────────────────────────────────────────────────── */
    // Lightweight shine — single fill rect instead of clipped gradient per call.
    // Big perf win when many obstacles are on screen at once.
    const drawShine = (x: number, y: number, w: number, h: number) => {
      const period = 2.4;
      const t = (runTime % period) / period;
      const stripeW = Math.max(12, Math.min(w, h) * 0.4);
      const sx = x + t * (w + stripeW) - stripeW / 2;
      const left = Math.max(x, sx);
      const right = Math.min(x + w, sx + stripeW);
      if (right <= left) return;
      ctx.fillStyle = "rgba(255,245,210,0.18)";
      ctx.fillRect(left, y, right - left, h);
    };

    const goldGradV = (x: number) => {
      const g = ctx.createLinearGradient(x, 0, x + PIPE_W, 0);
      g.addColorStop(0, "#6e4a14");
      g.addColorStop(0.15, "#a87828");
      g.addColorStop(0.5, "#fde08a");
      g.addColorStop(0.85, "#a87828");
      g.addColorStop(1, "#6e4a14");
      return g;
    };

    // Source rect for the BL "standing pipe" inside pipe-brick.png (1448×1086).
    const PIPE_SRC = { x: 426, y: 543, w: 191, h: 542 };
    const drawPipe = (x: number, gapY: number, gap: number, variant: "gold" | "brick" = "gold") => {
      const topH = gapY - gap / 2;
      const botY = gapY + gap / 2;
      const img = getPipeBrickImg();

      const drawBrickColumn = (dy: number, dh: number, flipY: boolean) => {
        if (dh <= 0) return;
        if (img && img.complete && img.naturalWidth > 0) {
          ctx.save();
          if (flipY) {
            ctx.translate(x + PIPE_W / 2, dy + dh);
            ctx.scale(1, -1);
            ctx.drawImage(img, PIPE_SRC.x, PIPE_SRC.y, PIPE_SRC.w, PIPE_SRC.h,
              -PIPE_W / 2, 0, PIPE_W, dh);
          } else {
            ctx.drawImage(img, PIPE_SRC.x, PIPE_SRC.y, PIPE_SRC.w, PIPE_SRC.h,
              x, dy, PIPE_W, dh);
          }
          ctx.restore();
        } else {
          ctx.fillStyle = "#c2461b";
          ctx.fillRect(x, dy, PIPE_W, dh);
        }
      };

      const drawGoldColumn = (dy: number, dh: number, capOnTop: boolean) => {
        if (dh <= 0) return;
        const capH = Math.min(18, dh);
        // Shaft
        ctx.fillStyle = goldGradV(x);
        ctx.fillRect(x, dy, PIPE_W, dh);
        // Cap (slightly wider) at the gap-facing end
        const capY = capOnTop ? dy : dy + dh - capH;
        const capX = x - 4;
        const capW = PIPE_W + 8;
        ctx.fillStyle = goldGradV(capX);
        ctx.fillRect(capX, capY, capW, capH);
        // Outline
        ctx.strokeStyle = "rgba(60,40,10,0.55)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, dy + 0.5, PIPE_W - 1, dh - 1);
        ctx.strokeRect(capX + 0.5, capY + 0.5, capW - 1, capH - 1);
        drawShine(x, dy, PIPE_W, dh);
      };

      if (variant === "brick") {
        drawBrickColumn(0, topH, true);
        drawBrickColumn(botY, H - botY, false);
      } else {
        // Top (ceiling) pipe — cap at the bottom (near the gap)
        drawGoldColumn(0, topH, false);
        // Bottom (floor) pipe — cap on top (near the gap)
        drawGoldColumn(botY, H - botY, true);
      }
    };

    const drawCoin = (x: number, y: number) => {
      // Pulsing halo
      const pulse = 0.6 + 0.4 * Math.sin(runTime * 6 + x * 0.05);
      ctx.save();
      ctx.shadowColor = `rgba(255,220,120,${0.75 * pulse})`;
      ctx.shadowBlur = 18 + 8 * pulse;
      const grad = ctx.createRadialGradient(x - 3, y - 3, 2, x, y, COIN_R);
      grad.addColorStop(0, "#fff8dc");
      grad.addColorStop(0.5, "#f2d27a");
      grad.addColorStop(1, "#8a6420");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, COIN_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = "#d4a24c";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "#3a2a10";
      ctx.font = `bold ${Math.round(COIN_R * 0.7)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("GTC", x, y + 1);
      // Sparkles orbiting the coin
      ctx.save();
      ctx.fillStyle = `rgba(255,255,230,${0.85 * pulse})`;
      for (let i = 0; i < 4; i++) {
        const a = runTime * 3 + i * (Math.PI / 2) + x * 0.01;
        const r = COIN_R + 6 + Math.sin(runTime * 4 + i) * 2;
        const sx = x + Math.cos(a) * r;
        const sy = y + Math.sin(a) * r;
        const sz = 1.2 + Math.abs(Math.sin(runTime * 5 + i)) * 1.4;
        ctx.beginPath();
        ctx.arc(sx, sy, sz, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };

    const drawBear = (x: number, y: number) => {
      // Glowing gold ring (matches reference: bear-coin with halo)
      ctx.save();
      ctx.shadowColor = "rgba(255,200,80,0.9)";
      ctx.shadowBlur = 18;
      ctx.strokeStyle = "#f2d27a";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, BEAR_R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      // Inner coin
      const grad = ctx.createRadialGradient(x - 4, y - 4, 3, x, y, BEAR_R - 2);
      grad.addColorStop(0, "#fde7a8");
      grad.addColorStop(0.7, "#c89438");
      grad.addColorStop(1, "#5a3a10");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, BEAR_R - 2, 0, Math.PI * 2);
      ctx.fill();
      // Bear silhouette
      ctx.fillStyle = "#3a2208";
      ctx.beginPath();
      ctx.arc(x, y + 1, BEAR_R * 0.55, 0, Math.PI * 2);
      ctx.fill();
      // Ears
      ctx.beginPath();
      ctx.arc(x - 8, y - 8, 4, 0, Math.PI * 2);
      ctx.arc(x + 8, y - 8, 4, 0, Math.PI * 2);
      ctx.fill();
      // Snout
      ctx.fillStyle = "#a87828";
      ctx.beginPath();
      ctx.arc(x, y + 5, 4, 0, Math.PI * 2);
      ctx.fill();
    };

    const drawSpike = (x: number, y: number) => {
      // Spike sprite anchored to the y the admin placed in the editor.
      // y < H/2  → ceiling-mounted spike (cones point DOWN at the bird)
      // y >= H/2 → floor-mounted spike   (cones point UP at the bird)
      const fromTop = y < H / 2;
      const img = getSpikeImg();
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.save();
        if (fromTop) {
          // Flip vertically; sprite extends downward from `y`.
          ctx.translate(x, y + SPIKE_H);
          ctx.scale(1, -1);
          ctx.drawImage(img, -SPIKE_W / 2, 0, SPIKE_W, SPIKE_H);
        } else {
          // Floor-style mount: sprite extends upward to `y`.
          ctx.drawImage(img, x - SPIKE_W / 2, y - SPIKE_H, SPIKE_W, SPIKE_H);
        }
        ctx.restore();
      } else {
        // Fallback if sprite not decoded yet.
        ctx.fillStyle = "#6a4818";
        const baseY = fromTop ? y : y - SPIKE_H;
        ctx.fillRect(x - SPIKE_W / 2, baseY, SPIKE_W, SPIKE_H);
      }
    };

    /* ── NEW OBSTACLE TYPES ──────────────────────────────────────── */
    const WALL_W = 26;
    const BLOCK_S = 44;
    const BLADE_R = 26;
    // Hammer arm reduced globally so the head never blocks the flight band.
    const HAMMER_LEN = 48;
    const SHOOTER_W = 36;

    const drawWall = (x: number, yMid: number, oscAmp: number) => {
      const yc = yMid + (oscAmp ? Math.sin(runTime * 2.2) * oscAmp * H : 0);
      const h = H * 0.5;
      const grad = ctx.createLinearGradient(x, 0, x + WALL_W, 0);
      grad.addColorStop(0, "#5a4014"); grad.addColorStop(0.5, "#d4a24c"); grad.addColorStop(1, "#5a4014");
      ctx.fillStyle = grad;
      ctx.fillRect(x, yc - h / 2, WALL_W, h);
      ctx.strokeStyle = "#2a1c08"; ctx.lineWidth = 1.4;
      ctx.strokeRect(x, yc - h / 2, WALL_W, h);
      drawShine(x, yc - h / 2, WALL_W, h);
      return { x, y: yc - h / 2, w: WALL_W, h };
    };
    const drawBlock = (x: number, y: number) => {
      const g = ctx.createLinearGradient(x, y - BLOCK_S / 2, x, y + BLOCK_S / 2);
      g.addColorStop(0, "#fde08a"); g.addColorStop(1, "#7a5618");
      ctx.fillStyle = g;
      ctx.fillRect(x - BLOCK_S / 2, y - BLOCK_S / 2, BLOCK_S, BLOCK_S);
      ctx.strokeStyle = "#2a1c08"; ctx.lineWidth = 1.4;
      ctx.strokeRect(x - BLOCK_S / 2, y - BLOCK_S / 2, BLOCK_S, BLOCK_S);
      drawShine(x - BLOCK_S / 2, y - BLOCK_S / 2, BLOCK_S, BLOCK_S);
      return { x: x - BLOCK_S / 2, y: y - BLOCK_S / 2, w: BLOCK_S, h: BLOCK_S };
    };
    const drawGate = (x: number, y: number) => {
      // Two pillars with narrow horizontal opening band
      const halfGap = 70;
      ctx.fillStyle = "#a87828";
      ctx.fillRect(x - 8, 0, 16, y - halfGap);
      ctx.fillRect(x - 8, y + halfGap, 16, H - (y + halfGap));
      ctx.strokeStyle = "#fde08a"; ctx.lineWidth = 2;
      ctx.strokeRect(x - 8, 0, 16, y - halfGap);
      ctx.strokeRect(x - 8, y + halfGap, 16, H - (y + halfGap));
      drawShine(x - 8, 0, 16, y - halfGap);
      drawShine(x - 8, y + halfGap, 16, H - (y + halfGap));
      return { x: x - 8, top: y - halfGap, bot: y + halfGap };
    };
    const drawBlade = (x: number, y: number, speed: number) => {
      // Hangs from the ceiling on a chain. The whole sprite (chain anchor +
      // chain + spiked wheel) is mounted at top; the wheel rotates around its
      // own center.
      const img = getBladeChainImg();
      if (img && img.complete && img.naturalWidth > 0) {
        const iw = img.naturalWidth;
        const ih = img.naturalHeight;
        // Render full sprite at fixed width 56, height scaled to fit.
        const w = 56;
        const h = w * (ih / iw);
        // anchor: top of sprite at y=0, wheel center sits at ~y near sprite bottom
        const drawH = Math.min(h, y + BLADE_R);
        const drawW = w * (drawH / h);
        ctx.save();
        // Static chain + anchor + wheel-base drawn at top
        ctx.drawImage(img, x - drawW / 2, 0, drawW, drawH);
        ctx.restore();
        // Overlay a spinning wheel on top: re-draw the wheel area (bottom 45% of sprite)
        const wheelSrcY = ih * 0.55;
        const wheelSrcH = ih * 0.45;
        const wheelW = drawW * 1.0;
        const wheelH = wheelW * (wheelSrcH / (iw));
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(runTime * speed);
        ctx.drawImage(img, 0, wheelSrcY, iw, wheelSrcH,
          -wheelW / 2, -wheelH / 2, wheelW, wheelH);
        ctx.restore();
      } else {
        // Fallback procedural blade
        ctx.strokeStyle = "#7a5a20"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, y - BLADE_R); ctx.stroke();
        ctx.save(); ctx.translate(x, y); ctx.rotate(runTime * speed);
        ctx.fillStyle = "#a87828";
        ctx.beginPath(); ctx.arc(0, 0, BLADE_R, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    };
    const drawHammer = (x: number, amp: number, period: number) => {
      const ang = Math.sin((runTime / period) * Math.PI * 2) * amp;
      ctx.save(); ctx.translate(x, 0); ctx.rotate(ang);
      ctx.strokeStyle = "#a87828"; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, HAMMER_LEN); ctx.stroke();
      ctx.fillStyle = "#d4a24c";
      ctx.fillRect(-22, HAMMER_LEN, 44, 26);
      ctx.strokeStyle = "#2a1c08"; ctx.lineWidth = 1.4;
      ctx.strokeRect(-22, HAMMER_LEN, 44, 26);
      ctx.restore();
      // hit center in world coords
      const hx = x + Math.sin(ang) * (HAMMER_LEN + 13);
      const hy = Math.cos(ang) * (HAMMER_LEN + 13);
      return { hx, hy };
    };
    const drawLaser = (x: number, y: number, on: number, off: number) => {
      const period = on + off;
      const phase = runTime % period;
      const active = phase < on;
      ctx.strokeStyle = active ? "rgba(255,210,90,0.95)" : "rgba(255,210,90,0.18)";
      ctx.lineWidth = active ? 6 : 2;
      ctx.shadowColor = "rgba(255,140,40,0.8)"; ctx.shadowBlur = active ? 18 : 0;
      ctx.beginPath(); ctx.moveTo(x, y - 80); ctx.lineTo(x, y + 80); ctx.stroke();
      ctx.shadowBlur = 0;
      // emitter caps
      ctx.fillStyle = "#7a5a20";
      ctx.fillRect(x - 8, y - 86, 16, 6);
      ctx.fillRect(x - 8, y + 80, 16, 6);
      return active ? { x: x - 3, y: y - 80, w: 6, h: 160 } : null;
    };
    const drawShooter = (x: number, y: number, rate: number, o: Active) => {
      // Vertical arrow shooter: turrets at top fire DOWN, turrets at bottom
      // fire UP. Arrows travel slowly so the player can simply fly above or
      // below the lane to escape. Arrows never track the bird.
      const fromTop = y < H / 2;
      const interval = 1 / Math.max(0.2, rate);
      const last = Number(o.props._last ?? -interval);
      if (runTime - last >= interval && x > -40 && x < W + 40) {
        const sp = 90; // slow, easy to escape
        projectiles.push({
          x,
          y: fromTop ? y + 18 : y - 18,
          vx: 0,
          vy: fromTop ? sp : -sp,
          kind: "arrow",
          life: 6,
        });
        o.props._last = runTime;
      }
      // Turret body anchored at the spawn edge.
      ctx.fillStyle = "#7a5a20";
      ctx.fillRect(x - SHOOTER_W / 2, y - 14, SHOOTER_W, 28);
      ctx.fillStyle = "#fde08a";
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
      // Barrel hint pointing in fire direction.
      ctx.fillStyle = "#3a2208";
      if (fromTop) ctx.fillRect(x - 2, y + 14, 4, 6);
      else ctx.fillRect(x - 2, y - 20, 4, 6);
    };


    // Vertical wall of spikes — instantly fatal on touch.
    const SPIKE_WALL_W = 28;
    const drawSpikeWall = (x: number, side: "top" | "bottom") => {
      const teeth = 7;
      const tH = SPIKE_H;
      const totalH = teeth * tH;
      const yStart = side === "top" ? 0 : H - totalH;
      ctx.fillStyle = "#c92020";
      ctx.fillRect(x - SPIKE_WALL_W / 2, yStart, 6, totalH);
      const g = ctx.createLinearGradient(x - SPIKE_WALL_W / 2, 0, x + SPIKE_WALL_W / 2, 0);
      g.addColorStop(0, "#7a5a20"); g.addColorStop(0.5, "#f2d27a"); g.addColorStop(1, "#7a5a20");
      ctx.fillStyle = g;
      for (let i = 0; i < teeth; i++) {
        const cy = yStart + i * tH + tH / 2;
        ctx.beginPath();
        ctx.moveTo(x - SPIKE_WALL_W / 2, cy - tH / 2);
        ctx.lineTo(x + SPIKE_WALL_W / 2, cy);
        ctx.lineTo(x - SPIKE_WALL_W / 2, cy + tH / 2);
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = "#3a2208"; ctx.lineWidth = 1;
      ctx.strokeRect(x - SPIKE_WALL_W / 2, yStart, SPIKE_WALL_W, totalH);
      return { x: x - SPIKE_WALL_W / 2, y: yStart, w: SPIKE_WALL_W, h: totalH };
    };

    /* ── BULL (chases) + CORNER BEAR (shoots) ────────────────────── */
    const bullSprite = getBullImg();
    const bearSprite = getBearImg();
    const drawBull = () => {
      if (!bull.alive) return;
      const size = 120;
      if (bullSprite && bullSprite.complete && bullSprite.naturalWidth > 0) {
        ctx.save();
        ctx.shadowColor = "rgba(255,60,40,0.95)"; ctx.shadowBlur = 28;
        ctx.drawImage(bullSprite, bull.x - size / 2, bull.y - size / 2, size, size);
        ctx.restore();
        ctx.fillStyle = "rgba(255,220,160,0.35)";
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(bull.x - size / 2 - i * 14, bull.y + size / 4, 6 + i * 2, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        ctx.fillStyle = "#c62828";
        ctx.fillRect(bull.x - 36, bull.y - 24, 72, 36);
      }
    };
    const drawFlyingBear = () => {
      const size = 110;
      const bx = flyingBear.x;
      const by = flyingBear.y;
      if (bearSprite && bearSprite.complete && bearSprite.naturalWidth > 0) {
        ctx.save();
        ctx.shadowColor = "rgba(255,80,40,0.9)"; ctx.shadowBlur = 24;
        // Subtle wing flap rotation
        ctx.translate(bx, by);
        ctx.rotate(Math.sin(flyingBear.t * 6) * 0.08);
        ctx.drawImage(bearSprite, -size / 2, -size / 2, size, size);
        ctx.restore();
      } else {
        ctx.fillStyle = "#3a2208";
        ctx.beginPath(); ctx.arc(bx, by, 32, 0, Math.PI * 2); ctx.fill();
      }
    };
    const drawProjectile = (p: Proj) => {
      if (p.kind === "arrow") {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(p.vy, p.vx));
        ctx.fillStyle = "#fde08a";
        ctx.fillRect(-12, -1.5, 22, 3);
        ctx.beginPath(); ctx.moveTo(10, -4); ctx.lineTo(16, 0); ctx.lineTo(10, 4); ctx.closePath(); ctx.fill();
        ctx.restore();
      } else {
        ctx.strokeStyle = "rgba(255,80,200,0.95)"; ctx.lineWidth = 4;
        ctx.shadowColor = "rgba(255,80,200,0.8)"; ctx.shadowBlur = 14;
        ctx.beginPath(); ctx.moveTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); ctx.lineTo(p.x, p.y); ctx.stroke();
        ctx.shadowBlur = 0;
      }
    };

    const drawBird = () => {
      ctx.save();
      ctx.translate(bird.x, bird.y);
      const rot = Math.max(-0.5, Math.min(1, bird.vy / 500));
      ctx.rotate(rot);
      ctx.shadowColor = "rgba(255,210,90,0.95)";
      ctx.shadowBlur = 20;
      const grad = ctx.createRadialGradient(-4, -4, 3, 0, 0, BIRD_SIZE / 2);
      grad.addColorStop(0, "#fff1b8");
      grad.addColorStop(0.6, "#f2d27a");
      grad.addColorStop(1, "#8a6420");
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(0, 0, BIRD_SIZE / 2, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "#3a2a10"; ctx.lineWidth = 1.8; ctx.stroke();
      ctx.fillStyle = "#3a2a10";
      ctx.font = `bold ${Math.round(BIRD_SIZE * 0.36)}px sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("GTC", 0, 1);
      // Shiny sparkles orbiting the player
      ctx.fillStyle = "rgba(255,250,210,0.95)";
      for (let i = 0; i < 5; i++) {
        const a = runTime * 4 + i * (Math.PI * 2 / 5);
        const r = BIRD_SIZE / 2 + 5 + Math.sin(runTime * 6 + i) * 2;
        const sx = Math.cos(a) * r;
        const sy = Math.sin(a) * r;
        const sz = 1 + Math.abs(Math.sin(runTime * 7 + i * 1.3)) * 1.6;
        ctx.beginPath();
        ctx.arc(sx, sy, sz, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      // Post-resume shield: pulsing aura while grace is active.
      if (graceTimer > 0) {
        const pulse = 0.55 + 0.35 * Math.sin(performance.now() / 90);
        ctx.save();
        ctx.translate(bird.x, bird.y);
        ctx.strokeStyle = `rgba(120,220,255,${pulse})`;
        ctx.shadowColor = "rgba(120,220,255,0.9)";
        ctx.shadowBlur = 18;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, BIRD_SIZE / 2 + 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = "rgba(120,220,255,0.95)";
        ctx.font = "bold 14px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`SHIELD ${graceTimer.toFixed(1)}s`, W / 2, 24);
      }
    };

    const SCROLL_PX_PER_SEC = eScroll * 60;
    const SPAWN_LEAD_PX = W;
    const SPAWN_LEAD_SEC = SPAWN_LEAD_PX / SCROLL_PX_PER_SEC;
    bull.baseSpeed = SCROLL_PX_PER_SEC * 0.45;

    const aabb = (ax: number, ay: number, aw: number, ah: number, br: number) =>
      bird.x + br > ax && bird.x - br < ax + aw && bird.y + br > ay && bird.y - br < ay + ah;

    const tick = (now: number) => {
      const rdt = Math.min(0.05, (now - lastT) / 1000); // real wallclock delta
      lastT = now;

      // Scheduled bull/bear activation. Bull lives for exactly 10s once its
      // window opens; same for the flying bear. At level 30+ they may share
      // the final combined window.
      const wantBull = inWindow(bullWindow, runTime) || inWindow(combinedWindow, runTime);
      const wantBear = inWindow(bearWindow, runTime) || inWindow(combinedWindow, runTime);
      if (wantBull && !bull.alive) {
        bull.alive = true;
        bull.x = -160;
        bull.y = bird.y;
        bullWall = 0;
      } else if (!wantBull && bull.alive) {
        bull.alive = false;
      }
      if (bull.alive) bullWall += rdt;
      if (wantBear && !flyingBear.alive) {
        flyingBear.alive = true;
        flyingBear.t = 0;
        lastBearShot = runTime;
      } else if (!wantBear && flyingBear.alive) {
        flyingBear.alive = false;
        // Clear any laser beams still in flight once the bear is gone.
        for (let i = projectiles.length - 1; i >= 0; i--) {
          if (projectiles[i].kind === "laser") projectiles.splice(i, 1);
        }
      }

      // Speed boost only applies once the bull is actually visible on
      // screen. While the bull is still off-screen (x < 0) the world
      // scrolls at normal speed so the player sees the bull arrive first.
      const bullOnScreen = bull.alive && bull.x > -BIRD_SIZE;
      const speedMul = bullOnScreen ? 2 : 1;
      const dt = rdt;
      runTime += dt * speedMul;
      if (graceTimer > 0) graceTimer = Math.max(0, graceTimer - rdt);
      // Only update the HUD when the displayed second actually changes —
      // calling setState every frame caused React to re-render 60×/sec,
      // which was the main source of in-game lag on mobile.
      const nextTL = Math.max(0, Math.ceil(level.duration_seconds - runTime));
      if (nextTL !== lastShownTL) {
        lastShownTL = nextTL;
        setTimeLeft(nextTL);
      }

      bird.vy += eGravity * 60 * dt * 60;
      bird.y += bird.vy * dt;

      // Falling / hitting the ceiling no longer kills the player — clamp the
      // bird inside the canvas. Death only comes from obstacles, poles, etc.
      if (bird.y - BIRD_SIZE / 2 < 0) {
        bird.y = BIRD_SIZE / 2;
        if (bird.vy < 0) bird.vy = 0;
      }
      if (bird.y + BIRD_SIZE / 2 > H) {
        bird.y = H - BIRD_SIZE / 2;
        if (bird.vy > 0) bird.vy = 0;
      }

      const scrollNow = SCROLL_PX_PER_SEC * speedMul;
      let lastPipeSpawnX = -Infinity;
      while (nextIdx < sortedObjs.length && sortedObjs[nextIdx].x_time <= runTime + SPAWN_LEAD_SEC) {
        const obj = sortedObjs[nextIdx];
        // No per-level allow-list — every obstacle the dev placed in /dev
        // is rendered as-is for real players.
        // Rotating/spinning blades — respect the editor-placed y so admins can
        // position them anywhere on the canvas (no forced snap to top/bottom).
        if (obj.obj_type === "blade") {
          if (TIER_51_PLUS) {
            if (bladeUsed >= BLADE_CAP_51) { nextIdx++; continue; }
            bladeUsed++;
          }
        }
        const offsetSec = obj.x_time - runTime;
        const spawnX = W + offsetSec * SCROLL_PX_PER_SEC;
        // No minimum-spacing enforcement — pipes/polls render exactly where the
        // editor placed them so admins can pack obstacles close together.
        let variant: "gold" | "brick" | undefined;
        if (obj.obj_type === "pipe" || obj.obj_type === "poll") {
          lastPipeSpawnX = spawnX;
          // Half gold, half brick — alternate so ~50% of pipes are golden in every level.
          variant = (nextIdx % 2 === 0) ? "gold" : "brick";
        }
        active.push({ ...obj, spawnX, pipeVariant: variant });
        nextIdx++;
      }


      drawBg();

      active = active.filter((o) => {
        o.spawnX -= scrollNow * dt;
        const x = o.spawnX;
        const y = o.y * H;

        if (x < -120) return false;

        if (o.obj_type === "pipe") {
          // Match flappy_gtc: fixed gap (152), clamped gap center.
          const gap = ePipeGap;
          const gapY = Math.max(GAP_MIN_CENTER, Math.min(H - GAP_BOTTOM_PAD, o.y * H));
          drawPipe(x, gapY, gap, o.pipeVariant ?? "gold");
          if (
            bird.x + BIRD_SIZE / 2 > x &&
            bird.x - BIRD_SIZE / 2 < x + PIPE_W &&
            (bird.y - BIRD_SIZE / 2 < gapY - gap / 2 || bird.y + BIRD_SIZE / 2 > gapY + gap / 2)
          ) stop(false);

        } else if (o.obj_type === "coin") {
          if (!o.consumed) {
            drawCoin(x, y);
            const dx = bird.x - x, dy = bird.y - y;
            if (dx * dx + dy * dy < (BIRD_SIZE / 2 + COIN_R) ** 2) {
              o.consumed = true; coinCount++; setCoins(coinCount); sfx.coin();
            }
          }
        } else if (o.obj_type === "bear") {
          drawBear(x, y);
          const dx = bird.x - x, dy = bird.y - y;
          if (dx * dx + dy * dy < (BIRD_SIZE / 2 + BEAR_R) ** 2) stop(false);
        } else if (o.obj_type === "spike") {
          // Render the spike exactly at the y the editor stored. The cone
          // direction is inferred from which half of the canvas it sits in.
          const fromTopSp = o.y < 0.5;
          const spCenterY = fromTopSp ? y + SPIKE_H / 2 : y - SPIKE_H / 2;
          drawSpike(x, y);
          if (Math.abs(bird.x - x) < SPIKE_W / 2 + BIRD_SIZE / 2 &&
              Math.abs(bird.y - spCenterY) < SPIKE_H / 2 + BIRD_SIZE / 2) stop(false);
        } else if (o.obj_type === "spike_wall") {
          const side: "top" | "bottom" = o.y < 0.5 ? "top" : "bottom";
          const b = drawSpikeWall(x, side);
          if (aabb(b.x, b.y, b.w, b.h, BIRD_SIZE / 2)) stop(false);
        } else if (o.obj_type === "poll") {
          // Classic Flappy-style scrolling pole pair (top + bottom) with a
          // vertical gap the player flies through. Matches the reference
          // FlappyGTECH gameplay — poles move with the world from right→left.
          const poleGap = ePipeGap;

          const poleW = 34;
          const pg = ctx.createLinearGradient(x - poleW / 2, 0, x + poleW / 2, 0);
          pg.addColorStop(0, "#6e4a14");
          pg.addColorStop(0.5, "#fde08a");
          pg.addColorStop(1, "#8a5a18");
          ctx.fillStyle = pg;
          // top pole
          ctx.fillRect(x - poleW / 2, 0, poleW, y - poleGap / 2);
          // bottom pole
          ctx.fillRect(x - poleW / 2, y + poleGap / 2, poleW, H - (y + poleGap / 2));
          // caps for that classic pipe-cap look
          ctx.fillStyle = "#c9941f";
          ctx.fillRect(x - poleW / 2 - 5, y - poleGap / 2 - 14, poleW + 10, 14);
          ctx.fillRect(x - poleW / 2 - 5, y + poleGap / 2, poleW + 10, 14);
          ctx.strokeStyle = "#2a1c08";
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x - poleW / 2, 0, poleW, y - poleGap / 2);
          ctx.strokeRect(x - poleW / 2, y + poleGap / 2, poleW, H - (y + poleGap / 2));
          drawShine(x - poleW / 2, 0, poleW, y - poleGap / 2);
          drawShine(x - poleW / 2, y + poleGap / 2, poleW, H - (y + poleGap / 2));
          if (
            bird.x + BIRD_SIZE / 2 > x - poleW / 2 &&
            bird.x - BIRD_SIZE / 2 < x + poleW / 2 &&
            (bird.y - BIRD_SIZE / 2 < y - poleGap / 2 || bird.y + BIRD_SIZE / 2 > y + poleGap / 2)
          ) stop(false);

        } else if (o.obj_type === "wall") {
          const b = drawWall(x, y, Number(o.props.osc ?? 0));
          if (aabb(b.x, b.y, b.w, b.h, BIRD_SIZE / 2)) stop(false);
        } else if (o.obj_type === "block") {
          const b = drawBlock(x, y);
          if (aabb(b.x, b.y, b.w, b.h, BIRD_SIZE / 2)) stop(false);
        } else if (o.obj_type === "gate") {
          const g = drawGate(x, y);
          if (bird.x + BIRD_SIZE / 2 > g.x && bird.x - BIRD_SIZE / 2 < g.x + 16 &&
              (bird.y - BIRD_SIZE / 2 < g.top || bird.y + BIRD_SIZE / 2 > g.bot)) stop(false);
        } else if (o.obj_type === "blade") {
          drawBlade(x, y, Number(o.props.speed ?? 4));
          const dx = bird.x - x, dy = bird.y - y;
          if (dx * dx + dy * dy < (BIRD_SIZE / 2 + BLADE_R - 4) ** 2) stop(false);
        } else if (o.obj_type === "hammer") {
          // Swinging hammer hanging from the ceiling. The pivot stays fixed
          // at the top, only the arm + head swing left/right with a sine
          // oscillation — matches the reference brass-hammer-on-chain art.
          const amp = Number(o.props.amp ?? 0.9);
          const period = Number(o.props.period ?? 1.8);
          const ang = Math.sin((runTime / period) * Math.PI * 2) * amp;
          const armLen = Math.max(28, y - 8);
          const headW = 44;
          const headH = 26;
          // Chain
          ctx.strokeStyle = "#8a6a28"; ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          const headX = x + Math.sin(ang) * armLen;
          const headY = Math.cos(ang) * armLen;
          ctx.lineTo(headX, headY);
          ctx.stroke();
          // Ceiling anchor
          ctx.fillStyle = "#3a2a10";
          ctx.fillRect(x - 7, 0, 14, 6);
          // Hammer head
          ctx.save();
          ctx.translate(headX, headY);
          ctx.rotate(ang);
          const hg = ctx.createLinearGradient(0, -headH / 2, 0, headH / 2);
          hg.addColorStop(0, "#fde08a"); hg.addColorStop(0.5, "#c9941f"); hg.addColorStop(1, "#6e4a14");
          ctx.fillStyle = hg;
          ctx.fillRect(-headW / 2, -headH / 2, headW, headH);
          ctx.strokeStyle = "#2a1c08"; ctx.lineWidth = 1.4;
          ctx.strokeRect(-headW / 2, -headH / 2, headW, headH);
          ctx.fillStyle = "#3a2a10";
          ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
          // Collision against the head only
          if (Math.abs(bird.x - headX) < headW / 2 + BIRD_SIZE / 2 - 4 &&
              Math.abs(bird.y - headY) < headH / 2 + BIRD_SIZE / 2 - 4) stop(false);

        } else if (o.obj_type === "laser") {
          const hit = drawLaser(x, y, Number(o.props.on ?? 1), Number(o.props.off ?? 1));
          if (hit && aabb(hit.x, hit.y, hit.w, hit.h, BIRD_SIZE / 2)) stop(false);
        } else if (o.obj_type === "shooter") {
          drawShooter(x, y, Number(o.props.rate ?? 1.2), o);
        }

        return true;
      });

      /* BACKEND-ONLY MODE: no universal random hammers or floor block stacks.
       * Every obstacle visible to real players comes from level_objects in the
       * database. The hammers[] / blocks[] arrays below are kept (rendering
       * no-ops when empty) so the existing render loops remain valid. */


      // Render + move hammers
      for (let i = hammers.length - 1; i >= 0; i--) {
        const hm = hammers[i];
        hm.x -= scrollNow * dt;
        if (hm.x < -120) { hammers.splice(i, 1); continue; }
        // Swing arc clamped so the head never crosses below ~y = H*0.42
        const maxAng = 0.9; // ~52°
        const ang = Math.sin(performance.now() / 1000 / hm.period * Math.PI * 2 + hm.phase) * maxAng;
        const chainX2 = hm.x + Math.sin(ang) * hm.len;
        const chainY2 = HAMMER_PIVOT_Y + Math.cos(ang) * hm.len;
        // Chain
        ctx.strokeStyle = "#8a6a28"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(hm.x, HAMMER_PIVOT_Y); ctx.lineTo(chainX2, chainY2); ctx.stroke();
        // Anchor
        ctx.fillStyle = "#3a2a10"; ctx.fillRect(hm.x - 6, 0, 12, 6);
        // Hammer head
        ctx.save(); ctx.translate(chainX2, chainY2); ctx.rotate(ang);
        const hg = ctx.createLinearGradient(0, -HAMMER_HEAD_H / 2, 0, HAMMER_HEAD_H / 2);
        hg.addColorStop(0, "#c9941f"); hg.addColorStop(0.5, "#fde08a"); hg.addColorStop(1, "#6e4a14");
        ctx.fillStyle = hg;
        ctx.fillRect(-HAMMER_HEAD_W / 2, -HAMMER_HEAD_H / 2, HAMMER_HEAD_W, HAMMER_HEAD_H);
        ctx.strokeStyle = "#2a1c08"; ctx.lineWidth = 1.4;
        ctx.strokeRect(-HAMMER_HEAD_W / 2, -HAMMER_HEAD_H / 2, HAMMER_HEAD_W, HAMMER_HEAD_H);
        // Center spiral hint
        ctx.fillStyle = "#3a2a10";
        ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        // Collision: bird vs hammer head
        if (Math.abs(bird.x - chainX2) < HAMMER_HEAD_W / 2 + BIRD_SIZE / 2 - 4 &&
            Math.abs(bird.y - chainY2) < HAMMER_HEAD_H / 2 + BIRD_SIZE / 2 - 4) stop(false);
      }

      // Render + move block stacks (floor)
      for (let i = blocks.length - 1; i >= 0; i--) {
        const bs = blocks[i];
        bs.x -= scrollNow * dt;
        const totalW = bs.cols * BLOCK_TILE;
        if (bs.x + totalW < -20) { blocks.splice(i, 1); continue; }
        const baseY = H - bs.rows * BLOCK_TILE;
        // Plank under the stack
        ctx.fillStyle = "#a87828";
        ctx.fillRect(bs.x - 4, H - 6, totalW + 8, 6);
        ctx.strokeStyle = "#2a1c08"; ctx.lineWidth = 1.2;
        ctx.strokeRect(bs.x - 4, H - 6, totalW + 8, 6);
        // Pyramid-like stack: each row narrower from the right
        for (let r = 0; r < bs.rows; r++) {
          const colsInRow = Math.max(1, bs.cols - r);
          for (let c = 0; c < colsInRow; c++) {
            const bx = bs.x + c * BLOCK_TILE;
            const by = H - 6 - (r + 1) * BLOCK_TILE;
            const bg = ctx.createLinearGradient(bx, by, bx, by + BLOCK_TILE);
            bg.addColorStop(0, "#fde08a"); bg.addColorStop(0.5, "#c9941f"); bg.addColorStop(1, "#6e4a14");
            ctx.fillStyle = bg;
            ctx.fillRect(bx, by, BLOCK_TILE - 1, BLOCK_TILE - 1);
            ctx.strokeStyle = "#2a1c08"; ctx.lineWidth = 1.2;
            ctx.strokeRect(bx + 0.5, by + 0.5, BLOCK_TILE - 2, BLOCK_TILE - 2);
            // X mark
            ctx.beginPath();
            ctx.moveTo(bx + 4, by + 4); ctx.lineTo(bx + BLOCK_TILE - 5, by + BLOCK_TILE - 5);
            ctx.moveTo(bx + BLOCK_TILE - 5, by + 4); ctx.lineTo(bx + 4, by + BLOCK_TILE - 5);
            ctx.stroke();
          }
        }
        // Collision: AABB against the bounding stack
        if (aabb(bs.x, baseY, totalW, bs.rows * BLOCK_TILE, BIRD_SIZE / 2)) stop(false);
      }


      /* ── Bull chase: pursues from behind, tracking bird's altitude ── */
      if (bull.alive) {
        const ramp = Math.min(1, bullWall / 3);
        const sp = bull.baseSpeed * (0.85 + 0.7 * ramp);
        const targetX = bird.x - 70;
        bull.x += Math.sign(targetX - bull.x) * sp * dt;
        bull.y += (bird.y - bull.y) * Math.min(1, dt * 3.2);
        drawBull();
        if (Math.abs(bird.x - bull.x) < 40 && Math.abs(bird.y - bull.y) < 38) stop(false);
      }

      /* ── Flying laser bear — throws beams straight down (does NOT chase) ── */
      if (flyingBear.alive) {
        flyingBear.t += dt;
        // Bear glides slowly across the top of the screen
        flyingBear.x = W * 0.5 + Math.cos(flyingBear.t * 0.6) * (W * 0.35);
        flyingBear.y = 70 + Math.sin(flyingBear.t * 1.0) * 22;
        drawFlyingBear();
        // Max 4 laser beams in 6 seconds (one every 1.5s).
        const bearInterval = 1.5;
        if (runTime - lastBearShot >= bearInterval) {
          lastBearShot = runTime;
          // Beam drops straight down with tiny horizontal drift (not tracking bird).
          const sp = 180;
          const drift = (Math.sin(flyingBear.t * 2.1) * 0.2) * sp;
          projectiles.push({
            x: flyingBear.x, y: flyingBear.y + 30,
            vx: drift, vy: sp,
            kind: "laser", life: 6,
          });
        }
      }


      /* ── Projectiles — laser beams instantly kill the bird ───────── */
      for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
        if (p.life <= 0 || p.x < -30 || p.x > W + 30 || p.y < -30 || p.y > H + 30) {
          projectiles.splice(i, 1); continue;
        }
        const dx = bird.x - p.x, dy = bird.y - p.y;
        // Both lasers AND arrows instantly kill the bird if they touch.
        const hitR = p.kind === "laser" ? 6 : 8;
        if (dx * dx + dy * dy < (BIRD_SIZE / 2 + hitR) ** 2) {
          return stop(false);
        }
        drawProjectile(p);
      }

      drawBird();

      // HUD shadow
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(0, 0, W, 38);

      // Fixed 60-second run — end the game once the timer reaches the level
      // duration. We intentionally ignore `repeat_loop` on the client: the
      // server already tiles short maps across the full duration window, so
      // looping here would prevent the player from ever completing the level
      // (and from receiving the fixed level prize).
      if (runTime >= level.duration_seconds) {
        return stop(true);
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative h-full w-full">
      <canvas ref={canvasRef} className="h-full w-full touch-none" />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between px-4 py-2 text-gold-soft">
        <div className="font-display text-sm">
          <span className="text-gold-soft">{coins}</span>{" "}
          <span className="text-[10px] uppercase tracking-widest text-gold">GTC</span>
        </div>
        <div className="font-display text-sm">
          ⏱ <span className="text-gold-soft">{timeLeft}s</span>
        </div>
      </div>
    </div>
  );
}
