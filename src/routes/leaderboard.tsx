import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Trophy, Award, Users } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { GoldFrame } from "@/components/gold-ui";
import { useSession } from "@/lib/session";
import { getLeaderboard, type LbRow } from "@/lib/leaderboard.functions";

export const Route = createFileRoute("/leaderboard")({
  component: LbRoute,
});

function LbRoute() {
  return (
    <AppShell>
      <Leaderboard />
    </AppShell>
  );
}

type TabKey = "balance" | "referrals";

function Leaderboard() {
  const { initData } = useSession();
  const [tab, setTab] = useState<TabKey>("balance");
  const { data, isLoading } = useQuery({
    queryKey: ["leaderboard"],
    queryFn: () => getLeaderboard({ data: { initData: initData! } }),
    enabled: !!initData,
  });

  const rows = tab === "balance" ? (data?.topBalance ?? []) : (data?.topReferrers ?? []);
  const unit = tab === "balance" ? "GTC" : "REFS";

  return (
    <div className="space-y-4 p-4 pt-6">
      <h1 className="font-display text-3xl text-gradient-gold">Leaderboard</h1>

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setTab("balance")}
          className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-display font-semibold uppercase tracking-widest transition ${
            tab === "balance"
              ? "border-gold-soft bg-gold-soft/15 text-gold-soft"
              : "border-gold-soft/30 text-muted-foreground"
          }`}
        >
          <Trophy className="h-4 w-4" />
          Top Balance
        </button>
        <button
          onClick={() => setTab("referrals")}
          className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-display font-semibold uppercase tracking-widest transition ${
            tab === "referrals"
              ? "border-gold-soft bg-gold-soft/15 text-gold-soft"
              : "border-gold-soft/30 text-muted-foreground"
          }`}
        >
          <Users className="h-4 w-4" />
          Top Referrals
        </button>
      </div>

      {isLoading ? (
        <p className="text-center text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <GoldFrame className="p-6 text-center text-muted-foreground text-sm">No data yet.</GoldFrame>
      ) : (
        <div className="space-y-2">
          {rows.map((r, idx) => (
            <Row key={`${tab}-${r.telegram_id}`} row={r} rank={idx + 1} unit={unit} />
          ))}
        </div>
      )}
    </div>
  );
}

const badgeStyle: Record<NonNullable<LbRow["badge"]>, { label: string; cls: string }> = {
  diamond: { label: "Diamond", cls: "from-cyan-300 to-blue-500 text-white" },
  gold: { label: "Gold", cls: "from-yellow-400 to-yellow-600 text-black" },
  silver: { label: "Silver", cls: "from-slate-300 to-slate-500 text-black" },
  bronze: { label: "Bronze", cls: "from-orange-400 to-orange-700 text-black" },
};

function Row({ row, rank, unit }: { row: LbRow; rank: number; unit: string }) {
  const rankColors = rank === 1 ? "text-yellow-300" : rank === 2 ? "text-slate-300" : rank === 3 ? "text-orange-400" : "text-muted-foreground";
  return (
    <GoldFrame className="p-3">
      <div className="flex items-center gap-3">
        <div className={`w-6 text-center font-display text-lg font-bold ${rankColors}`}>{rank}</div>
        <div className="flex-1">
          <p className="font-display font-bold text-gold-soft">
            @{row.username ?? row.first_name ?? `user${row.telegram_id}`}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center rounded-full border border-gold-soft/40 px-1.5 py-0.5 text-[9px] font-bold uppercase text-gold-soft">
              Lvl {row.level}
            </span>
            {row.is_premium && (
              <span className="text-[10px] text-cyan-400">★ Premium</span>
            )}
            {row.badge && (
              <span
                className={`inline-flex items-center gap-0.5 rounded-full bg-gradient-to-r px-1.5 py-0.5 text-[9px] font-bold uppercase ${badgeStyle[row.badge].cls}`}
              >
                <Award size={9} />
                {badgeStyle[row.badge].label}
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <p className="font-display text-lg font-bold text-gradient-gold">
            {unit === "GTC" ? row.value.toFixed(0) : row.value}
          </p>
          <p className="text-[10px] uppercase text-muted-foreground">{unit}</p>
        </div>
      </div>
    </GoldFrame>
  );
}
