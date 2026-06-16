import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Play,
  Construction,
  CheckCircle2,
  Zap,
  PartyPopper,
  Heart,
  Gift,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { GoldFrame } from "@/components/gold-ui";
import { Flappy, type Level } from "@/components/flappy";
import { useSession } from "@/lib/session";
import {
  startGame,
  finishGame,
  reviveGame,
  getReviveStatus,
  skipLevel,
  type LevelObject,
} from "@/lib/game.functions";

import { useServerFn } from "@tanstack/react-start";
import { hapticNotify, hapticTap } from "@/lib/telegram-webapp";
import gtcCoin from "@/assets/gtc-coin.png";

export const Route = createFileRoute("/game")({
  validateSearch: (s: Record<string, unknown>) => ({
    level: s.level ? Math.max(1, Math.min(10000, Number(s.level))) : undefined,
  }),
  component: GameRoute,
});

function GameRoute() {
  return (
    <AppShell>
      <GameInner />
    </AppShell>
  );
}

type Stage =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "playing";
      sessionId: string;
      level: Level;
      objects: LevelObject[];
      levelIndex: number;
      levelCap: number;
      /** Seconds into the level to start at — 0 for fresh start / Revive,
       *  >0 when Resuming from the point of death. */
      initialRunTime: number;
      /** Bumped each time we (re)mount Flappy so React remounts the canvas. */
      runKey: number;
    }
  | { kind: "revive"; lastLevel: Level; lastObjects: LevelObject[]; lastLevelIndex: number; lastLevelCap: number; sessionId: string; deathElapsed: number }
  | {
      kind: "result";
      completed: boolean;
      coins: number;
      credited: number;
      bonus: number;
      newBalance: number;
      newLevel: number;
      levelCap: number;
      level: Level;
      levelIndex: number;

    };

type ReviveStatus = {
  freeLeft: number;
  nextPaidCost: number;
  balance_gtc: number;
};

