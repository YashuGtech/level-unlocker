import { Outlet, Link, useNavigate } from "@tanstack/react-router";
import { ReactNode, useEffect, useState } from "react";
import { ExternalLink, AlertTriangle, KeyRound, LogIn } from "lucide-react";
import { useSession } from "@/lib/session";
import { BottomNav } from "@/components/bottom-nav";
import { GoldLoader } from "@/components/gold-loader";
import { GoldFrame } from "@/components/gold-ui";
import { dismissMyLock, dismissMyBroadcastLock } from "@/lib/locks.functions";

export function AppShell({ children }: { children?: ReactNode }) {
  const { loading, error, user, lock, initData, refresh, authMode, devMode } = useSession();
  const navigate = useNavigate();

  // Browser visitor with no Telegram & no web session → send to /auth.
  useEffect(() => {
    if (!loading && !user && devMode && authMode === "none") {
      void navigate({ to: "/auth" });
    }
  }, [loading, user, devMode, authMode, navigate]);

  if (loading) return <GoldLoader label="Authenticating…" />;

  if (error || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <GoldFrame className="max-w-sm p-6 text-center">
          <h1 className="font-display text-xl text-gold-soft">
            {authMode === "telegram" ? "Authentication failed" : "Sign in required"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {error ?? "Sign in with your Telegram account or phone number to play."}
          </p>
          <Link
            to="/auth"
            className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-gradient-gold-flat px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            <LogIn className="h-3.5 w-3.5" /> Sign in
          </Link>
          {authMode === "telegram" && (
            <button
              onClick={() => void refresh()}
              className="mt-2 w-full rounded-md border border-gold-soft/40 bg-black/40 px-4 py-2 text-sm text-gold-soft"
            >
              Retry Telegram
            </button>
          )}
          <Link
            to="/trial"
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-gold-soft/50 bg-black/40 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-gold-soft"
          >
            <KeyRound className="h-3.5 w-3.5" /> Trial Access (password)
          </Link>
        </GoldFrame>
      </div>
    );
  }

  if (lock && initData) {
    return <LockGate message={lock.message} url={lock.url} scope={lock.scope} initData={initData} onCleared={() => void refresh()} />;
  }

  return (
    <div className="relative mx-auto min-h-screen w-full max-w-md pb-20 bg-circuit">
      {children ?? <Outlet />}
      <BottomNav />
    </div>
  );
}

// Keep unused import out of warnings

function LockGate({
  message,
  url,
  scope,
  initData,
  onCleared,
}: {
  message: string;
  url: string;
  scope: "user" | "broadcast";
  initData: string;
  onCleared: () => void;
}) {
  const [clicking, setClicking] = useState(false);

  const handleClick = async () => {
    setClicking(true);
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      /* ignore */
    }
    try {
      if (scope === "broadcast") {
        await dismissMyBroadcastLock({ data: { initData } });
      } else {
        await dismissMyLock({ data: { initData } });
      }
    } catch {
      /* still let them through — server will retry next bootstrap */
    }
    onCleared();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <GoldFrame className="w-full max-w-md p-6 text-center" glow>
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border-2 border-destructive bg-black/60 shadow-gold">
          <AlertTriangle className="h-6 w-6 text-destructive" />
        </div>
        <h1 className="mt-4 font-display text-2xl text-gradient-gold">Action Required</h1>
        <p className="mt-3 whitespace-pre-wrap text-sm text-gold-soft">{message}</p>
        <p className="mt-3 text-[11px] uppercase tracking-widest text-muted-foreground">
          You must click the link below to continue using the bot.
        </p>
        <button
          onClick={handleClick}
          disabled={clicking}
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg border-2 border-gold bg-gradient-gold-flat px-6 py-4 font-display text-base font-bold uppercase tracking-widest text-primary-foreground shadow-gold transition-transform active:scale-[0.98] disabled:opacity-60"
        >
          <ExternalLink className="h-4 w-4" />
          Click here
        </button>
        <p className="mt-3 text-[10px] text-muted-foreground">
          This appears one time only. After you click, the bot unlocks for you.
        </p>
      </GoldFrame>
    </div>
  );
}


