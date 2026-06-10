/**
 * Trial Access route — for external-browser users (no Telegram session).
 *
 * Flow:
 *   1. Password gate (7207) → unlocks the trial. The unlock persists in
 *      localStorage so the user doesn't re-enter it every visit.
 *   2. Level picker (1–100) — descriptions from the official PDF breakdown.
 *   3. Trial play renders <Flappy> with `devMode={true}` so the player is
 *      INVINCIBLE — no obstacle, enemy, hammer or blade can end the run.
 *      The level still ends naturally when the 60s timer expires.
 *
 * This route never calls any server function and works fully offline of
 * the Telegram bot.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import { Lock, Play, ArrowLeft, ShieldCheck, Trophy, MessageCircle, Loader2 } from "lucide-react";
import { Flappy } from "@/components/flappy";
import type { Level } from "@/components/flappy";
import type { LevelObject } from "@/lib/game.functions";
import { buildTrialLevel } from "@/lib/trial-level";
import { describeLevel } from "@/lib/level-obstacles";
import { useSession } from "@/lib/session";
import { GoldFrame } from "@/components/gold-ui";
import { getPublicLevelByIndex } from "@/lib/levels.functions";


const TRIAL_PASSWORD = "7207";
const STORAGE_KEY = "gtech_trial_unlocked";

export const Route = createFileRoute("/trial")({
  head: () => ({
    meta: [
      { title: "Flapy GTech · Trial Access" },
      { name: "description", content: "Preview every Flapy GTech level in trial mode." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TrialPage,
});

function TrialPage() {
  const { loading, user, initData } = useSession();
  const [unlocked, setUnlocked] = useState(false);
  const [playing, setPlaying] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(STORAGE_KEY) === "1") setUnlocked(true);
  }, []);

  // If verified via Telegram, skip the password gate entirely.
  const telegramVerified = Boolean(initData && user);

  if (loading && !telegramVerified) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black p-6 text-gold-soft text-sm">
        Verifying Telegram session…
      </div>
    );
  }

  // Browser (no Telegram) users must pass the password gate.
  if (!telegramVerified && !unlocked) {
    return (
      <PasswordGate
        onUnlock={() => {
          window.localStorage.setItem(STORAGE_KEY, "1");
          setUnlocked(true);
        }}
      />
    );
  }

  if (playing != null) {
    return <TrialPlay levelIndex={playing} onExit={() => setPlaying(null)} />;
  }

  return <LevelPicker onPick={(n) => setPlaying(n)} />;
}

function TelegramRequired() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-black p-6">
      <GoldFrame className="w-full max-w-sm space-y-3 p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border-2 border-gold-soft bg-black/60">
          <MessageCircle className="h-5 w-5 text-gold-soft" />
        </div>
        <h1 className="font-display text-xl text-gradient-gold">Telegram required</h1>
        <p className="text-sm text-muted-foreground">
          Trial Access is reserved for verified Telegram users. Open Flapy GTech
          from <span className="text-gold">@GTCgames_bot</span> inside Telegram,
          then return here.
        </p>
        <Link
          to="/"
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-gold-soft/50 bg-black/40 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-gold-soft"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Link>
      </GoldFrame>
    </div>
  );
}

function PasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim() === TRIAL_PASSWORD) {
      setError(null);
      onUnlock();
    } else {
      setError("Wrong password. Trial access denied.");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-black p-6">
      <motion.form
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-gold-soft/40 bg-black/70 p-6 shadow-gold"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border-2 border-gold-soft bg-black/60">
          <Lock className="h-5 w-5 text-gold-soft" />
        </div>
        <h1 className="text-center font-display text-2xl text-gradient-gold">
          Trial Access
        </h1>
        <p className="text-center text-sm text-muted-foreground">
          You opened Flapy GTech from an external browser. Enter the trial
          password to preview every level without losing.
        </p>
        <input
          autoFocus
          inputMode="numeric"
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Trial password"
          className="w-full rounded-lg border border-gold-soft/40 bg-black/40 px-4 py-3 text-center font-display text-lg tracking-[0.4em] text-gold-soft outline-none focus:border-gold"
        />
        {error && (
          <p className="text-center text-xs text-destructive">{error}</p>
        )}
        <button
          type="submit"
          className="w-full rounded-lg bg-gradient-gold-flat px-4 py-3 font-display text-sm font-bold uppercase tracking-widest text-primary-foreground shadow-gold"
        >
          Unlock Trial
        </button>
      </motion.form>
    </div>
  );
}

function LevelPicker({ onPick }: { onPick: (n: number) => void }) {
  const levels = useMemo(() => Array.from({ length: 100 }, (_, i) => i + 1), []);
  return (
    <div className="min-h-screen bg-black px-4 pb-12 pt-8 text-gold-soft">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl text-gradient-gold">Trial Lobby</h1>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gold-soft/40 bg-black/60 px-3 py-1 text-[11px] uppercase tracking-widest text-gold">
            <ShieldCheck className="h-3.5 w-3.5" /> Invincible
          </span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Trial players cannot lose — obstacles, enemies, hammers and blades pass
          through. Each level still runs its full 60-second timer.
        </p>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {levels.map((n) => (
            <button
              key={n}
              onClick={() => onPick(n)}
              className="group flex flex-col items-start gap-2 rounded-xl border border-gold-soft/30 bg-black/60 p-3 text-left transition-colors hover:border-gold"
            >
              <div className="flex w-full items-center justify-between">
                <span className="font-display text-lg text-gold-soft">Lv {n}</span>
                <Trophy className="h-3.5 w-3.5 text-gold/60 group-hover:text-gold" />
              </div>
              <p className="line-clamp-2 text-[11px] leading-tight text-muted-foreground">
                {describeLevel(n)}
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function TrialPlay({ levelIndex, onExit }: { levelIndex: number; onExit: () => void }) {
  const fallback = useMemo(() => buildTrialLevel(levelIndex), [levelIndex]);
  const [runKey, setRunKey] = useState(0);
  const fetchPublic = useServerFn(getPublicLevelByIndex);

  // Always try to load the dev-built level from Supabase first so trial
  // players see the SAME obstacle placements as real players. Falls back
  // to the auto-generated trial map only when no dev level exists yet.
  const { data, isLoading } = useQuery({
    queryKey: ["trial-level", levelIndex, runKey],
    queryFn: () => fetchPublic({ data: { level_index: levelIndex } }),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  const { level, objects, source } = useMemo(() => {
    if (data?.level && data.objects.length > 0) {
      const dev = data.level;
      const duration = dev.duration_seconds || 60;
      const base: LevelObject[] = data.objects.map((o, i) => ({
        id: `dev_${dev.id}_${i}`,
        obj_type: o.obj_type as LevelObject["obj_type"],
        x_time: o.x_time,
        y: o.y,
        props: o.props,
      }));
      // Mirror the real-player loop tiling from game.functions.ts so a
      // short dev map fills the 60s window for trial too.
      const last = base.reduce((m, o) => Math.max(m, o.x_time), 0);
      let objs = base;
      if (dev.repeat_loop && last > 0 && last < duration) {
        const period = last + 1.5;
        const looped: LevelObject[] = [];
        let offset = 0;
        let safety = 0;
        while (offset < duration && safety++ < 200) {
          base.forEach((o, i) => {
            const t = o.x_time + offset;
            if (t <= duration) looped.push({ ...o, id: `dev_${dev.id}_l${safety}_${i}`, x_time: t });
          });
          offset += period;
        }
        objs = looped;
      }
      const lvl: Level = {
        id: dev.id,
        name: dev.name,
        duration_seconds: duration,
        gravity: dev.gravity,
        jump_strength: dev.jump_strength,
        scroll_speed: dev.scroll_speed,
        pipe_gap: dev.pipe_gap,
        bg_color: dev.bg_color,
        bg_kind: "night_city",
        repeat_loop: dev.repeat_loop,
        reward_per_coin: dev.reward_per_coin,
      };
      return { level: lvl, objects: objs, source: "dev" as const };
    }
    return { level: fallback.level, objects: fallback.objects, source: "fallback" as const };
  }, [data, fallback]);

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black text-gold-soft">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading dev level…
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <Flappy
        key={`${levelIndex}-${runKey}-${source}`}
        level={level}
        objects={objects}
        levelIndex={levelIndex}
        devMode
        onEnd={() => {
          setTimeout(onExit, 200);
        }}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center pt-12">
        <span className="rounded-full border border-gold-soft/50 bg-black/70 px-3 py-1 text-[10px] uppercase tracking-widest text-gold-soft">
          Trial · Lv {levelIndex} · {source === "dev" ? "Dev Map" : "Preview"} · Invincible
        </span>
      </div>
      <button
        onClick={onExit}
        className="absolute bottom-4 left-4 z-10 inline-flex items-center gap-1.5 rounded-md border border-gold-soft/50 bg-black/70 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-gold-soft shadow-lg"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Lobby
      </button>
      <button
        onClick={() => setRunKey((k) => k + 1)}
        className="absolute bottom-4 right-4 z-10 inline-flex items-center gap-1.5 rounded-md border border-gold-soft/50 bg-black/70 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-gold-soft shadow-lg"
      >
        <Play className="h-3.5 w-3.5" /> Restart
      </button>
    </div>
  );
}