function GameInner() {
  const { initData, settings, user, admin, refresh } = useSession();
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [status, setStatus] = useState<ReviveStatus | null>(null);
  const [devLevel, setDevLevel] = useState<number>(1);
  const [resumeGrace, setResumeGrace] = useState(0);
  const navigate = useNavigate();

  const enabled = settings.game_enabled !== false;
  const search = Route.useSearch();
  const levelOverride = search.level;


  const fetchStatus = useServerFn(getReviveStatus);
  const reviveFn = useServerFn(reviveGame);

  // Load revive status. When on the revive screen, scope it to the active
  // session so the free-revive counter reflects this game only.
  useEffect(() => {
    if (!initData) return;
    if (stage.kind === "revive") {
      fetchStatus({ data: { initData, sessionId: stage.sessionId } })
        .then((s) => setStatus({ freeLeft: s.freeLeft, nextPaidCost: s.nextPaidCost, balance_gtc: s.balance_gtc }))
        .catch(() => setStatus(null));
    } else if (stage.kind === "idle") {
      fetchStatus({ data: { initData } })
        .then((s) => setStatus({ freeLeft: s.freeLeft, nextPaidCost: s.nextPaidCost, balance_gtc: s.balance_gtc }))
        .catch(() => setStatus(null));
    }
  }, [initData, stage.kind, fetchStatus]);

  const startMut = useMutation({
    mutationFn: async () => {
      // Show the branded loading screen immediately so the user never sees
      // the start screen sitting idle while assets/server warm up.
      setStage({ kind: "loading" });
      const res = await startGame({ data: { initData: initData!, levelOverride } });
      await refresh();
      return res;
    },
    onSuccess: (res) => {
      // Keep the loading screen up briefly so the canvas + background images
      // have time to decode — covers the visible lag when the game opens.
      setTimeout(() => {
        setStage({
          kind: "playing",
          sessionId: res.sessionId,
          level: res.level,
          objects: res.objects,
          levelIndex: res.levelIndex,
          levelCap: res.levelCap,
          initialRunTime: 0,
          runKey: Date.now(),
        });
        hapticTap("medium");
      }, 700);
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Could not start");
      setStage({ kind: "idle" });
    },
  });

  const finishMut = useMutation({
    mutationFn: (v: { sessionId: string; coins: number; completed: boolean }) =>
      finishGame({
        data: {
          initData: initData!,
          sessionId: v.sessionId,
          coinsCollected: v.coins,
          completed: v.completed,
        },
      }),
  });

  if (!enabled) {
    return (
      <div className="p-4 pt-8">
        <GoldFrame className="p-6 text-center">
          <Construction className="mx-auto h-8 w-8 text-gold" />
          <h2 className="mt-3 font-display text-xl text-gold-soft">Game paused</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The game is temporarily disabled. Check back soon.
          </p>
        </GoldFrame>
      </div>
    );
  }

  if (stage.kind === "playing") {
    return (
      <div className="fixed inset-0 z-50 bg-black">
        <Flappy
          key={stage.runKey}
          level={stage.level}
          objects={stage.objects}
          levelIndex={stage.levelIndex}
          devMode={!!admin && !!levelOverride}
          resumeGraceSec={resumeGrace}
          initialRunTime={stage.initialRunTime}


          onEnd={({ completed, coins, elapsed }) => {
            const lastLevel = stage.level;
            const sessId = stage.sessionId;
            if (!completed) {
              // INSTANT: show revive screen immediately, persist result in background.
              hapticNotify("error");
              setStage({
                kind: "revive",
                lastLevel,
                lastObjects: stage.objects,
                lastLevelIndex: stage.levelIndex,
                lastLevelCap: stage.levelCap,
                sessionId: sessId,
                deathElapsed: elapsed,
              });
              finishMut.mutate({ sessionId: sessId, coins, completed: false });
              return;
            }
            finishMut.mutate(
              { sessionId: sessId, coins, completed: true },
              {
                onSuccess: async (res) => {
                  if (res.ok) {
                    hapticNotify("success");
                    toast.success(`🎉 Level complete — +${res.credited} GTC!`, {
                      duration: 4000,
                      icon: <PartyPopper className="text-gold" />,
                    });
                    if (res.bonus > 0) {
                      toast.success(`🎁 Milestone bonus +${res.bonus} GTC!`, {
                        duration: 5000,
                        icon: <Gift className="text-gold" />,
                      });
                    }
                    setStage({
                      kind: "result",
                      completed: res.completed,
                      coins: res.coinsCollected,
                      credited: res.credited,
                      bonus: res.bonus,
                      newBalance: res.newBalance,
                      newLevel: res.newLevel,
                      levelCap: res.levelCap,
                      level: lastLevel,
                      levelIndex: stage.levelIndex,

                    });
                    await refresh();
                  }
                },
              },
            );
          }}
        />
        <button
          onClick={() => { setResumeGrace(0); setStage({ kind: "idle" }); }}
          className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-md border border-gold-soft/50 bg-black/70 px-5 py-2 text-xs font-semibold uppercase tracking-widest text-gold-soft shadow-lg"
        >
          Quit
        </button>
      </div>
    );
  }

  if (stage.kind === "revive") {
    const balance = Number(status?.balance_gtc ?? user?.balance_gtc ?? 0);
    const freeLeft = status?.freeLeft ?? 2;
    const paidCost = status?.nextPaidCost ?? 200;
    const reviveStage = stage;
    // Restart the level (Revive = from beginning, Resume = from death point).
    const restartAt = (initialRunTime: number) => {
      setResumeGrace(4);
      setStage({
        kind: "playing",
        sessionId: reviveStage.sessionId,
        level: reviveStage.lastLevel,
        objects: reviveStage.lastObjects,
        levelIndex: reviveStage.lastLevelIndex,
        levelCap: reviveStage.lastLevelCap,
        initialRunTime,
        runKey: Date.now(),
      });
    };
    const charge = async (paid: boolean): Promise<boolean> => {
      if (paid && balance < paidCost) {
        toast.error(`Need ${paidCost} GTC — have ${balance.toFixed(0)}`);
        return false;
      }
      try {
        await reviveFn({
          data: { initData: initData!, sessionId: reviveStage.sessionId },
        });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Revive failed");
        return false;
      }
      await refresh();
      return true;
    };
    return (
      <ReviveScreen
        freeLeft={freeLeft}
        paidCost={paidCost}
        balance={balance}
        loading={startMut.isPending}
        onResume={async () => {
          const ok = await charge(freeLeft <= 0);
          if (ok) restartAt(Math.max(0, reviveStage.deathElapsed - 1.5));
        }}
        onRevive={async () => {
          const ok = await charge(freeLeft <= 0);
          if (ok) restartAt(0);
        }}
        onGiveUp={() => { setResumeGrace(0); setStage({ kind: "idle" }); }}
      />
    );
  }


  if (stage.kind === "result") {
    return <ResultScreen {...stage} onHome={() => setStage({ kind: "idle" })} />;
  }

  if (stage.kind === "loading") {
    return <LoadingScreen />;
  }

  return (
    <>
      {admin && (
        <div className="m-4 rounded-lg border border-gold-soft/60 bg-black/60 p-3 text-xs">
          <p className="mb-2 font-display uppercase tracking-widest text-gold">
            🛡 Admin Dev Mode — invincible, pick any level (1–100)
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={100}
              value={devLevel}
              onChange={(e) => setDevLevel(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
              className="w-20 rounded border border-gold-soft/40 bg-black/40 px-2 py-1 text-gold-soft"
            />
            <button
              onClick={() => {
                navigate({ to: "/game", search: { level: devLevel } });
                setResumeGrace(0);
                setTimeout(() => startMut.mutate(), 50);
              }}
              className="rounded bg-gradient-gold-flat px-3 py-1 font-bold text-primary-foreground"
            >
              Play Lv {devLevel} (Dev)
            </button>
          </div>
        </div>
      )}
      <StartScreen
        onPlay={() => { setResumeGrace(0); startMut.mutate(); }}
        loading={startMut.isPending}
        currentLevel={(user as unknown as { current_level?: number } | null)?.current_level ?? 1}
        skipFee={Number(settings.level_skip_fee_gtc ?? 500)}
        skipPrize={Number(settings.level_skip_prize_gtc ?? 200)}
        balance={Number(user?.balance_gtc ?? 0)}
        onSkip={async () => {
          try {
            const r = await skipLevel({ data: { initData: initData! } });
            await refresh();
            toast.success(`Skipped to Lv ${r.newLevel} · +${r.prize - r.fee} GTC net`);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Skip failed");
          }
        }}
      />
    </>
  );
}



function LoadingScreen() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black">
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center font-display text-[260px] font-black text-gold/[0.04] select-none">
        GTC
      </span>
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative z-10 flex flex-col items-center gap-6"
      >
        <div className="relative">
          <div className="absolute inset-0 blur-3xl bg-gradient-gold-flat opacity-60 rounded-full" />
          <motion.img
            src={gtcCoin}
            alt="GTC"
            animate={{ rotateY: 360 }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
            className="relative h-32 w-32 rounded-full object-cover border-4 border-gold-soft shadow-gold-strong"
          />
        </div>
        <p className="font-display text-lg uppercase tracking-[0.4em] text-gold-soft">
          Loading…
        </p>
        <div className="flex gap-2">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="h-2 w-2 rounded-full bg-gold-soft"
              animate={{ opacity: [0.2, 1, 0.2], y: [0, -4, 0] }}
              transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
            />
          ))}
        </div>
      </motion.div>
    </div>
  );
}




