import { Link, useLocation } from "@tanstack/react-router";
import { Home, Gamepad2, Wallet, Trophy } from "lucide-react";
import { hapticTap } from "@/lib/telegram-webapp";

const items = [
  { to: "/", label: "Home", icon: Home },
  { to: "/game", label: "Game", icon: Gamepad2 },
  { to: "/wallet", label: "Wallet", icon: Wallet },
  { to: "/leaderboard", label: "Top", icon: Trophy },
] as const;

export function BottomNav() {
  const { pathname } = useLocation();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-gold-soft bg-black/85 backdrop-blur-md pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-md items-stretch justify-around">
        {items.map(({ to, label, icon: Icon }) => {
          const active = pathname === to || (to !== "/" && pathname.startsWith(to));
          return (
            <Link
              key={to}
              to={to}
              onClick={() => hapticTap("light")}
              className="flex flex-1 flex-col items-center gap-1 py-2.5 transition-colors"
            >
              <Icon
                size={22}
                className={active ? "text-gold-soft drop-shadow-[0_0_8px_rgba(242,210,122,0.6)]" : "text-muted-foreground"}
                strokeWidth={active ? 2.5 : 1.8}
              />
              <span
                className={`text-[10px] uppercase tracking-widest ${active ? "text-gold-soft font-semibold" : "text-muted-foreground"}`}
              >
                {label}
              </span>
              {active && (
                <span className="absolute bottom-0 h-[2px] w-8 rounded-full bg-gradient-gold-flat shadow-gold" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
