/**
 * /dev — Browser-only Dev/Admin mode (password 7207).
 *
 * - Password gate persisted in localStorage.
 * - Level picker (1..100).
 * - Visual level editor with draggable obstacle tiles and visible map placement.
 * - Saves to backend via password-gated server functions for real players.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { ArrowLeft, Lock, Save, Play, Trash2, ShieldCheck, Grid3x3, Pencil, Plus, Minus } from "lucide-react";
import { GoldFrame, GoldButton } from "@/components/gold-ui";
import { Flappy, type Level as RuntimeLevel } from "@/components/flappy";
import { devGetLevelByIndex, devListLevels, devUpsertLevelByIndex, devVerifyPassword, OBJ_TYPES } from "@/lib/levels.functions";
import { describeLevel } from "@/lib/level-obstacles";
import bearUrl from "@/assets/bear.png";
import coinUrl from "@/assets/gtc-coin.png";
import spikeUrl from "@/assets/spike-brick.png";
import hammerAsset from "@/assets/dev-hammer.png.asset.json";
import hangingBladeAsset from "@/assets/dev-hanging-blade.png.asset.json";
import spikeWallAsset from "@/assets/dev-spike-wall.png.asset.json";
import blockStackAsset from "@/assets/dev-block-stack.png.asset.json";
import shooterAsset from "@/assets/dev-shooter.png.asset.json";

const DEV_PASSWORD = "7207";
const STORAGE_PWD = "gtech_dev_pwd";
const DRAG_TYPE = "application/x-flappy-obstacle";

export const Route = createFileRoute("/dev")({
  head: () => ({
    meta: [
      { title: "Flapy GTech · Dev Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DevPage,
});

type ObjType = (typeof OBJ_TYPES)[number];
type Obj = {
  id: string;
  obj_type: ObjType;
  x_time: number;
  y: number;
  props: Record<string, number | string | boolean>;
};

type CanvasPoint = { x: number; y: number; x_time: number; yNorm: number };

type ObjMeta = {
  label: string;
  hint: string;
  accent: string;
  width: number;
  height: number;
};

const OBJ_META: Record<ObjType, ObjMeta> = {
  pipe: { label: "Gold Pipe", hint: "Top and bottom gold pipes", accent: "#d4a24c", width: 54, height: 94 },
  poll: { label: "Top Pipe", hint: "Slim top and bottom poles", accent: "#c78c1c", width: 36, height: 94 },
  wall: { label: "Brick Wall", hint: "Wide moving wall", accent: "#8f5c2f", width: 76, height: 48 },
  block: { label: "Blocks", hint: "Golden stacked blocks", accent: "#c98614", width: 82, height: 58 },
  spike: { label: "Spikes", hint: "Single spike trap", accent: "#b4b4b4", width: 72, height: 40 },
  spike_wall: { label: "Spike Wall", hint: "Full brick spike strip", accent: "#8f7a60", width: 96, height: 52 },
  hammer: { label: "Hammer", hint: "Swinging hammer", accent: "#9c7336", width: 66, height: 66 },
  blade: { label: "Hanging Blade", hint: "Spiked hanging blade", accent: "#b7b7b7", width: 68, height: 84 },
  laser: { label: "Laser", hint: "Beam obstacle", accent: "#e95ef8", width: 98, height: 26 },
  gate: { label: "Gate", hint: "Narrow gate gap", accent: "#7a88f5", width: 56, height: 86 },
  shooter: { label: "Shooter", hint: "Bear laser shooter", accent: "#f080d7", width: 84, height: 56 },
  coin: { label: "Bear Coin", hint: "Reward coin", accent: "#f2d27a", width: 40, height: 40 },
  bear: { label: "Bear", hint: "Bear enemy", accent: "#7b451d", width: 54, height: 54 },
};

function makeObject(tool: ObjType, point: CanvasPoint): Obj {
  return {
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `o_${Date.now()}_${Math.random()}`,
    obj_type: tool,
    x_time: point.x_time,
    y: Math.round(point.yNorm * 100) / 100,
    props:
      tool === "pipe"
        ? { gap: 170 }
        : tool === "laser"
          ? { on: 1, off: 1 }
          : tool === "blade" || tool === "hammer"
            ? { speed: 4 }
            : tool === "shooter"
              ? { rate: 1.2 }
              : {},
  };
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function brickBackground() {
  return {
    backgroundColor: "#5c3920",
    backgroundImage:
      "linear-gradient(0deg, rgba(255,214,121,0.08), rgba(255,214,121,0.08)), linear-gradient(90deg, rgba(0,0,0,0) 0 48%, rgba(32,16,6,0.55) 48% 52%, rgba(0,0,0,0) 52% 100%), linear-gradient(0deg, rgba(32,16,6,0.5) 0 6%, rgba(0,0,0,0) 6% 47%, rgba(32,16,6,0.5) 47% 53%, rgba(0,0,0,0) 53% 94%, rgba(32,16,6,0.5) 94% 100%)",
    backgroundSize: "26px 18px",
  } as const;
}

function goldColumnStyle() {
  return {
    background: "linear-gradient(90deg, #6e4a14 0%, #a87828 18%, #fde08a 50%, #a87828 82%, #6e4a14 100%)",
    boxShadow: "inset 0 0 0 1px rgba(38,23,3,0.55), 0 6px 16px rgba(0,0,0,0.28)",
  } as const;
}

function ObstaclePreview({ type, small = false }: { type: ObjType; small?: boolean }) {
  const meta = OBJ_META[type];
  const width = small ? Math.round(meta.width * 0.76) : meta.width;
  const height = small ? Math.round(meta.height * 0.76) : meta.height;

  if (type === "coin") {
    return <img src={coinUrl} alt="Bear coin" draggable={false} className="pointer-events-none object-contain" style={{ width, height }} />;
  }
  if (type === "bear") {
    return <img src={bearUrl} alt="Bear" draggable={false} className="pointer-events-none object-contain drop-shadow-[0_8px_18px_rgba(0,0,0,0.45)]" style={{ width, height }} />;
  }
  if (type === "hammer") {
    return <img src={hammerAsset.url} alt="Hammer" draggable={false} className="pointer-events-none object-contain drop-shadow-[0_8px_18px_rgba(0,0,0,0.45)]" style={{ width, height }} />;
  }
  if (type === "blade") {
    return <img src={hangingBladeAsset.url} alt="Hanging blade" draggable={false} className="pointer-events-none object-contain drop-shadow-[0_8px_18px_rgba(0,0,0,0.45)]" style={{ width, height }} />;
  }
  if (type === "spike_wall") {
    return <img src={spikeWallAsset.url} alt="Spike wall" draggable={false} className="pointer-events-none object-contain drop-shadow-[0_8px_18px_rgba(0,0,0,0.35)]" style={{ width, height }} />;
  }
  if (type === "block") {
    return <img src={blockStackAsset.url} alt="Block stack" draggable={false} className="pointer-events-none object-contain drop-shadow-[0_8px_18px_rgba(0,0,0,0.35)]" style={{ width, height }} />;
  }
  if (type === "shooter") {
    return <img src={shooterAsset.url} alt="Shooter" draggable={false} className="pointer-events-none object-contain drop-shadow-[0_8px_18px_rgba(0,0,0,0.35)]" style={{ width, height }} />;
  }
  if (type === "spike") {
    return <img src={spikeUrl} alt="Spike" draggable={false} className="pointer-events-none object-contain drop-shadow-[0_6px_16px_rgba(0,0,0,0.35)]" style={{ width, height }} />;
  }
  if (type === "pipe") {
    return (
      <div className="pointer-events-none relative" style={{ width, height }}>
        <div className="absolute inset-x-[10px] top-0 h-[34px] rounded-t-lg" style={goldColumnStyle()} />
        <div className="absolute inset-x-[4px] top-[28px] h-[7px] rounded-sm bg-[#c9941f] shadow-[0_1px_0_rgba(32,14,0,0.45)]" />
        
        <div className="absolute inset-x-[10px] bottom-0 h-[34px] rounded-b-lg" style={goldColumnStyle()} />
        <div className="absolute inset-x-[4px] bottom-[28px] h-[7px] rounded-sm bg-[#c9941f] shadow-[0_1px_0_rgba(32,14,0,0.45)]" />
      </div>
    );
  }
  if (type === "poll") {
    return (
      <div className="pointer-events-none relative" style={{ width, height }}>
        <div className="absolute left-1/2 top-0 h-[35px] w-[12px] -translate-x-1/2 rounded-t-md" style={goldColumnStyle()} />
        <div className="absolute left-1/2 top-[32px] h-[6px] w-[22px] -translate-x-1/2 rounded-sm bg-[#c9941f]" />
        
        <div className="absolute left-1/2 bottom-0 h-[35px] w-[12px] -translate-x-1/2 rounded-b-md" style={goldColumnStyle()} />
        <div className="absolute left-1/2 bottom-[32px] h-[6px] w-[22px] -translate-x-1/2 rounded-sm bg-[#c9941f]" />
      </div>
    );
  }
  if (type === "wall") {
    return (
      <div
        className="pointer-events-none rounded-md border border-[#3d230f] shadow-[0_8px_18px_rgba(0,0,0,0.28)]"
        style={{ width, height, ...brickBackground() }}
      />
    );
  }
  if (type === "gate") {
    return (
      <div className="pointer-events-none relative rounded-md border border-[#28306b] bg-[#10142d]/90" style={{ width, height }}>
        <div className="absolute inset-y-1 left-2 w-[8px] rounded bg-[linear-gradient(180deg,#8596ff,#4a59c7)]" />
        <div className="absolute inset-y-1 right-2 w-[8px] rounded bg-[linear-gradient(180deg,#8596ff,#4a59c7)]" />
        <div className="absolute left-1/2 top-1 bottom-1 w-[16px] -translate-x-1/2 rounded bg-black/55 ring-1 ring-white/10" />
      </div>
    );
  }
  if (type === "laser") {
    return (
      <div className="pointer-events-none relative" style={{ width, height }}>
        <div className="absolute left-0 top-1/2 h-[18px] w-[18px] -translate-y-1/2 rounded-full bg-[radial-gradient(circle,#fff7d8_0%,#ff78f3_38%,#7e34ff_72%,transparent_100%)] shadow-[0_0_18px_rgba(225,95,255,0.8)]" />
        <div className="absolute left-[12px] right-0 top-1/2 h-[8px] -translate-y-1/2 rounded-full bg-[linear-gradient(90deg,#ffd0ff_0%,#f38dff_40%,#9658ff_100%)] shadow-[0_0_18px_rgba(225,95,255,0.85)]" />
      </div>
    );
  }

  return (
    <div className="pointer-events-none flex items-center justify-center rounded-md border border-black/30 text-[10px] font-bold uppercase text-black/75 shadow-[0_8px_18px_rgba(0,0,0,0.25)]" style={{ width, height, background: meta.accent }}>
      {meta.label}
    </div>
  );
}

type Mode = "menu" | "single" | "six";

function DevPage() {
  const [pwd, setPwd] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("menu");
  const [picked, setPicked] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(STORAGE_PWD);
    if (saved) setPwd(saved);
  }, []);

  if (!pwd) {
    return <PasswordGate onUnlock={(p) => {
      window.localStorage.setItem(STORAGE_PWD, p);
      setPwd(p);
    }} />;
  }

  if (mode === "menu") {
    return <ModeMenu onPick={setMode} onLogout={() => {
      window.localStorage.removeItem(STORAGE_PWD);
      setPwd(null);
    }} />;
  }

  if (mode === "six") {
    return <SixPackEditor password={pwd} onBack={() => setMode("menu")} />;
  }

  if (picked == null) {
    return <LevelPicker onPick={setPicked} onLogout={() => setMode("menu")} />;
  }

  return <Editor levelIndex={picked} password={pwd} onBack={() => setPicked(null)} />;
}

function ModeMenu({ onPick, onLogout }: { onPick: (m: Mode) => void; onLogout: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-black p-6">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center">
          <p className="text-[10px] uppercase tracking-widest text-gold">Dev Admin</p>
          <h1 className="font-display text-2xl text-gradient-gold">Choose Edit Mode</h1>
        </div>
        <button
          onClick={() => onPick("single")}
          className="flex w-full items-center gap-3 rounded-xl border border-gold-soft/40 bg-black/60 p-4 text-left hover:border-gold"
        >
          <Pencil className="h-6 w-6 text-gold-soft" />
          <div className="flex-1">
            <p className="font-display text-base text-gold-soft">Single Level Edit</p>
            <p className="text-[11px] text-muted-foreground">Pick one level (1-100) and edit it with all settings and full preview.</p>
          </div>
        </button>
        <button
          onClick={() => onPick("six")}
          className="flex w-full items-center gap-3 rounded-xl border border-gold-soft/40 bg-black/60 p-4 text-left hover:border-gold"
        >
          <Grid3x3 className="h-6 w-6 text-gold-soft" />
          <div className="flex-1">
            <p className="font-display text-base text-gold-soft">6-Window Edit</p>
            <p className="text-[11px] text-muted-foreground">Edit up to 6 levels side by side with live previews running at once.</p>
          </div>
        </button>
        <button onClick={onLogout} className="block w-full text-center text-[10px] uppercase tracking-wider text-muted-foreground underline">
          Lock dev panel
        </button>
      </div>
    </div>
  );
}

function PasswordGate({ onUnlock }: { onUnlock: (p: string) => void }) {
  const [value, setValue] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const verifyMut = useMutation({
    mutationFn: (p: string) => devVerifyPassword({ data: { password: p } }),
    onSuccess: () => onUnlock(value.trim()),
    onError: () => setErr("Wrong password."),
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-black p-6">
      <motion.form
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        onSubmit={(e) => {
          e.preventDefault();
          setErr(null);
          const v = value.trim();
          if (!v) return;
          if (v !== DEV_PASSWORD) {
            setErr("Wrong password.");
            return;
          }
          verifyMut.mutate(v);
        }}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-gold-soft/40 bg-black/70 p-6 shadow-gold"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border-2 border-gold-soft bg-black/60">
          <Lock className="h-5 w-5 text-gold-soft" />
        </div>
        <h1 className="text-center font-display text-2xl text-gradient-gold">Dev Admin</h1>
        <p className="text-center text-sm text-muted-foreground">Enter the dev password to design and save levels for all players.</p>
        <input
          autoFocus
          inputMode="numeric"
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Dev password"
          className="w-full rounded-lg border border-gold-soft/40 bg-black/40 px-4 py-3 text-center font-display text-lg tracking-[0.4em] text-gold-soft outline-none focus:border-gold"
        />
        {err && <p className="text-center text-xs text-destructive">{err}</p>}
        <button type="submit" disabled={verifyMut.isPending} className="w-full rounded-lg bg-gradient-gold-flat px-4 py-3 font-display text-sm font-bold uppercase tracking-widest text-primary-foreground shadow-gold">
          {verifyMut.isPending ? "Verifying…" : "Unlock"}
        </button>
        <Link to="/" className="block text-center text-xs text-gold-soft/70 underline">Back to home</Link>
      </motion.form>
    </div>
  );
}

function LevelPicker({ onPick, onLogout }: { onPick: (n: number) => void; onLogout: () => void }) {
  const levels = useMemo(() => Array.from({ length: 100 }, (_, i) => i + 1), []);
  return (
    <div className="min-h-screen bg-black px-4 pb-12 pt-8 text-gold-soft">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-gold">Dev Admin</p>
            <h1 className="font-display text-2xl text-gradient-gold">Level Editor</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gold-soft/40 bg-black/60 px-3 py-1 text-[11px] uppercase tracking-widest text-gold">
              <ShieldCheck className="h-3.5 w-3.5" /> Live save
            </span>
            <button onClick={onLogout} className="rounded border border-gold-soft/30 px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">Lock</button>
          </div>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Pick a level to design its map. Saved maps are served to real players on the next play.
          Short maps automatically loop to fill the full 60s run.
        </p>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {levels.map((n) => (
            <button
              key={n}
              onClick={() => onPick(n)}
              className="group flex flex-col items-start gap-2 rounded-xl border border-gold-soft/30 bg-black/60 p-3 text-left transition-colors hover:border-gold"
            >
              <span className="font-display text-lg text-gold-soft">Lv {n}</span>
              <p className="line-clamp-2 text-[11px] leading-tight text-muted-foreground">{describeLevel(n)}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Editor({ levelIndex, password, onBack }: { levelIndex: number; password: string; onBack: () => void }) {
  const [name, setName] = useState(`Lv ${levelIndex} · Dev`);
  const [duration, setDuration] = useState(60);
  const [gravity, setGravity] = useState(0.45);
  const [jump, setJump] = useState(-7.5);
  const [speed, setSpeed] = useState(2.5);
  const [pipeGap, setPipeGap] = useState(170);
  const [enabled, setEnabled] = useState(true);
  const [weight, setWeight] = useState(10);
  const [repeat, setRepeat] = useState(true);
  const [rewardPerCoin, setRewardPerCoin] = useState(1);
  const [bgColor, setBgColor] = useState("#0a0a0a");
  const [tool, setTool] = useState<ObjType>("pipe");
  const [objects, setObjects] = useState<Obj[]>([]);
  const [preview, setPreview] = useState(false);

  const existing = useQuery({
    queryKey: ["dev-level", levelIndex],
    queryFn: () => devGetLevelByIndex({ data: { password, level_index: levelIndex } }),
  });

  useEffect(() => {
    if (!existing.data?.level) return;
    const l = existing.data.level;
    setName(l.name);
    setDuration(l.duration_seconds);
    setGravity(l.gravity);
    setJump(l.jump_strength);
    setSpeed(l.scroll_speed);
    setPipeGap(l.pipe_gap);
    setEnabled(l.enabled);
    setWeight(l.weight);
    setRepeat(l.repeat_loop);
    setRewardPerCoin(l.reward_per_coin);
    setBgColor(l.bg_color);
    setObjects(
      existing.data.objects.map((o) => ({
        id: o.id,
        obj_type: o.obj_type as ObjType,
        x_time: o.x_time,
        y: o.y,
        props: o.props as Record<string, number | string | boolean>,
      })),
    );
  }, [existing.data]);

  const saveMut = useMutation({
    mutationFn: () =>
      devUpsertLevelByIndex({
        data: {
          password,
          level_index: levelIndex,
          name,
          duration_seconds: duration,
          gravity,
          jump_strength: jump,
          scroll_speed: speed,
          pipe_gap: pipeGap,
          enabled,
          weight,
          repeat_loop: repeat,
          reward_per_coin: rewardPerCoin,
          bg_color: bgColor,
          objects: objects.map(({ obj_type, x_time, y, props }) => ({ obj_type, x_time, y, props })),
        },
      }),
    onSuccess: (r) => toast.success(`Saved Lv ${levelIndex}${r.repeat ? " (auto-loop on)" : ""}`),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  if (preview) {
    const runtime: RuntimeLevel = {
      id: "preview",
      name,
      duration_seconds: duration,
      gravity,
      jump_strength: jump,
      scroll_speed: speed,
      pipe_gap: pipeGap,
      bg_color: bgColor,
      repeat_loop: repeat,
      reward_per_coin: rewardPerCoin,
    };

    return (
      <div className="fixed inset-0 z-50 bg-black">
        <button onClick={() => setPreview(false)} className="absolute left-3 top-3 z-10 rounded-md border border-gold-soft/40 bg-black/60 px-3 py-1 text-xs text-gold-soft">
          Exit preview
        </button>
        <Flappy
          level={runtime}
          objects={objects.map((o) => ({ id: o.id, obj_type: o.obj_type, x_time: o.x_time, y: o.y, props: o.props }))}
          devMode
          onEnd={() => setPreview(false)}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black px-3 pb-12 pt-4 text-gold-soft">
      <div className="mx-auto max-w-4xl space-y-3">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="rounded-md border border-gold-soft/40 p-1.5 text-gold-soft"><ArrowLeft size={16} /></button>
          <h1 className="flex-1 truncate font-display text-xl text-gradient-gold">Lv {levelIndex} · {name}</h1>
          <button onClick={() => setPreview(true)} className="rounded border border-gold-soft/40 p-1.5 text-gold-soft"><Play size={14} /></button>
          <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="rounded bg-gradient-gold-flat p-1.5 text-primary-foreground"><Save size={14} /></button>
        </div>

        <CloneFromLevel
          password={password}
          currentIndex={levelIndex}
          onClone={(src, opts) => {
            setObjects(
              src.objects.map((o) => ({
                id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `o_${Date.now()}_${Math.random()}`,
                obj_type: o.obj_type as ObjType,
                x_time: o.x_time,
                y: o.y,
                props: o.props as Record<string, number | string | boolean>,
              })),
            );
            if (opts.copySettings && src.level) {
              const l = src.level;
              setDuration(l.duration_seconds);
              setGravity(l.gravity);
              setJump(l.jump_strength);
              setSpeed(l.scroll_speed);
              setPipeGap(l.pipe_gap);
              setRepeat(l.repeat_loop);
              setRewardPerCoin(l.reward_per_coin);
              setBgColor(l.bg_color);
            }
            toast.success(`Cloned ${src.objects.length} objects${opts.copySettings ? " + settings" : ""}`);
          }}
        />


        <GoldFrame className="p-2">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-2">
            <p className="text-[10px] uppercase tracking-widest text-gold">
              Map editor · drag or tap place <span className="text-gold-soft">{OBJ_META[tool].label}</span> · {objects.length} objects
            </p>
            <p className="text-[10px] uppercase tracking-widest text-gold-soft/70">
              Click a placed item to remove it
            </p>
          </div>
          <TimelineCanvas
            duration={duration}
            objects={objects}
            tool={tool}
            onAdd={(o) => setObjects((prev) => [...prev, o])}
            onRemove={(id) => setObjects((prev) => prev.filter((x) => x.id !== id))}
          />
        </GoldFrame>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {OBJ_TYPES.map((t) => {
            const meta = OBJ_META[t as ObjType];
            const active = tool === t;
            return (
              <button
                key={t}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_TYPE, t);
                  e.dataTransfer.effectAllowed = "copy";
                  setTool(t as ObjType);
                }}
                onClick={() => setTool(t as ObjType)}
                className={`rounded-lg border p-2 text-left transition ${
                  active
                    ? "border-gold-soft bg-gold-soft/15 shadow-gold"
                    : "border-gold-soft/25 bg-black/45 hover:border-gold-soft/55"
                }`}
                aria-pressed={active}
              >
                <div className="flex min-h-[72px] items-center justify-center overflow-hidden rounded-md bg-black/35 p-1">
                  <ObstaclePreview type={t as ObjType} small />
                </div>
                <div className="mt-2 space-y-1">
                  <div className="text-[11px] font-semibold uppercase tracking-widest text-gold-soft">{meta.label}</div>
                  <div className="text-[10px] leading-tight text-muted-foreground">{meta.hint}</div>
                </div>
              </button>
            );
          })}
        </div>

        <RandomPatternGenerator
          duration={duration}
          onGenerate={(objs, replace) => {
            setObjects((prev) => (replace ? objs : [...prev, ...objs]));
          }}
        />


        <button
          onClick={() => {
            if (confirm("Clear all objects?")) setObjects([]);
          }}
          className="w-full rounded border border-destructive/40 py-1.5 text-xs text-destructive"
        >
          <Trash2 size={12} className="inline" /> Clear all
        </button>

        <GoldFrame className="space-y-2 p-3">
          <FieldText label="Name" value={name} onChange={setName} />
          <div className="grid grid-cols-2 gap-2">
            <FieldNum label="Duration (s)" value={duration} step={5} onChange={setDuration} />
            <FieldNum label="Weight" value={weight} step={1} onChange={setWeight} />
            <FieldNum label="Pipe gap" value={pipeGap} step={10} onChange={setPipeGap} />
            <FieldNum label="Reward/coin" value={rewardPerCoin} step={0.5} onChange={setRewardPerCoin} />
            <FieldNum label="Gravity" value={gravity} step={0.05} onChange={setGravity} />
            <FieldNum label="Jump str." value={jump} step={0.5} onChange={setJump} />
            <FieldNum label="Speed" value={speed} step={0.25} onChange={setSpeed} />
            <FieldText label="BG color" value={bgColor} onChange={setBgColor} />
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled (served to real players)
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} /> Repeat loop to fill duration
          </label>
        </GoldFrame>

        <GoldButton onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="w-full">
          <Save size={14} /> {saveMut.isPending ? "Saving…" : `Save Lv ${levelIndex} for real players`}
        </GoldButton>
      </div>
    </div>
  );
}

function FieldText({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-xs">
      <span className="uppercase tracking-widest text-gold">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded border border-gold-soft/40 bg-black/40 px-2 py-1 text-sm"
      />
    </label>
  );
}

function FieldNum({ label, value, step = 1, onChange }: { label: string; value: number; step?: number; onChange: (v: number) => void }) {
  return (
    <label className="block text-xs">
      <span className="uppercase tracking-widest text-gold">{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded border border-gold-soft/40 bg-black/40 px-2 py-1 text-sm"
      />
    </label>
  );
}

function TimelineCanvas({
  duration,
  objects,
  tool,
  onAdd,
  onRemove,
}: {
  duration: number;
  objects: Obj[];
  tool: ObjType;
  onAdd: (o: Obj) => void;
  onRemove: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 320 });
  const [dragType, setDragType] = useState<ObjType | null>(null);
  const [ghost, setGhost] = useState<CanvasPoint | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setSize({ w: r.width, h: 320 });
    const obs = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: 320 }));
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  const pxPerSec = useMemo(() => Math.max(18, size.w / Math.max(10, duration)), [size.w, duration]);
  const totalWidth = duration * pxPerSec;

  const pointFromEvent = (clientX: number, clientY: number, host: HTMLDivElement): CanvasPoint => {
    const rect = host.getBoundingClientRect();
    const x = clientX - rect.left + host.scrollLeft;
    const y = clientY - rect.top;
    const x_time = Math.max(0, Math.round((x / pxPerSec) * 10) / 10);
    const yNorm = clamp(y / size.h, 0.08, 0.92);
    return { x, y, x_time, yNorm };
  };

  const addAt = (type: ObjType, point: CanvasPoint) => onAdd(makeObject(type, point));

  return (
    <div
      ref={ref}
      onClick={(e) => addAt(tool, pointFromEvent(e.clientX, e.clientY, e.currentTarget))}
      onDragOver={(e) => {
        e.preventDefault();
        const incoming = e.dataTransfer.getData(DRAG_TYPE) as ObjType;
        if (incoming) setDragType(incoming);
        setGhost(pointFromEvent(e.clientX, e.clientY, e.currentTarget));
      }}
      onDragLeave={() => {
        setGhost(null);
        setDragType(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        const incoming = (e.dataTransfer.getData(DRAG_TYPE) as ObjType) || tool;
        addAt(incoming, pointFromEvent(e.clientX, e.clientY, e.currentTarget));
        setGhost(null);
        setDragType(null);
      }}
      className="relative overflow-x-auto rounded border border-gold-soft/30 bg-[linear-gradient(180deg,rgba(22,14,6,0.92),rgba(8,8,8,0.98))]"
      style={{ height: size.h }}
    >
      <div className="relative" style={{ width: Math.max(totalWidth, size.w), height: size.h }}>
        <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_0%,rgba(255,209,102,0.03)_100%)]" />
        {Array.from({ length: Math.floor(duration / 5) + 1 }).map((_, i) => (
          <div
            key={i}
            className="absolute bottom-0 top-0 border-l border-gold-soft/15 text-[9px] text-gold-soft/55"
            style={{ left: i * 5 * pxPerSec, paddingLeft: 3 }}
          >
            {i * 5}s
          </div>
        ))}
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={`row-${i}`} className="absolute inset-x-0 border-t border-dashed border-white/8" style={{ top: ((i + 1) * size.h) / 5 }} />
        ))}

        {ghost && (
          <div
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 opacity-60 saturate-125"
            style={{ left: ghost.x, top: ghost.y }}
          >
            <ObstaclePreview type={dragType ?? tool} />
          </div>
        )}

        {objects.map((o) => {
          const meta = OBJ_META[o.obj_type];
          const x = o.x_time * pxPerSec;
          const y = o.y * size.h;
          return (
            <button
              key={o.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Remove ${meta.label}?`)) onRemove(o.id);
              }}
              className="group absolute -translate-x-1/2 -translate-y-1/2 border-0 bg-transparent p-0 outline-none ring-0 transition focus:outline-none"
              style={{ left: x, top: y }}
              aria-label={`Remove ${meta.label} at ${o.x_time}s`}
              title={`${meta.label} · ${o.x_time}s — click to remove`}
            >
              {/* Bounding-box outline matches the obstacle's exact size, so
                  edges can be aligned flush against each other while staying
                  visible as a placement guide. Free overlap is allowed. */}
              <span
                className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border border-dashed border-gold-soft/60 group-hover:border-gold group-hover:border-solid"
                style={{ width: meta.width, height: meta.height }}
              />
              <ObstaclePreview type={o.obj_type} />
              <span className="pointer-events-none absolute -bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] uppercase tracking-widest text-gold-soft/65 opacity-0 transition-opacity group-hover:opacity-100">
                {o.x_time}s
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CloneFromLevel({
  password,
  currentIndex,
  onClone,
}: {
  password: string;
  currentIndex: number;
  onClone: (
    src: Awaited<ReturnType<typeof devGetLevelByIndex>>,
    opts: { copySettings: boolean },
  ) => void;
}) {
  const [sourceIdx, setSourceIdx] = useState<number | "">("");
  const [copySettings, setCopySettings] = useState(false);
  const list = useQuery({
    queryKey: ["dev-level-list"],
    queryFn: () => devListLevels({ data: { password } }),
  });

  const loadMut = useMutation({
    mutationFn: (idx: number) => devGetLevelByIndex({ data: { password, level_index: idx } }),
    onSuccess: (src) => {
      if (!src.level || src.objects.length === 0) {
        toast.error("Source level has no obstacles to clone.");
        return;
      }
      onClone(src, { copySettings });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Clone failed"),
  });

  const rows = (list.data ?? []).filter((r) => r.level_index !== currentIndex);

  return (
    <GoldFrame className="space-y-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-widest text-gold">Clone from existing level</p>
        <span className="text-[10px] text-gold-soft/60">{rows.length} available</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={sourceIdx}
          onChange={(e) => setSourceIdx(e.target.value ? Number(e.target.value) : "")}
          className="flex-1 min-w-[160px] rounded border border-gold-soft/40 bg-black/40 px-2 py-1.5 text-sm text-gold-soft"
        >
          <option value="">Select source level…</option>
          {rows.map((r) => (
            <option key={r.id} value={r.level_index}>
              Lv {r.level_index} · {r.name} ({r.object_count} obj{r.object_count === 1 ? "" : "s"})
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!sourceIdx || loadMut.isPending}
          onClick={() => {
            if (typeof sourceIdx !== "number") return;
            if (!confirm(`Replace current objects with clone of Lv ${sourceIdx}?`)) return;
            loadMut.mutate(sourceIdx);
          }}
          className="rounded bg-gradient-gold-flat px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-primary-foreground disabled:opacity-50"
        >
          {loadMut.isPending ? "Cloning…" : "Clone"}
        </button>
      </div>
      <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <input type="checkbox" checked={copySettings} onChange={(e) => setCopySettings(e.target.checked)} />
        Also copy gravity / speed / gap / background settings
      </label>
    </GoldFrame>
  );
}

const RANDOM_DEFAULT_TYPES: ObjType[] = ["pipe", "spike", "coin"];

function RandomPatternGenerator({
  duration,
  onGenerate,
}: {
  duration: number;
  onGenerate: (objs: Obj[], replace: boolean) => void;
}) {
  const [selected, setSelected] = useState<Set<ObjType>>(() => new Set(RANDOM_DEFAULT_TYPES));
  const [count, setCount] = useState(16);
  const [replace, setReplace] = useState(false);

  const toggle = (t: ObjType) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  const generate = () => {
    const types = Array.from(selected);
    if (types.length === 0) {
      toast.error("Pick at least one obstacle for the random pattern.");
      return;
    }
    const n = clamp(Math.round(count), 1, 200);
    const start = 1.5;
    const end = Math.max(start + 1, duration - 1.5);
    const span = end - start;
    const objs: Obj[] = [];
    for (let i = 0; i < n; i++) {
      const type = types[Math.floor(Math.random() * types.length)];
      // Spread obstacles across the timeline with a little random jitter so
      // each generated map looks organic rather than perfectly gridded.
      const baseT = start + (span * (i + Math.random() * 0.6)) / n;
      const x_time = Math.round(clamp(baseT, start, end) * 10) / 10;
      const yNorm = clamp(0.12 + Math.random() * 0.76, 0.08, 0.92);
      objs.push(makeObject(type, { x: 0, y: 0, x_time, yNorm }));
    }
    objs.sort((a, b) => a.x_time - b.x_time);
    onGenerate(objs, replace);
    toast.success(`Generated ${objs.length} obstacles in a random pattern`);
  };

  return (
    <GoldFrame className="space-y-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-widest text-gold">Random pattern generator</p>
        <span className="text-[10px] text-gold-soft/60">{selected.size} selected</span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Pick which obstacles you want, then generate a random map design for this level.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {OBJ_TYPES.map((t) => {
          const active = selected.has(t as ObjType);
          return (
            <button
              key={t}
              type="button"
              onClick={() => toggle(t as ObjType)}
              className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-wide transition ${
                active
                  ? "border-gold-soft bg-gold-soft/20 text-gold-soft"
                  : "border-gold-soft/25 text-muted-foreground hover:border-gold-soft/50"
              }`}
              aria-pressed={active}
            >
              {OBJ_META[t as ObjType].label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <label className="flex items-center gap-2 text-xs">
          <span className="uppercase tracking-widest text-gold">Count</span>
          <input
            type="number"
            min={1}
            max={200}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="w-20 rounded border border-gold-soft/40 bg-black/40 px-2 py-1 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace existing
        </label>
        <button
          type="button"
          onClick={generate}
          className="ml-auto rounded bg-gradient-gold-flat px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-primary-foreground"
        >
          Generate random pattern
        </button>
      </div>
    </GoldFrame>
  );
}

// ─── 6-Window editor ───────────────────────────────────────────────────
// Edit up to 6 levels at once. Each cell is independent: load, edit,
// save. A shared tool palette and a single "Play all" toggle make it
// easy to compare designs side-by-side. Live previews run in devMode
// (bird is invincible) so the developer can watch the timeline scroll.

type SixCellState = {
  levelIndex: number;
  objects: Obj[];
  name: string;
  duration: number;
  gravity: number;
  jump: number;
  speed: number;
  pipeGap: number;
  bgColor: string;
  repeat: boolean;
  rewardPerCoin: number;
  enabled: boolean;
  weight: number;
  loaded: boolean;
};

function defaultCell(idx: number): SixCellState {
  return {
    levelIndex: idx,
    objects: [],
    name: `Lv ${idx} · Dev`,
    duration: 60,
    gravity: 0.45,
    jump: -7.5,
    speed: 2.5,
    pipeGap: 170,
    bgColor: "#0a0a0a",
    repeat: true,
    rewardPerCoin: 1,
    enabled: true,
    weight: 10,
    loaded: false,
  };
}

function SixPackEditor({ password, onBack }: { password: string; onBack: () => void }) {
  const [cells, setCells] = useState<SixCellState[]>(() =>
    Array.from({ length: 6 }, (_, i) => defaultCell(i + 1)),
  );
  const [tool, setTool] = useState<ObjType>("pipe");
  const [previewAll, setPreviewAll] = useState(false);

  const updateCell = (i: number, patch: Partial<SixCellState>) =>
    setCells((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  return (
    <div className="min-h-screen bg-black px-3 pb-12 pt-4 text-gold-soft">
      <div className="mx-auto max-w-7xl space-y-3">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="rounded-md border border-gold-soft/40 p-1.5 text-gold-soft">
            <ArrowLeft size={16} />
          </button>
          <h1 className="flex-1 truncate font-display text-xl text-gradient-gold">6-Window Editor</h1>
          <button
            onClick={() => setPreviewAll((p) => !p)}
            className={`flex items-center gap-1 rounded border px-3 py-1.5 text-xs uppercase tracking-widest ${
              previewAll
                ? "border-gold bg-gold/20 text-gold-soft"
                : "border-gold-soft/40 text-gold-soft"
            }`}
          >
            <Play size={12} /> {previewAll ? "Stop all previews" : "Play all previews"}
          </button>
        </div>

        <GoldFrame className="p-2">
          <p className="px-1 pb-2 text-[10px] uppercase tracking-widest text-gold">
            Shared tool · click a cell's timeline to drop {OBJ_META[tool].label}
          </p>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-7">
            {OBJ_TYPES.map((t) => {
              const meta = OBJ_META[t as ObjType];
              const active = tool === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTool(t as ObjType)}
                  className={`flex flex-col items-center rounded border p-1.5 transition ${
                    active ? "border-gold-soft bg-gold-soft/15" : "border-gold-soft/25 bg-black/45 hover:border-gold-soft/55"
                  }`}
                  aria-pressed={active}
                  title={meta.label}
                >
                  <div className="flex h-12 w-full items-center justify-center overflow-hidden rounded bg-black/35">
                    <ObstaclePreview type={t as ObjType} small />
                  </div>
                  <span className="mt-1 truncate text-[9px] uppercase tracking-wider text-gold-soft">
                    {meta.label}
                  </span>
                </button>
              );
            })}
          </div>
        </GoldFrame>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {cells.map((c, i) => (
            <SixCell
              key={i}
              password={password}
              cell={c}
              tool={tool}
              preview={previewAll}
              onPatch={(patch) => updateCell(i, patch)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SixCell({
  password,
  cell,
  tool,
  preview,
  onPatch,
}: {
  password: string;
  cell: SixCellState;
  tool: ObjType;
  preview: boolean;
  onPatch: (patch: Partial<SixCellState>) => void;
}) {
  // Load this cell's level from the DB on mount or when its index changes.
  const loadQ = useQuery({
    queryKey: ["dev-level-six", cell.levelIndex],
    queryFn: () => devGetLevelByIndex({ data: { password, level_index: cell.levelIndex } }),
  });

  useEffect(() => {
    if (cell.loaded) return;
    if (!loadQ.data) return;
    if (loadQ.data.level) {
      const l = loadQ.data.level;
      onPatch({
        name: l.name,
        duration: l.duration_seconds,
        gravity: l.gravity,
        jump: l.jump_strength,
        speed: l.scroll_speed,
        pipeGap: l.pipe_gap,
        bgColor: l.bg_color,
        repeat: l.repeat_loop,
        rewardPerCoin: l.reward_per_coin,
        enabled: l.enabled,
        weight: l.weight,
        objects: loadQ.data.objects.map((o) => ({
          id: o.id,
          obj_type: o.obj_type as ObjType,
          x_time: o.x_time,
          y: o.y,
          props: o.props as Record<string, number | string | boolean>,
        })),
        loaded: true,
      });
    } else {
      onPatch({ loaded: true });
    }
  }, [loadQ.data, cell.loaded, onPatch]);

  const saveMut = useMutation({
    mutationFn: () =>
      devUpsertLevelByIndex({
        data: {
          password,
          level_index: cell.levelIndex,
          name: cell.name,
          duration_seconds: cell.duration,
          gravity: cell.gravity,
          jump_strength: cell.jump,
          scroll_speed: cell.speed,
          pipe_gap: cell.pipeGap,
          enabled: cell.enabled,
          weight: cell.weight,
          repeat_loop: cell.repeat,
          reward_per_coin: cell.rewardPerCoin,
          bg_color: cell.bgColor,
          objects: cell.objects.map(({ obj_type, x_time, y, props }) => ({ obj_type, x_time, y, props })),
        },
      }),
    onSuccess: () => toast.success(`Saved Lv ${cell.levelIndex}`),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const setIndex = (delta: number) => {
    const next = clamp(cell.levelIndex + delta, 1, 100);
    if (next === cell.levelIndex) return;
    onPatch({ levelIndex: next, loaded: false, objects: [] });
  };

  const runtime: RuntimeLevel = {
    id: `cell-${cell.levelIndex}`,
    name: cell.name,
    duration_seconds: cell.duration,
    gravity: cell.gravity,
    jump_strength: cell.jump,
    scroll_speed: cell.speed,
    pipe_gap: cell.pipeGap,
    bg_color: cell.bgColor,
    repeat_loop: cell.repeat,
    reward_per_coin: cell.rewardPerCoin,
  };

  return (
    <GoldFrame className="space-y-2 p-2">
      <div className="flex items-center gap-1">
        <button onClick={() => setIndex(-1)} className="rounded border border-gold-soft/40 p-1 text-gold-soft" aria-label="Prev"><Minus size={12} /></button>
        <input
          type="number"
          min={1}
          max={100}
          value={cell.levelIndex}
          onChange={(e) => {
            const v = clamp(Number(e.target.value) || 1, 1, 100);
            onPatch({ levelIndex: v, loaded: false, objects: [] });
          }}
          className="w-14 rounded border border-gold-soft/40 bg-black/40 px-1 py-0.5 text-center text-xs"
        />
        <button onClick={() => setIndex(+1)} className="rounded border border-gold-soft/40 p-1 text-gold-soft" aria-label="Next"><Plus size={12} /></button>
        <span className="flex-1 truncate text-[10px] text-gold-soft/70">{cell.name}</span>
        <button
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending}
          className="rounded bg-gradient-gold-flat p-1 text-primary-foreground"
          aria-label="Save"
          title="Save"
        >
          <Save size={12} />
        </button>
      </div>

      <div className="text-[10px] text-gold-soft/70">
        {cell.objects.length} obj · click timeline to place {OBJ_META[tool].label}
      </div>

      <SixMiniCanvas
        duration={cell.duration}
        objects={cell.objects}
        tool={tool}
        onAdd={(o) => onPatch({ objects: [...cell.objects, o] })}
        onRemove={(id) => onPatch({ objects: cell.objects.filter((x) => x.id !== id) })}
      />

      <div className="overflow-hidden rounded border border-gold-soft/30" style={{ height: 150 }}>
        {preview ? (
          <Flappy
            key={`prev-${cell.levelIndex}-${cell.objects.length}`}
            level={runtime}
            objects={cell.objects.map((o) => ({ id: o.id, obj_type: o.obj_type, x_time: o.x_time, y: o.y, props: o.props }))}
            devMode
            editorPreview
            onEnd={() => { /* dev preview loops via re-mount on next click */ }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] uppercase tracking-widest text-gold-soft/40">
            Press “Play all previews” to run
          </div>
        )}
      </div>
    </GoldFrame>
  );
}

// Compact timeline used inside each 6-window cell.
function SixMiniCanvas({
  duration,
  objects,
  tool,
  onAdd,
  onRemove,
}: {
  duration: number;
  objects: Obj[];
  tool: ObjType;
  onAdd: (o: Obj) => void;
  onRemove: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const height = 160;

  useEffect(() => {
    if (!ref.current) return;
    setWidth(ref.current.getBoundingClientRect().width);
    const obs = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  const pxPerSec = Math.max(10, width / Math.max(10, duration));
  const totalWidth = duration * pxPerSec;

  const pointAt = (clientX: number, clientY: number, host: HTMLDivElement) => {
    const rect = host.getBoundingClientRect();
    const x = clientX - rect.left + host.scrollLeft;
    const y = clientY - rect.top;
    const x_time = Math.max(0, Math.round((x / pxPerSec) * 10) / 10);
    const yNorm = clamp(y / height, 0.08, 0.92);
    return { x, y, x_time, yNorm };
  };

  return (
    <div
      ref={ref}
      onClick={(e) => onAdd(makeObject(tool, pointAt(e.clientX, e.clientY, e.currentTarget)))}
      className="relative overflow-x-auto rounded border border-gold-soft/30 bg-[linear-gradient(180deg,rgba(22,14,6,0.92),rgba(8,8,8,0.98))]"
      style={{ height }}
    >
      <div className="relative" style={{ width: Math.max(totalWidth, width), height }}>
        {Array.from({ length: Math.floor(duration / 10) + 1 }).map((_, i) => (
          <div
            key={i}
            className="absolute bottom-0 top-0 border-l border-gold-soft/15 text-[8px] text-gold-soft/45"
            style={{ left: i * 10 * pxPerSec, paddingLeft: 2 }}
          >
            {i * 10}s
          </div>
        ))}
        {objects.map((o) => {
          const meta = OBJ_META[o.obj_type];
          const x = o.x_time * pxPerSec;
          const y = o.y * height;
          // Compact preview: pad a tiny square indicator rather than the
          // full-size ObstaclePreview (those wouldn't fit at 160px height).
          return (
            <button
              key={o.id}
              type="button"
              onClick={(e) => { e.stopPropagation(); onRemove(o.id); }}
              className="absolute -translate-x-1/2 -translate-y-1/2 border-0 bg-transparent p-0 outline-none"
              style={{ left: x, top: y }}
              title={`${meta.label} @ ${o.x_time}s — click to remove`}
            >
              <span
                className="block border border-dashed border-gold-soft/70 bg-black/40"
                style={{
                  width: Math.max(10, Math.round(meta.width * 0.4)),
                  height: Math.max(10, Math.round(meta.height * 0.4)),
                  backgroundColor: meta.accent + "55",
                }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

