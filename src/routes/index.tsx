import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { motion } from "framer-motion";
import { Copy, Megaphone, Crown, Sparkles, Users, Gift } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { GoldFrame, GoldButton } from "@/components/gold-ui";
import { useSession } from "@/lib/session";
import { hapticNotify } from "@/lib/telegram-webapp";
import { getMyReferrals, redeemReferralCode } from "@/lib/referrals.functions";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <AppShell>
      <Home />
    </AppShell>
  );
}

function Home() {
  const { user, initData, settings, announcements, authMode, logout } = useSession();
  const refReward = Number(settings.refer_reward_gtc ?? 50);
  const rate = Number(settings.gtc_usdt_rate ?? 0.05);
  const usdt = ((user?.balance_gtc ?? 0) * rate).toFixed(2);

  const { data: refData, refetch: refetchRefs } = useQuery({
    queryKey: ["my-referrals"],
    queryFn: () => getMyReferrals({ data: { initData: initData! } }),
    enabled: !!initData,
  });

  const myCode = refData?.myCode ?? user?.username ?? null;
  const [enteredCode, setEnteredCode] = useState("");
  const redeemMut = useMutation({
    mutationFn: (code: string) => redeemReferralCode({ data: { initData: initData!, code } }),
    onSuccess: (r) => {
      toast.success(`+${r.reward} GTC redeemed from @${r.referrerUsername ?? "friend"}`);
      hapticNotify("success");
      setEnteredCode("");
      refetchRefs();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Redeem failed"),
  });

  const copyCode = async () => {
    if (!myCode) return;
    try {
      await navigator.clipboard.writeText(myCode);
      toast.success("Referral code copied");
      hapticNotify("success");
    } catch {
      toast.error("Copy failed");
    }
  };

  if (!user) return null;

  return (
    <div className="space-y-4 p-4 pt-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Welcome</p>
          <h1 className="font-display text-2xl text-gradient-gold">
            {user.first_name ?? user.username ?? "Player"}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {authMode === "web" && (
            <button
              onClick={() => void logout()}
              className="rounded-md border border-gold-soft/40 bg-black/40 px-2.5 py-1 text-[10px] uppercase tracking-widest text-gold-soft"
            >
              Sign out
            </button>
          )}
          {user.photo_url ? (
            <img
              src={user.photo_url}
              alt=""
              className="h-12 w-12 rounded-full border-2 border-gold-soft shadow-gold"
            />
          ) : (
            <div className="h-12 w-12 rounded-full border-2 border-gold-soft bg-gradient-gold-flat flex items-center justify-center font-display font-bold text-primary-foreground">
              {(user.first_name?.[0] ?? user.username?.[0] ?? "G").toUpperCase()}
            </div>
          )}
        </div>
      </div>

      {/* Balance */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <GoldFrame glow className="p-5 text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-gold">Your Balance</p>
          <p className="mt-2 font-display text-5xl font-bold text-gradient-gold">
            {user.balance_gtc.toFixed(0)}
            <span className="ml-2 text-xl text-gold-soft">GTC</span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">≈ ${usdt} USDT</p>
        </GoldFrame>
      </motion.div>

      {/* Announcements */}
      {announcements.length > 0 && (
        <div className="space-y-2">
          {announcements.map((a) => (
            <GoldFrame key={a.id} className="p-4">
              <div className="flex items-start gap-3">
                <Megaphone className="mt-0.5 h-4 w-4 flex-shrink-0 text-gold" />
                <div className="flex-1">
                  <h3 className="font-display font-semibold text-gold-soft">{a.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{a.body}</p>
                </div>
              </div>
            </GoldFrame>
          ))}
        </div>
      )}

      {/* Referral */}
      <GoldFrame className="p-4">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-gold" />
          <h3 className="font-display font-semibold text-gold-soft">Invite & Earn</h3>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Share your code — friends get <span className="text-gold font-bold">{refReward} GTC</span> on signup, and you earn <span className="text-gold font-bold">5%</span> of their winnings forever.
        </p>

        <p className="mt-3 text-[10px] uppercase tracking-widest text-gold">Your code</p>
        <div className="mt-1 flex gap-2">
          <code className="flex-1 truncate rounded-md border border-gold-soft/40 bg-black/40 px-3 py-2 text-sm font-bold text-gold-soft">
            {myCode ? `@${myCode}` : "Set a Telegram username first"}
          </code>
          <button
            onClick={copyCode}
            disabled={!myCode}
            className="rounded-md bg-gradient-gold-flat px-3 py-2 text-primary-foreground disabled:opacity-40"
            aria-label="Copy code"
          >
            <Copy size={16} />
          </button>
        </div>

        {/* Redeem someone else's code */}
        {!refData?.hasRedeemed && (
          <div className="mt-3">
            <p className="text-[10px] uppercase tracking-widest text-gold">Got a friend's code?</p>
            <div className="mt-1 flex gap-2">
              <input
                value={enteredCode}
                onChange={(e) => setEnteredCode(e.target.value)}
                placeholder="@username"
                className="flex-1 rounded-md border border-gold-soft/40 bg-black/40 px-3 py-2 text-sm"
              />
              <button
                onClick={() => enteredCode.trim() && redeemMut.mutate(enteredCode.trim())}
                disabled={!enteredCode.trim() || redeemMut.isPending}
                className="rounded-md bg-gradient-gold-flat px-3 py-2 text-xs font-bold text-primary-foreground disabled:opacity-40"
              >
                <Gift size={14} className="inline mr-1" />
                {redeemMut.isPending ? "…" : `+${refReward}`}
              </button>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">One-time only — pick wisely.</p>
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-md border border-gold-soft/30 bg-black/30 p-2 text-center">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Referred</p>
            <p className="font-display text-lg text-gradient-gold">{refData?.count ?? 0}</p>
          </div>
          <div className="rounded-md border border-gold-soft/30 bg-black/30 p-2 text-center">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Earned</p>
            <p className="font-display text-lg text-gradient-gold">
              {(refData?.totalEarned ?? 0).toFixed(0)} <span className="text-xs">GTC</span>
            </p>
          </div>
        </div>

        {refData && refData.referrals.length > 0 && (
          <div className="mt-3 space-y-1 max-h-40 overflow-y-auto">
            {refData.referrals.slice(0, 10).map((r) => (
              <div key={`${r.referred_id}_${r.created_at}`} className="flex items-center justify-between rounded border border-gold-soft/20 bg-black/20 px-2 py-1 text-xs">
                <span className="truncate text-gold-soft">
                  {r.first_name ?? r.username ?? `User ${r.referred_id}`}
                </span>
                <span className="text-gold font-bold">+{r.reward_gtc} GTC</span>
              </div>
            ))}
          </div>
        )}
      </GoldFrame>

      {/* Game CTAs */}
      <div className="space-y-3">
        <a href="/game" className="block">
          <GoldButton className="w-full text-base">
            <Sparkles className="h-4 w-4" />
            Play Flappy GTECH
          </GoldButton>
        </a>
      </div>

      {/* Admin shortcut */}
      <AdminLink />
    </div>
  );
}

function AdminLink() {
  const { admin } = useSession();
  if (!admin) return null;
  return (
    <a href="/admin" className="block">
      <GoldFrame className="p-3 text-center">
        <div className="flex items-center justify-center gap-2 text-gold-soft">
          <Crown size={16} />
          <span className="text-sm font-semibold uppercase tracking-widest">
            Admin Panel ({admin.role})
          </span>
        </div>
      </GoldFrame>
    </a>
  );
}