function ReviveScreen({
  freeLeft,
  paidCost,
  balance,
  loading,
  onResume,
  onRevive,
  onGiveUp,
}: {
  freeLeft: number;
  paidCost: number;
  balance: number;
  loading: boolean;
  onResume: () => void;
  onRevive: () => void;
  onGiveUp: () => void;
}) {
  const usingFree = freeLeft > 0;
  const disabled = loading || (!usingFree && balance < paidCost);
  const costLabel = usingFree ? `FREE · ${freeLeft} left` : `${paidCost} GTC`;
  return (
    <div className="flex min-h-[calc(100dvh-80px)] flex-col items-center justify-center p-6 gap-5">
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", duration: 0.5 }}
      >
        <Heart className="h-14 w-14 text-gold drop-shadow-[0_0_18px_rgba(242,210,122,0.65)]" />
      </motion.div>
      <h2 className="font-display text-3xl text-gradient-gold tracking-wider">Continue?</h2>
      <p className="-mt-2 text-center text-sm text-muted-foreground">
        Resume from where you died, or Revive from the start of the level. Both grant a 4s shield.
      </p>

      <GoldFrame className="w-full max-w-sm p-4 space-y-3">
        <button
          onClick={onResume}
          disabled={disabled}
          className="w-full flex items-center justify-between rounded-lg border border-gold-soft/60 bg-black/50 px-4 py-3 disabled:opacity-40"
        >
          <span className="flex items-center gap-2 font-display uppercase tracking-widest text-gold-soft">
            <Heart size={16} /> Resume
          </span>
          <span className="text-xs text-gold">{costLabel}</span>
        </button>

        <button
          onClick={onRevive}
          disabled={disabled}
          className="w-full flex items-center justify-between rounded-lg bg-gradient-gold-flat px-4 py-3 text-primary-foreground shadow-gold disabled:opacity-40"
        >
          <span className="flex items-center gap-2 font-display uppercase tracking-widest font-bold">
            <Zap size={16} /> Revive (restart level)
          </span>
          <span className="text-xs font-bold">{costLabel}</span>
        </button>

        <p className="text-center text-[11px] text-muted-foreground">
          Balance: {balance.toFixed(0)} GTC · 2 free credits every 24 hours (Dubai 12 AM). Paid cost doubles: 200 → 400 → 800 …
        </p>
      </GoldFrame>



      <button
        onClick={onGiveUp}
        className="text-xs uppercase tracking-widest text-muted-foreground underline"
      >
        Give up — back to home
      </button>
    </div>
  );
}

