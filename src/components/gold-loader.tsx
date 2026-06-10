import { Loader2 } from "lucide-react";
import gtcCoin from "@/assets/gtc-coin.png";

export function GoldLoader({ label }: { label?: string }) {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-6 bg-background z-50">
      <div className="relative flex h-32 w-32 items-center justify-center">
        <div className="absolute inset-0 rounded-full bg-gradient-gold-flat blur-2xl opacity-50 animate-pulse-gold" />
        <img
          src={gtcCoin}
          alt="GTC"
          className="relative h-28 w-28 object-contain drop-shadow-[0_0_24px_rgba(242,210,122,0.55)]"
          style={{ animation: "spin 2.4s linear infinite" }}
        />
      </div>
      {label && (
        <p className="text-sm text-muted-foreground tracking-wide text-center px-6">
          {label}
        </p>
      )}
      <Loader2 className="h-4 w-4 animate-spin text-gold" />
    </div>
  );
}
