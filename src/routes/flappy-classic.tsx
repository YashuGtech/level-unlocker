import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/flappy-classic")({
  component: FlappyClassicRoute,
});

function FlappyClassicRoute() {
  return <FlappyClassicGame />;
}

/**
 * Flappy GTECH Classic — standalone canvas level.
 * Self-contained game engine embedded directly as a React route.
 */
function FlappyClassicGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<"idle" | "playing" | "dead" | "won">("idle");
  const [score, setScore] = useState(0);
  const gameRef = useRef<{
    raf: number;
    bird: { x: number; y: number; vy: number };
    pipes: Array<{ x: number; topH: number }>;
    coins: Array<{ x: number; y: number; collected: boolean }>;
    startTime: number;
    coinCount: number;
    running: boolean;
  } | null>(null);

  const DURATION = 30; // seconds to survive

  function startGame() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const W = canvas.width;
    const H = canvas.height;

    const state = {
      raf: 0,
      bird: { x: W * 0.25, y: H / 2, vy: 0 },
      pipes: [] as Array<{ x: number; topH: number }>,
      coins: [] as Array<{ x: number; y: number; collected: boolean }>,
      startTime: performance.now(),
      coinCount: 0,
      running: true,
    };
    gameRef.current = state;

    const GRAVITY = 1400;
    const JUMP = -420;
    const SPEED = 220;
    const PIPE_W = 52;
    const GAP = 160;
    const BIRD_R = 14;
    let lastT = performance.now();
    let pipeTimer = 0;
    let coinTimer = 0;

    const flap = () => {
      if (state.running) state.bird.vy = JUMP;
    };

    const onTap = () => flap();
    const onKey = (e: KeyboardEvent) => { if (e.code === "Space") flap(); };
    window.addEventListener("pointerdown", onTap);
    window.addEventListener("keydown", onKey);

    function drawBird(x: number, y: number) {
      // Gold coin-bird
      const g = ctx.createRadialGradient(x, y - 3, 2, x, y, BIRD_R + 2);
      g.addColorStop(0, "#FFE55C");
      g.addColorStop(0.6, "#FFD700");
      g.addColorStop(1, "#B8860B");
      ctx.beginPath();
      ctx.arc(x, y, BIRD_R, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#FFF8DC";
      ctx.stroke();
      // GTC label
      ctx.font = "bold 7px Arial";
      ctx.fillStyle = "#000";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("GTC", x, y);
    }

    function drawPipe(x: number, topH: number) {
      const capH = 14;
      const capOvh = 6;
      // Top pipe
      const tg = ctx.createLinearGradient(x, 0, x + PIPE_W, 0);
      tg.addColorStop(0, "#B8860B");
      tg.addColorStop(0.5, "#FFD700");
      tg.addColorStop(1, "#B8860B");
      ctx.fillStyle = tg;
      ctx.fillRect(x, 0, PIPE_W, topH);
      ctx.fillRect(x - capOvh, topH - capH, PIPE_W + capOvh * 2, capH);
      // Bottom pipe
      const botY = topH + GAP;
      ctx.fillStyle = tg;
      ctx.fillRect(x, botY, PIPE_W, H - botY);
      ctx.fillRect(x - capOvh, botY, PIPE_W + capOvh * 2, capH);
    }

    function drawCoin(x: number, y: number, collected: boolean) {
      if (collected) return;
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      const cg = ctx.createRadialGradient(x - 3, y - 3, 1, x, y, 10);
      cg.addColorStop(0, "#FFFACD");
      cg.addColorStop(0.5, "#FFD700");
      cg.addColorStop(1, "#DAA520");
      ctx.fillStyle = cg;
      ctx.fill();
      ctx.strokeStyle = "#FFF8DC";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    function drawBg() {
      // Night city gradient
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#050012");
      bg.addColorStop(0.6, "#0a001a");
      bg.addColorStop(1, "#000");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      // Stars
      ctx.fillStyle = "rgba(255,215,0,0.4)";
      for (let i = 0; i < 30; i++) {
        const sx = ((i * 173 + 47) % W);
        const sy = ((i * 97 + 13) % (H * 0.6));
        ctx.fillRect(sx, sy, 1.5, 1.5);
      }
    }

    function drawHUD(timeLeft: number) {
      ctx.font = "bold 14px Arial";
      ctx.fillStyle = "#FFD700";
      ctx.textAlign = "left";
      ctx.fillText(`⏱ ${Math.ceil(timeLeft)}s`, 12, 24);
      ctx.textAlign = "right";
      ctx.fillText(`🪙 ${state.coinCount}`, W - 12, 24);
    }

    function loop(now: number) {
      if (!state.running) return;
      const dt = Math.min((now - lastT) / 1000, 0.05);
      lastT = now;
      const elapsed = (now - state.startTime) / 1000;
      const timeLeft = DURATION - elapsed;

      // Physics
      state.bird.vy += GRAVITY * dt;
      state.bird.y += state.bird.vy * dt;

      // Spawn pipes
      pipeTimer += dt;
      if (pipeTimer > 1.8) {
        pipeTimer = 0;
        const topH = 60 + Math.random() * (H - GAP - 120);
        state.pipes.push({ x: W, topH });
      }

      // Spawn coins
      coinTimer += dt;
      if (coinTimer > 1.1) {
        coinTimer = 0;
        const lastPipe = state.pipes[state.pipes.length - 1];
        if (lastPipe) {
          state.coins.push({
            x: lastPipe.x + PIPE_W + 60,
            y: lastPipe.topH + GAP / 2,
            collected: false,
          });
        }
      }

      // Move pipes & coins
      state.pipes.forEach((p) => { p.x -= SPEED * dt; });
      state.coins.forEach((c) => { c.x -= SPEED * dt; });
      state.pipes = state.pipes.filter((p) => p.x + PIPE_W > -20);
      state.coins = state.coins.filter((c) => c.x > -20);

      // Collision — pipes
      const bx = state.bird.x;
      const by = state.bird.y;
      let dead = by - BIRD_R < 0 || by + BIRD_R > H;
      for (const p of state.pipes) {
        if (bx + BIRD_R > p.x - 6 && bx - BIRD_R < p.x + PIPE_W + 6) {
          if (by - BIRD_R < p.topH || by + BIRD_R > p.topH + GAP) { dead = true; }
        }
      }

      // Collect coins
      for (const c of state.coins) {
        if (!c.collected && Math.hypot(bx - c.x, by - c.y) < BIRD_R + 11) {
          c.collected = true;
          state.coinCount++;
          setScore(state.coinCount);
        }
      }

      // Draw
      drawBg();
      state.pipes.forEach((p) => drawPipe(p.x, p.topH));
      state.coins.forEach((c) => drawCoin(c.x, c.y, c.collected));
      drawBird(bx, by);
      drawHUD(timeLeft);

      if (dead) {
        state.running = false;
        window.removeEventListener("pointerdown", onTap);
        window.removeEventListener("keydown", onKey);
        setPhase("dead");
        return;
      }
      if (timeLeft <= 0) {
        state.running = false;
        window.removeEventListener("pointerdown", onTap);
        window.removeEventListener("keydown", onKey);
        setPhase("won");
        return;
      }
      state.raf = requestAnimationFrame(loop);
    }

    setPhase("playing");
    setScore(0);
    state.raf = requestAnimationFrame(loop);

    return () => {
      state.running = false;
      cancelAnimationFrame(state.raf);
      window.removeEventListener("pointerdown", onTap);
      window.removeEventListener("keydown", onKey);
    };
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Size canvas to fill screen
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    // Draw idle splash on canvas
    const ctx = canvas.getContext("2d")!;
    const W = canvas.width;
    const H = canvas.height;
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#050012");
    bg.addColorStop(1, "#000");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    return () => window.removeEventListener("resize", resize);
  }, []);

  const reset = () => {
    setPhase("idle");
    setScore(0);
    if (gameRef.current) {
      gameRef.current.running = false;
      cancelAnimationFrame(gameRef.current.raf);
      gameRef.current = null;
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 50 }}>
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%", touchAction: "none" }}
      />

      {/* Back button */}
      <Link
        to="/game"
        style={{
          position: "absolute", top: 12, left: 12, zIndex: 20,
          background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,215,0,0.4)",
          borderRadius: 8, padding: "6px 10px", color: "#FFD700",
          display: "flex", alignItems: "center", gap: 4, fontSize: 13,
          textDecoration: "none",
        }}
      >
        <ArrowLeft size={16} /> Back
      </Link>

      {/* Idle splash */}
      {phase === "idle" && (
        <div style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", zIndex: 10,
          background: "linear-gradient(rgba(0,0,0,0.55),rgba(10,5,0,0.7))",
        }}>
          <div style={{ fontSize: 13, color: "#FFD700", letterSpacing: 4, marginBottom: 8, textTransform: "uppercase" }}>
            G TECH NETWORK
          </div>
          <h1 style={{
            fontSize: 38, fontWeight: 900, color: "#FFD700", margin: "0 0 4px",
            letterSpacing: 2, textShadow: "0 0 30px #FFD700, 0 0 60px rgba(255,180,0,0.5)",
          }}>
            FLAPPY GTECH
          </h1>
          <div style={{ color: "#aaa", fontSize: 13, marginBottom: 32 }}>
            Survive 30 seconds · Collect Gold Coins
          </div>
          <button
            onClick={() => startGame()}
            style={{
              background: "linear-gradient(135deg,#B8860B 0%,#FFD700 50%,#B8860B 100%)",
              color: "#000", border: "2px solid #FFD700", borderRadius: "50%",
              width: 80, height: 80, fontSize: 28, fontWeight: "bold", cursor: "pointer",
              boxShadow: "0 0 25px #FFD700, 0 0 50px rgba(255,180,0,0.3)",
              display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20,
            }}
          >
            ▶
          </button>
          <div style={{ color: "#FFD700", fontSize: 13, opacity: 0.8 }}>TAP TO START</div>
          <div style={{ color: "#888", fontSize: 11, marginTop: 8 }}>Tap / Space to flap</div>
        </div>
      )}

      {/* Won overlay */}
      {phase === "won" && (
        <div style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", zIndex: 10,
          background: "rgba(0,0,0,0.75)",
        }}>
          <div style={{ fontSize: 56 }}>👑</div>
          <h2 style={{ color: "#FFD700", fontSize: 36, fontWeight: 900, margin: "8px 0 4px", textShadow: "0 0 20px #FFD700" }}>
            YOU WIN!
          </h2>
          <p style={{ color: "#aaa", marginBottom: 8 }}>Survived 30 seconds!</p>
          <p style={{ color: "#FFD700", fontSize: 22, fontWeight: "bold", marginBottom: 24 }}>
            🪙 {score} coins collected
          </p>
          <button onClick={() => { reset(); setTimeout(startGame, 50); }} style={{
            background: "linear-gradient(135deg,#B8860B,#FFD700)", color: "#000",
            border: "none", borderRadius: 12, padding: "12px 32px", fontSize: 16,
            fontWeight: "bold", cursor: "pointer", marginBottom: 12,
          }}>
            Play Again
          </button>
          <Link to="/game" style={{ color: "#FFD700", fontSize: 13, textDecoration: "underline" }}>
            Back to Game Hub
          </Link>
        </div>
      )}

      {/* Dead overlay */}
      {phase === "dead" && (
        <div style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", zIndex: 10,
          background: "rgba(0,0,0,0.75)",
        }}>
          <div style={{ fontSize: 56 }}>💥</div>
          <h2 style={{ color: "#FF4444", fontSize: 36, fontWeight: 900, margin: "8px 0 4px" }}>
            GAME OVER
          </h2>
          <p style={{ color: "#aaa", marginBottom: 8 }}>Better luck next time!</p>
          <p style={{ color: "#FFD700", fontSize: 20, fontWeight: "bold", marginBottom: 24 }}>
            🪙 {score} coins collected
          </p>
          <button onClick={() => { reset(); setTimeout(startGame, 50); }} style={{
            background: "linear-gradient(135deg,#B8860B,#FFD700)", color: "#000",
            border: "none", borderRadius: 12, padding: "12px 32px", fontSize: 16,
            fontWeight: "bold", cursor: "pointer", marginBottom: 12,
          }}>
            Try Again
          </button>
          <Link to="/game" style={{ color: "#FFD700", fontSize: 13, textDecoration: "underline" }}>
            Back to Game Hub
          </Link>
        </div>
      )}
    </div>
  );
}