function StartScreen({
  onPlay,
  loading,
  currentLevel,
  skipFee,
  skipPrize,
  balance,
  onSkip,
}: {
  onPlay: () => void;
  loading: boolean;
  currentLevel: number;
  skipFee: number;
  skipPrize: number;
  balance: number;
  onSkip: () => void;
}) {
  const [skipping, setSkipping] = useState(false);
  return (
    <div className="relative flex min-h-[calc(100dvh-80px)] flex-col items-center justify-center overflow-hidden p-6">
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center font-display text-[260px] font-black text-gold/[0.04] select-none">
        GTC
      </span>

      <div className="relative z-10 flex flex-col items-center gap-6">
        <motion.div
          initial={{ scale: 0.5, opacity: 0, rotateY: -180 }}
          animate={{ scale: 1, opacity: 1, rotateY: 0 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="relative"
        >
          <div className="absolute inset-0 blur-3xl bg-gradient-gold-flat opacity-50 rounded-full" />
          <img
            src={gtcCoin}
            alt="GTC"
            className="relative h-40 w-40 rounded-full object-cover border-4 border-gold-soft shadow-gold-strong animate-pulse-gold"
          />
        </motion.div>

        <motion.p
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="font-display text-xl uppercase tracking-[0.4em] text-gold-soft"
        >
          Tap to Start · Level {currentLevel}
        </motion.p>

        <motion.button
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.6, type: "spring" }}
          onClick={onPlay}
          disabled={loading}
          className="relative h-24 w-24 rounded-full border-2 border-gold-soft bg-black/40 backdrop-blur-sm flex items-center justify-center shadow-gold animate-pulse-gold disabled:opacity-60"
          aria-label="Play"
        >
          <Play size={42} className="text-gold-soft ml-1" fill="currentColor" />
        </motion.button>

        <button
          onClick={async () => {
            if (skipping || loading) return;
            if (balance < skipFee) {
              toast.error(`Need ${skipFee} GTC to skip — you have ${balance.toFixed(0)}`);
              return;
            }
            if (!confirm(`Skip Level ${currentLevel}?\nFee: ${skipFee} GTC · Prize: ${skipPrize} GTC`)) return;
            setSkipping(true);
            try { await onSkip(); } finally { setSkipping(false); }
          }}
          disabled={skipping || loading}
          className="rounded-lg border border-gold-soft/50 bg-black/50 px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-gold-soft disabled:opacity-50"
        >
          {skipping ? "Skipping…" : `Skip Level (${skipFee} GTC)`}
        </button>

        <GoldFrame className="px-5 py-3 text-center">
          <p className="text-[11px] uppercase tracking-widest text-gold">Unlimited Play</p>
          <p className="font-display text-lg text-gold-soft">200 GTC per level</p>
          <p className="text-[10px] text-muted-foreground">
            Bonus +5,000 GTC at level 50 and 100 · 2 free revives every 24 hours
          </p>
        </GoldFrame>
      </div>
    </div>
  );
}


function ResultScreen({
  completed,
  credited,
  bonus,
  newBalance,
  newLevel,
  levelCap,
  level,
  levelIndex,
  onHome,
}: {
  completed: boolean;
  coins: number;
  credited: number;
  bonus: number;
  newBalance: number;
  newLevel: number;
  levelCap: number;
  level: Level;
  levelIndex: number;
  onHome: () => void;
}) {
  void newLevel;
  const minutes = Math.max(1, Math.round(level.duration_seconds / 60));
  const allLevelsDone = completed && levelIndex >= levelCap;

  if (allLevelsDone) {
    return (
      <div className="relative min-h-[calc(100dvh-80px)] overflow-hidden flex items-center justify-center px-5">
        <GoldFrame glow className="w-full max-w-sm p-6 text-center space-y-4">
          <div className="text-6xl">👑</div>
          <h1 className="font-display text-3xl text-gradient-gold">All 100 Levels Complete!</h1>
          <p className="text-sm text-gold-soft">
            You have completed the maximum of 100 levels. Thank you for playing!
          </p>
          <div className="rounded-lg border border-gold-soft/40 bg-black/40 p-3 text-xs text-muted-foreground">
            Please wait for the withdrawal announcement. We will notify you once withdrawals are available.
          </div>
          {credited > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Final reward: +{credited} GTC · Balance {newBalance.toFixed(0)} GTC
            </p>
          )}
          <button
            onClick={onHome}
            className="w-full rounded-lg border border-gold-soft/40 bg-black/40 px-6 py-2.5 text-sm font-semibold uppercase tracking-widest text-gold-soft"
          >
            Back to home
          </button>
        </GoldFrame>
      </div>
    );
  }

  return (
    <div className="relative min-h-[calc(100dvh-80px)] overflow-hidden">
      <span className="pointer-events-none absolute top-3 left-3 h-8 w-8 border-t-2 border-l-2 border-gold-soft" />
      <span className="pointer-events-none absolute top-3 right-3 h-8 w-8 border-t-2 border-r-2 border-gold-soft" />
      <span className="pointer-events-none absolute bottom-3 left-3 h-8 w-8 border-b-2 border-l-2 border-gold-soft" />
      <span className="pointer-events-none absolute bottom-3 right-3 h-8 w-8 border-b-2 border-r-2 border-gold-soft" />

      <div className="relative z-10 flex flex-col items-center gap-5 px-5 pt-8 pb-8">
        <motion.div
          initial={{ scale: 0, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", duration: 0.6 }}
          className="text-5xl"
        >
          {completed ? "👑" : "⏱️"}
        </motion.div>

        <motion.h1
          initial={{ y: -30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="font-display text-5xl font-black text-gradient-gold tracking-wider"
        >
          {completed ? "YOU WIN!" : "GAME OVER"}
        </motion.h1>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="clip-hex bg-gradient-gold-flat px-8 py-2"
        >
          <p className="flex items-center gap-2 font-semibold text-primary-foreground">
            <CheckCircle2 size={16} />
            {minutes} MINUTE FLIGHT {completed ? "COMPLETE" : "ENDED"}!
          </p>
        </motion.div>

        {completed && (
          <GoldFrame glow className="w-full max-w-sm p-5 text-center space-y-2">
            <p className="text-[11px] uppercase tracking-widest text-gold">Reward</p>
            <p className="font-display text-3xl text-gradient-gold">+{credited} GTC</p>
            {bonus > 0 && (
              <p className="text-xs text-gold-soft">
                Includes 🎁 {bonus} GTC milestone bonus!
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">
              New balance: {newBalance.toFixed(0)} GTC
            </p>
          </GoldFrame>
        )}

        <button
          onClick={onHome}
          className="rounded-lg border border-gold-soft/40 bg-black/40 px-6 py-2.5 text-sm font-semibold uppercase tracking-widest text-gold-soft"
        >
          Back to home
        </button>
      </div>
    </div>
  );
}

