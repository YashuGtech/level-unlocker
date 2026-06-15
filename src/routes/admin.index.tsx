import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  LayoutDashboard,
  Users,
  CreditCard,
  Megaphone,
  Settings as SettingsIcon,
  Map as MapIcon,
  ShieldCheck,
  Download,
  Trash2,
  Plus,
  Pencil,
  Check,
  X,
  Search,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { GoldFrame, GoldButton } from "@/components/gold-ui";
import { useSession } from "@/lib/session";
import { sfx } from "@/lib/sfx";
import {
  getAdminOverview,
  getTreasury,
  resetTreasury,
  findTransaction,
  listUsers,
  updateSettings,
  upsertAnnouncement,
  deleteAnnouncement,
  adjustBalance,
  setUserBanned,
  addSecondaryAdmin,
  removeSecondaryAdmin,
  getDepositStats,
  scanSuspiciousUsers,
  getUserHistory,
} from "@/lib/admin.functions";
import {
  adminLockUser,
  adminLockUsers,
  adminUnlockUser,
  adminBroadcastLock,
  adminClearBroadcastLock,
  adminBroadcastLockStats,
} from "@/lib/locks.functions";

import { deleteLevel } from "@/lib/levels.functions";
import { exportFrontendZip } from "@/lib/export.functions";
import { exportDatabaseBackup } from "@/lib/backup.functions";

export const Route = createFileRoute("/admin/")({
  component: AdminRoute,
});

type Tab = "dashboard" | "users" | "deposits" | "announcements" | "settings" | "levels" | "admins" | "scan";

function AdminRoute() {
  return (
    <AppShell>
      <AdminPanel />
    </AppShell>
  );
}

function AdminPanel() {
  const { admin, initData } = useSession();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("dashboard");

  const qc = useQueryClient();
  const overview = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => getAdminOverview({ data: { initData: initData! } }),
    enabled: !!initData && !!admin,
    refetchInterval: 20_000,
  });

  if (!admin) {
    return (
      <div className="p-4 pt-8">
        <GoldFrame className="p-6 text-center">
          <ShieldCheck className="mx-auto h-8 w-8 text-gold" />
          <h2 className="mt-3 font-display text-xl text-gold-soft">Forbidden</h2>
          <p className="mt-1 text-sm text-muted-foreground">This page is admin-only.</p>
          <button onClick={() => navigate({ to: "/" })} className="mt-4 text-sm text-gold-soft underline">
            Back to home
          </button>
        </GoldFrame>
      </div>
    );
  }

  const tabs: Array<{ id: Tab; label: string; icon: typeof LayoutDashboard }> = [
    { id: "dashboard", label: "Dash", icon: LayoutDashboard },
    { id: "deposits", label: "Deposits", icon: CreditCard },
    { id: "users", label: "Users", icon: Users },
    { id: "scan", label: "Scan", icon: AlertTriangle },
    { id: "levels", label: "Levels", icon: MapIcon },
    { id: "announcements", label: "Posts", icon: Megaphone },
    { id: "settings", label: "Settings", icon: SettingsIcon },
    ...(admin.role === "main" ? [{ id: "admins" as Tab, label: "Admins", icon: ShieldCheck }] : []),
  ];

  return (
    <div className="space-y-4 p-4 pt-4">
      <div className="flex items-center gap-3">
        <Link to="/" className="rounded-md border border-gold-soft/40 p-1.5 text-gold-soft">
          <ArrowLeft size={16} />
        </Link>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-gold">Admin</p>
          <h1 className="font-display text-2xl text-gradient-gold">Admin Panel</h1>
        </div>
      </div>

      <div className="-mx-2 overflow-x-auto px-2">
        <div className="flex gap-2 pb-2">
          {tabs.map((t) => {
            const Ic = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex flex-shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold uppercase tracking-wider ${active ? "border-gold-soft bg-gradient-gold-flat text-primary-foreground" : "border-gold-soft/30 text-muted-foreground"}`}
              >
                <Ic size={14} />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {overview.isLoading && <p className="text-center text-sm text-muted-foreground">Loading…</p>}
      {overview.error && (
        <p className="text-center text-sm text-destructive">{(overview.error as Error).message}</p>
      )}

      {overview.data && tab === "dashboard" && <Dashboard data={overview.data} />}
      {overview.data && tab === "deposits" && (
        <DepositsTab
          onChange={() => {
            void qc.invalidateQueries({ queryKey: ["admin-overview"] });
          }}
        />
      )}
      {tab === "users" && <UsersTab onChange={() => qc.invalidateQueries({ queryKey: ["admin-overview"] })} />}
      {tab === "scan" && <ScanTab />}
      {overview.data && tab === "levels" && (
        <LevelsTab levels={overview.data.levels} onChange={() => qc.invalidateQueries({ queryKey: ["admin-overview"] })} />
      )}
      {overview.data && tab === "announcements" && (
        <AnnouncementsTab
          items={overview.data.announcements}
          onChange={() => qc.invalidateQueries({ queryKey: ["admin-overview"] })}
        />
      )}
      {overview.data && tab === "settings" && (
        <SettingsTab
          settings={overview.data.settings}
          onChange={() => qc.invalidateQueries({ queryKey: ["admin-overview"] })}
        />
      )}
      {overview.data && tab === "admins" && admin.role === "main" && (
        <AdminsTab
          admins={overview.data.admins}
          mainAdminId={Number(initData ? "" : "")}
          onChange={() => qc.invalidateQueries({ queryKey: ["admin-overview"] })}
        />
      )}
    </div>
  );
}

function Dashboard({ data }: { data: Awaited<ReturnType<typeof getAdminOverview>> }) {
  const { initData } = useSession();
  const qc = useQueryClient();
  const treasury = useQuery({
    queryKey: ["admin-treasury"],
    queryFn: () => getTreasury({ data: { initData: initData! } }),
    enabled: !!initData,
    refetchInterval: 30_000,
  });
  const resetMut = useMutation({
    mutationFn: () => resetTreasury({ data: { initData: initData! } }),
    onSuccess: () => {
      toast.success("Treasury reset to 0");
      qc.invalidateQueries({ queryKey: ["admin-treasury"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <GoldFrame className="p-4 text-center">
          <p className="text-xs uppercase tracking-widest text-gold">Users</p>
          <p className="font-display text-3xl font-bold text-gradient-gold">{data.stats.totalUsers}</p>
        </GoldFrame>
        <GoldFrame className="p-4 text-center" glow>
          <p className="text-xs uppercase tracking-widest text-emerald-300">Online</p>
          <p className="font-display text-3xl font-bold text-emerald-300">
            <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400 align-middle" />
            {data.stats.onlineUsers}
          </p>
          <p className="mt-1 text-[10px] uppercase tracking-widest text-muted-foreground">active · 5 min</p>
        </GoldFrame>
        <GoldFrame className="p-4 text-center">
          <p className="text-xs uppercase tracking-widest text-gold">Pending</p>
          <p className="font-display text-3xl font-bold text-gradient-gold">{data.stats.pendingDeposits}</p>
        </GoldFrame>
      </div>


      <TreasuryCard
        data={treasury.data}
        loading={treasury.isLoading}
        onReset={() => {
          if (confirm("Reset company treasury net worth to 0?\nThis hides all prior activity from the dashboard.")) {
            resetMut.mutate();
          }
        }}
        resetting={resetMut.isPending}
      />

      <TxnLookupCard />

      <GoldFrame className="p-3">
        <h3 className="mb-2 font-display text-sm uppercase tracking-widest text-gold-soft">Recent admin actions</h3>
        {data.recentLogs.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing logged.</p>
        ) : (
          <div className="space-y-1">
            {data.recentLogs.map((l) => (
              <p key={l.id} className="text-xs text-muted-foreground">
                <span className="text-gold-soft">{l.action}</span> {l.target ?? ""} ·{" "}
                {new Date(l.created_at).toLocaleString()}
              </p>
            ))}
          </div>
        )}
      </GoldFrame>
    </div>
  );
}

function TxnLookupCard() {
  const { initData } = useSession();
  const [q, setQ] = useState("");
  const mut = useMutation({
    mutationFn: (query: string) => findTransaction({ data: { initData: initData!, q: query } }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Search failed"),
  });
  return (
    <GoldFrame className="p-4 space-y-2">
      <h3 className="font-display text-sm uppercase tracking-widest text-gold-soft">Transaction lookup</h3>
      <p className="text-[11px] text-muted-foreground">Enter an in-app TXN id (UUID), deposit id, or on-chain hash.</p>
      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="TXN id / hash"
          className="flex-1 rounded border border-gold-soft/40 bg-black/40 px-2 py-1.5 text-xs font-mono"
        />
        <GoldButton onClick={() => q.trim() && mut.mutate(q.trim())} disabled={mut.isPending} className="text-xs">
          <Search size={14} /> Find
        </GoldButton>
      </div>
      {mut.data && mut.data.results.length === 0 && (
        <p className="text-xs text-destructive">No match.</p>
      )}
      {mut.data?.results.map((r) => (
        <div key={`${r.kind}_${r.id}`} className="rounded border border-gold-soft/30 bg-black/30 p-2 text-[11px] space-y-0.5">
          <p className="text-gold-soft uppercase tracking-wider">{r.kind} · {r.note}</p>
          <p>User: <span className="text-gold">@{r.username ?? r.first_name ?? r.user_id}</span> (id {r.user_id})</p>
          <p>Amount: <span className="text-gold">{r.amount.toFixed(2)} GTC</span> · Balance now: {r.balance_gtc.toFixed(2)}</p>
          {r.tx_hash && <p className="font-mono break-all text-gold-soft/70">{r.tx_hash}</p>}
          <p className="text-muted-foreground">{new Date(r.created_at).toLocaleString()}</p>
        </div>
      ))}
    </GoldFrame>
  );
}

function TreasuryCard({
  data,
  loading,
  onReset,
  resetting,
}: {
  data: Awaited<ReturnType<typeof getTreasury>> | undefined;
  loading: boolean;
  onReset: () => void;
  resetting: boolean;
}) {
  if (loading || !data) {
    return (
      <GoldFrame className="p-4">
        <p className="text-xs text-muted-foreground">Loading treasury…</p>
      </GoldFrame>
    );
  }
  const maxBar = Math.max(1, ...data.daily.map((d) => Math.max(d.inflow, d.outflow)));
  const netColor = data.treasuryGtc >= 0 ? "text-gradient-gold" : "text-destructive";
  return (
    <GoldFrame glow className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm uppercase tracking-widest text-gold-soft">Company Treasury · Net Worth</h3>
        <button
          onClick={onReset}
          disabled={resetting}
          className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-[10px] uppercase tracking-wider text-destructive disabled:opacity-50"
        >
          {resetting ? "Resetting…" : "Reset to 0"}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-gold-soft/30 bg-black/40 p-3 text-center">
          <p className="text-[10px] uppercase tracking-widest text-gold">USDT Balance</p>
          <p className="font-display text-2xl font-bold text-gradient-gold">${data.treasuryUsdt.toFixed(2)}</p>
        </div>
        <div className="rounded-lg border border-gold-soft/30 bg-black/40 p-3 text-center">
          <p className="text-[10px] uppercase tracking-widest text-gold">GTC Net</p>
          <p className={`font-display text-2xl font-bold ${netColor}`}>{data.treasuryGtc.toFixed(0)}</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-[10px] uppercase tracking-widest">
        <div>
          <p className="text-gold">Inflow</p>
          <p className="text-gold-soft text-sm font-bold">{data.inflow.toFixed(0)}</p>
        </div>
        <div>
          <p className="text-gold">Outflow</p>
          <p className="text-gold-soft text-sm font-bold">{data.outflow.toFixed(0)}</p>
        </div>
        <div>
          <p className="text-gold">Liabilities</p>
          <p className="text-gold-soft text-sm font-bold">{data.userLiabilities.toFixed(0)}</p>
        </div>
      </div>
      {data.hasActivity ? (
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-widest text-gold">Last 30 days (GTC)</p>
          <div className="flex h-28 items-end gap-[2px] rounded border border-gold-soft/20 bg-black/30 p-2">
            {data.daily.map((d) => {
              const inH = (d.inflow / maxBar) * 100;
              const outH = (d.outflow / maxBar) * 100;
              return (
                <div key={d.day} className="flex flex-1 flex-col justify-end gap-[1px]" title={`${d.day}  in:${d.inflow.toFixed(0)}  out:${d.outflow.toFixed(0)}`}>
                  <div className="bg-gold-soft/80" style={{ height: `${inH}%` }} />
                  <div className="bg-destructive/70" style={{ height: `${outH}%` }} />
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex items-center justify-between text-[9px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 bg-gold-soft/80" /> Inflow</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 bg-destructive/70" /> Outflow</span>
          </div>
        </div>
      ) : (
        <p className="text-center text-[11px] text-muted-foreground">
          No treasury activity yet{data.resetAt ? ` since ${new Date(data.resetAt).toLocaleDateString()}` : ""}.
        </p>
      )}
    </GoldFrame>
  );
}

function DepositsTab({
  onChange: _onChange,
}: {
  onChange: () => void;
}) {
  const { initData } = useSession();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const stats = useQuery({
    queryKey: ["admin-deposit-stats"],
    queryFn: () => getDepositStats({ data: { initData: initData! } }),
    enabled: !!initData,
  });

  const submitSearch = () => {
    const v = search.trim();
    if (!v) return;
    try {
      sessionStorage.setItem("admin-deposit-search", v);
    } catch { /* ignore */ }
    navigate({ to: "/admin/deposits/$status", params: { status: "all" } });
  };

  const StatCard = ({
    label,
    count,
    total,
    color,
    border,
    status,
    Icon,
  }: {
    label: string;
    count: number;
    total: number;
    color: string;
    border: string;
    status: "pending" | "rejected" | "approved" | "all";
    Icon: typeof Clock;
  }) => (
    <Link
      to="/admin/deposits/$status"
      params={{ status }}
      className={`rounded-xl border ${border} bg-black/40 p-3 text-center transition hover:bg-black/60`}
    >
      <div className={`flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-widest ${color}`}>
        <Icon size={14} /> {label}
      </div>
      <p className="font-display text-2xl font-bold text-foreground">{count}</p>
      <p className="text-[10px] text-muted-foreground">$ {total.toFixed(2)}</p>
    </Link>
  );


  const s = stats.data ?? {
    pending: { count: 0, totalUsdt: 0 },
    rejected: { count: 0, totalUsdt: 0 },
    approved: { count: 0, totalUsdt: 0 },
    total: { count: 0, totalUsdt: 0 },
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label="Pending" count={s.pending.count} total={s.pending.totalUsdt} color="text-purple-300" border="border-purple-500/40" status="pending" Icon={Clock} />
        <StatCard label="Rejected" count={s.rejected.count} total={s.rejected.totalUsdt} color="text-destructive" border="border-destructive/40" status="rejected" Icon={X} />
        <StatCard label="Approved" count={s.approved.count} total={s.approved.totalUsdt} color="text-success" border="border-success/40" status="approved" Icon={Check} />
        <StatCard label="Total" count={s.total.count} total={s.total.totalUsdt} color="text-sky-300" border="border-sky-500/40" status="all" Icon={CreditCard} />
      </div>

      <GoldFrame className="p-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitSearch()}
              placeholder="Search UID or TX hash"
              className="w-full rounded-md border border-gold-soft/40 bg-black/40 px-8 py-2 text-sm font-mono"
            />
          </div>
          <GoldButton onClick={submitSearch} className="text-xs">
            Search
          </GoldButton>
        </div>
      </GoldFrame>

      <GoldFrame className="p-4 text-center">
        <p className="text-xs text-muted-foreground">
          Click any card above to view deposits on a dedicated page.
        </p>
      </GoldFrame>
    </div>
  );
}



function UsersTab({ onChange }: { onChange: () => void }) {
  const { initData } = useSession();
  const [search, setSearch] = useState("");
  const q = useQuery({
    queryKey: ["admin-users", search],
    queryFn: () => listUsers({ data: { initData: initData!, search: search || undefined } }),
    enabled: !!initData,
  });
  const adjMut = useMutation({
    mutationFn: (v: { userId: number; delta: number }) =>
      adjustBalance({ data: { initData: initData!, userId: v.userId, delta: v.delta, note: "Admin adjustment" } }),
    onSuccess: () => {
      toast.success("Balance updated");
      q.refetch();
      onChange();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const banMut = useMutation({
    mutationFn: (v: { userId: number; banned: boolean }) =>
      setUserBanned({ data: { initData: initData!, userId: v.userId, banned: v.banned } }),
    onSuccess: () => {
      toast.success("Updated");
      q.refetch();
    },
  });
  const lockMut = useMutation({
    mutationFn: (v: { userId: number; message: string; url: string }) =>
      adminLockUser({ data: { initData: initData!, userId: v.userId, message: v.message, url: v.url } }),
    onSuccess: () => { toast.success("User locked — they'll see the notice on next bootstrap"); q.refetch(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const unlockMut = useMutation({
    mutationFn: (userId: number) => adminUnlockUser({ data: { initData: initData!, userId } }),
    onSuccess: () => { toast.success("Lock removed"); q.refetch(); },
  });

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search username or telegram_id"
          className="w-full rounded-md border border-gold-soft/40 bg-black/40 px-8 py-2 text-sm"
        />
      </div>
      {(q.data ?? []).map((u) => (
        <GoldFrame key={u.telegram_id} className="p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-display font-bold text-gold-soft">@{u.username ?? u.first_name ?? u.telegram_id}</p>
              <p className="text-[11px] text-muted-foreground">id: {u.telegram_id}</p>
              {u.banned && <p className="text-[10px] text-destructive uppercase">Banned</p>}
            </div>
            <div className="text-right">
              <p className="font-display font-bold text-gradient-gold">{u.balance_gtc.toFixed(0)} GTC</p>
              <div className="mt-1 flex gap-1">
                <button
                  onClick={() => {
                    const v = prompt("Adjust balance by (e.g. +100 or -50)", "+0");
                    const n = v ? Number(v) : NaN;
                    if (!isNaN(n) && n !== 0) adjMut.mutate({ userId: u.telegram_id, delta: n });
                  }}
                  className="rounded bg-gold/20 px-2 py-0.5 text-[10px] text-gold-soft"
                >
                  ± GTC
                </button>
                <button
                  onClick={() => banMut.mutate({ userId: u.telegram_id, banned: !u.banned })}
                  className="rounded bg-destructive/20 px-2 py-0.5 text-[10px] text-destructive"
                >
                  {u.banned ? "Unban" : "Ban"}
                </button>
                <button
                  onClick={() => {
                    const message = prompt("Lockout message shown to the user:");
                    if (!message) return;
                    const url = prompt("URL the user must click (https://…):");
                    if (!url) return;
                    lockMut.mutate({ userId: u.telegram_id, message, url });
                  }}
                  className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-300"
                >
                  Lock
                </button>
                <button
                  onClick={() => { if (confirm("Remove lock for this user?")) unlockMut.mutate(u.telegram_id); }}
                  className="rounded bg-emerald-600/20 px-2 py-0.5 text-[10px] text-emerald-300"
                >
                  Unlock
                </button>
              </div>
            </div>
          </div>
        </GoldFrame>
      ))}
    </div>
  );
}

function LevelsTab({
  levels,
  onChange,
}: {
  levels: Awaited<ReturnType<typeof getAdminOverview>>["levels"];
  onChange: () => void;
}) {
  const { initData } = useSession();
  const delMut = useMutation({
    mutationFn: (id: string) => deleteLevel({ data: { initData: initData!, id } }),
    onSuccess: () => {
      toast.success("Deleted");
      onChange();
    },
  });
  return (
    <div className="space-y-2">
      <Link to="/admin/level/new">
        <GoldButton className="w-full">
          <Plus size={16} /> New Level
        </GoldButton>
      </Link>
      {levels.map((l) => (
        <GoldFrame key={l.id} className="p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-display font-bold text-gold-soft">{l.name}</p>
              <p className="text-[11px] text-muted-foreground">
                {l.duration_seconds}s · gap {l.pipe_gap} · weight {l.weight} ·{" "}
                {l.enabled ? <span className="text-success">enabled</span> : <span className="text-destructive">disabled</span>}
                {l.repeat_loop && " · 🔁"}
              </p>
            </div>
            <div className="flex gap-1">
              <Link
                to="/admin/level/$id"
                params={{ id: l.id }}
                className="rounded bg-gold/20 p-1.5 text-gold-soft"
              >
                <Pencil size={14} />
              </Link>
              <button
                onClick={() => confirm(`Delete "${l.name}"?`) && delMut.mutate(l.id)}
                className="rounded bg-destructive/20 p-1.5 text-destructive"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        </GoldFrame>
      ))}
    </div>
  );
}

function AnnouncementsTab({
  items,
  onChange,
}: {
  items: Awaited<ReturnType<typeof getAdminOverview>>["announcements"];
  onChange: () => void;
}) {
  const { initData } = useSession();
  const [editing, setEditing] = useState<{ id?: string; title: string; body: string; active: boolean } | null>(null);
  const saveMut = useMutation({
    mutationFn: () =>
      upsertAnnouncement({
        data: {
          initData: initData!,
          id: editing!.id,
          title: editing!.title,
          body: editing!.body,
          active: editing!.active,
        },
      }),
    onSuccess: () => {
      toast.success("Saved");
      setEditing(null);
      onChange();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => deleteAnnouncement({ data: { initData: initData!, id } }),
    onSuccess: () => {
      toast.success("Deleted");
      onChange();
    },
  });

  return (
    <div className="space-y-2">
      {!editing && (
        <GoldButton
          onClick={() => setEditing({ title: "", body: "", active: true })}
          className="w-full"
        >
          <Plus size={16} /> New post
        </GoldButton>
      )}
      {editing && (
        <GoldFrame className="space-y-2 p-3">
          <input
            value={editing.title}
            onChange={(e) => setEditing({ ...editing, title: e.target.value })}
            placeholder="Title"
            className="w-full rounded border border-gold-soft/40 bg-black/40 px-2 py-1 text-sm"
          />
          <textarea
            value={editing.body}
            onChange={(e) => setEditing({ ...editing, body: e.target.value })}
            placeholder="Body"
            rows={4}
            className="w-full rounded border border-gold-soft/40 bg-black/40 px-2 py-1 text-sm"
          />
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={editing.active}
              onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
            />{" "}
            Active
          </label>
          <div className="flex gap-2">
            <GoldButton onClick={() => saveMut.mutate()} disabled={!editing.title.trim() || !editing.body.trim()} className="flex-1 text-xs">
              Save
            </GoldButton>
            <button onClick={() => setEditing(null)} className="flex-1 rounded bg-card px-3 py-2 text-xs">
              Cancel
            </button>
          </div>
        </GoldFrame>
      )}
      {items.map((a) => (
        <GoldFrame key={a.id} className="p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <p className="font-display font-bold text-gold-soft">{a.title}</p>
              <p className="whitespace-pre-wrap text-xs text-muted-foreground">{a.body}</p>
              <p className="mt-1 text-[10px] uppercase text-muted-foreground">
                {a.active ? <span className="text-success">active</span> : <span className="text-destructive">hidden</span>}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <button onClick={() => setEditing(a)} className="rounded bg-gold/20 p-1.5 text-gold-soft">
                <Pencil size={12} />
              </button>
              <button
                onClick={() => confirm("Delete?") && delMut.mutate(a.id)}
                className="rounded bg-destructive/20 p-1.5 text-destructive"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        </GoldFrame>
      ))}
    </div>
  );
}

function SettingsTab({
  settings,
  onChange,
}: {
  settings: Record<string, string | number | boolean | null>;
  onChange: () => void;
}) {
  const { initData } = useSession();
  const [duration, setDuration] = useState(String(settings.level_duration_seconds ?? 60));
  const [reward, setReward] = useState(String(settings.level_reward_per_coin ?? 1));
  const [winPrize, setWinPrize] = useState(String(settings.level_win_prize_gtc ?? 200));
  const [skipFee, setSkipFee] = useState(String(settings.level_skip_fee_gtc ?? 500));
  const [skipPrize, setSkipPrize] = useState(String(settings.level_skip_prize_gtc ?? 200));
  const [coinBonus, setCoinBonus] = useState(String(settings.level_coin_bonus ?? 40));

  const mut = useMutation({
    mutationFn: () =>
      updateSettings({
        data: {
          initData: initData!,
          level_duration_seconds: Number(duration),
          level_reward_per_coin: Number(reward),
          level_win_prize_gtc: Number(winPrize),
          level_skip_fee_gtc: Number(skipFee),
          level_skip_prize_gtc: Number(skipPrize),
          level_coin_bonus: Number(coinBonus),
        },
      }),
    onSuccess: () => {
      toast.success("Settings updated");
      onChange();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="space-y-3">
      <GoldFrame className="space-y-3 p-4">
        <p className="text-[11px] text-muted-foreground">
          Win prize = <span className="text-gold">base prize</span> +
          (<span className="text-gold">coins collected</span> +{" "}
          <span className="text-gold">{coinBonus} bonus coins</span>) ×{" "}
          <span className="text-gold">{reward} GTC / coin</span>.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs">
            <span className="uppercase tracking-widest text-gold">Timer (s)</span>
            <input type="number" min={15} max={300} value={duration} onChange={(e) => setDuration(e.target.value)}
              className="mt-1 w-full rounded border border-gold-soft/40 bg-black/40 px-2 py-1.5 text-sm" />
          </label>
          <label className="block text-xs">
            <span className="uppercase tracking-widest text-gold">1 coin = GTC</span>
            <input type="number" step="0.01" min={0} value={reward} onChange={(e) => setReward(e.target.value)}
              className="mt-1 w-full rounded border border-gold-soft/40 bg-black/40 px-2 py-1.5 text-sm" />
          </label>
          <label className="block text-xs">
            <span className="uppercase tracking-widest text-gold">Base win prize (GTC)</span>
            <input type="number" min={0} value={winPrize} onChange={(e) => setWinPrize(e.target.value)}
              className="mt-1 w-full rounded border border-gold-soft/40 bg-black/40 px-2 py-1.5 text-sm" />
          </label>
          <label className="block text-xs">
            <span className="uppercase tracking-widest text-gold">Bonus coins / level</span>
            <input type="number" min={0} value={coinBonus} onChange={(e) => setCoinBonus(e.target.value)}
              className="mt-1 w-full rounded border border-gold-soft/40 bg-black/40 px-2 py-1.5 text-sm" />
          </label>
          <label className="block text-xs">
            <span className="uppercase tracking-widest text-gold">Skip fee (GTC)</span>
            <input type="number" min={0} value={skipFee} onChange={(e) => setSkipFee(e.target.value)}
              className="mt-1 w-full rounded border border-gold-soft/40 bg-black/40 px-2 py-1.5 text-sm" />
          </label>
          <label className="block text-xs">
            <span className="uppercase tracking-widest text-gold">Skip prize (GTC)</span>
            <input type="number" min={0} value={skipPrize} onChange={(e) => setSkipPrize(e.target.value)}
              className="mt-1 w-full rounded border border-gold-soft/40 bg-black/40 px-2 py-1.5 text-sm" />
          </label>
        </div>
        <GoldButton onClick={() => mut.mutate()} disabled={mut.isPending} className="w-full">
          {mut.isPending ? "Saving…" : "Save"}
        </GoldButton>
      </GoldFrame>

      <BroadcastLockCard />

      <CsvExportCard />
    </div>
  );
}

function BroadcastLockCard() {
  const { initData } = useSession();
  const qc = useQueryClient();
  const stats = useQuery({
    queryKey: ["admin-broadcast-lock"],
    queryFn: () => adminBroadcastLockStats({ data: { initData: initData! } }),
    enabled: !!initData,
    refetchInterval: 15_000,
  });
  const [message, setMessage] = useState("");
  const [url, setUrl] = useState("");
  const [target, setTarget] = useState<"all" | "selected">("all");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Map<number, string>>(new Map());

  const userQ = useQuery({
    queryKey: ["admin-lock-userlist", search],
    queryFn: () => listUsers({ data: { initData: initData!, search: search || undefined } }),
    enabled: !!initData && target === "selected" && pickerOpen,
  });

  const postAllMut = useMutation({
    mutationFn: () => adminBroadcastLock({ data: { initData: initData!, message: message.trim(), url: url.trim() } }),
    onSuccess: () => {
      toast.success("Lock posted to all users");
      setMessage(""); setUrl("");
      qc.invalidateQueries({ queryKey: ["admin-broadcast-lock"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const postSelectedMut = useMutation({
    mutationFn: () => adminLockUsers({
      data: {
        initData: initData!,
        userIds: Array.from(picked.keys()),
        message: message.trim(),
        url: url.trim(),
      },
    }),
    onSuccess: (r) => {
      toast.success(`Lock posted to ${r.count} user${r.count === 1 ? "" : "s"}`);
      setMessage(""); setUrl(""); setPicked(new Map()); setPickerOpen(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const clearMut = useMutation({
    mutationFn: () => adminClearBroadcastLock({ data: { initData: initData! } }),
    onSuccess: () => {
      toast.success("Lock removed");
      qc.invalidateQueries({ queryKey: ["admin-broadcast-lock"] });
    },
  });

  const active = stats.data?.active ?? null;
  const verifiedCount = stats.data?.verifiedCount ?? 0;
  const togglePick = (uid: number, label: string) =>
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(uid)) next.delete(uid);
      else next.set(uid, label);
      return next;
    });

  const canPost =
    !!message.trim() && !!url.trim() &&
    (target === "all" ? !postAllMut.isPending : picked.size > 0 && !postSelectedMut.isPending);

  return (
    <GoldFrame className="space-y-3 p-4">
      <h3 className="font-display text-sm uppercase tracking-widest text-gold-soft">
        Post Lock — Choose Audience
      </h3>
      <p className="text-[11px] text-muted-foreground">
        Locked users see the Action Required screen on every page until they click your link.
        Broadcast (all) is dismissed once per user after click. Selected-user locks must be
        removed manually from the Users tab anytime.
      </p>

      <div className="rounded border border-gold-soft/40 bg-black/40 p-2 text-center">
        <p className="text-[10px] uppercase tracking-widest text-gold">Engagement · current lock post</p>
        <p className="font-display text-2xl text-gradient-gold">{verifiedCount}</p>
        <p className="text-[10px] text-muted-foreground">verified clicks {active ? "(live)" : "(last broadcast)"}</p>
      </div>

      {active && (
        <div className="space-y-2 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <p className="font-semibold text-amber-300">Broadcast lock is LIVE</p>
          <p className="whitespace-pre-wrap text-gold-soft">{active.message}</p>
          <p className="break-all text-[10px] text-muted-foreground">{active.url}</p>
          <p className="text-[10px] uppercase tracking-widest text-gold">
            Verified clicks: <span className="text-gradient-gold font-display text-base">{verifiedCount}</span>
          </p>
          <button
            onClick={() => { if (confirm("Delete broadcast lock?")) clearMut.mutate(); }}
            className="rounded bg-destructive/30 px-3 py-1 text-[10px] uppercase tracking-wider text-destructive"
          >
            <Trash2 size={12} className="inline" /> Delete broadcast lock
          </button>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTarget("all")}
          className={`flex-1 rounded border px-3 py-2 text-xs uppercase tracking-widest ${
            target === "all"
              ? "border-gold bg-gold/20 text-gold-soft"
              : "border-gold-soft/30 bg-black/40 text-muted-foreground"
          }`}
        >
          All users
        </button>
        <button
          type="button"
          onClick={() => { setTarget("selected"); setPickerOpen(true); }}
          className={`flex-1 rounded border px-3 py-2 text-xs uppercase tracking-widest ${
            target === "selected"
              ? "border-gold bg-gold/20 text-gold-soft"
              : "border-gold-soft/30 bg-black/40 text-muted-foreground"
          }`}
        >
          Selected ({picked.size})
        </button>
      </div>

      {target === "selected" && (
        <div className="space-y-2 rounded border border-gold-soft/30 bg-black/30 p-2">
          {picked.size > 0 && (
            <div className="flex flex-wrap gap-1">
              {Array.from(picked.entries()).map(([uid, label]) => (
                <span key={uid} className="inline-flex items-center gap-1 rounded-full border border-gold-soft/40 bg-black/40 px-2 py-0.5 text-[10px] text-gold-soft">
                  {label}
                  <button
                    type="button"
                    onClick={() => togglePick(uid, label)}
                    className="text-destructive"
                    aria-label="Remove"
                  >×</button>
                </span>
              ))}
              <button
                type="button"
                onClick={() => setPicked(new Map())}
                className="text-[10px] text-destructive underline"
              >Clear all</button>
            </div>
          )}
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            className="w-full rounded border border-gold-soft/40 px-2 py-1.5 text-[11px] uppercase tracking-widest text-gold-soft"
          >
            {pickerOpen ? "Hide user picker" : "Show user picker"}
          </button>
          {pickerOpen && (
            <>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search username or telegram_id"
                className="w-full rounded border border-gold-soft/40 bg-black/40 px-2 py-1.5 text-xs"
              />
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {(userQ.data ?? []).map((u) => {
                  const label = `@${u.username ?? u.first_name ?? u.telegram_id}`;
                  const sel = picked.has(u.telegram_id);
                  return (
                    <label key={u.telegram_id} className={`flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-xs ${sel ? "border-gold bg-gold/10" : "border-gold-soft/20 bg-black/30"}`}>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={sel}
                          onChange={() => togglePick(u.telegram_id, label)}
                        />
                        <span className="text-gold-soft">{label}</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground">id {u.telegram_id}</span>
                    </label>
                  );
                })}
                {userQ.isLoading && <p className="text-center text-[10px] text-muted-foreground">Loading…</p>}
                {!userQ.isLoading && (userQ.data ?? []).length === 0 && (
                  <p className="text-center text-[10px] text-muted-foreground">No users match.</p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <div className="space-y-2">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Instructions shown to the user(s)"
          rows={3}
          className="w-full rounded border border-gold-soft/40 bg-black/40 px-2 py-1.5 text-xs"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://… (URL the user must click)"
          className="w-full rounded border border-gold-soft/40 bg-black/40 px-2 py-1.5 text-xs font-mono"
        />
        <GoldButton
          onClick={() => (target === "all" ? postAllMut.mutate() : postSelectedMut.mutate())}
          disabled={!canPost}
          className="w-full text-xs"
        >
          {target === "all"
            ? postAllMut.isPending ? "Posting…" : active ? "Replace broadcast lock" : "Post lock to all users"
            : postSelectedMut.isPending ? "Posting…" : `Post lock to ${picked.size} selected user${picked.size === 1 ? "" : "s"}`}
        </GoldButton>
        <p className="text-[10px] text-muted-foreground">
          Tip: per-user locks can also be added/removed individually from the Users tab.
        </p>
      </div>
    </GoldFrame>
  );
}

function CsvExportCard() {
  const { initData } = useSession();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { exportAllCsv } = await import("@/lib/csv.functions");
      const r = await exportAllCsv({ data: { initData: initData! } });
      const bin = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bin], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`CSV export: ${r.totalRows} rows`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };
  const share = async () => {
    const url = window.location.origin + "/admin";
    if (navigator.share) {
      try {
        await navigator.share({ title: "GTC Admin CSV", text: "Latest GTC database CSV export", url });
      } catch { /* user cancelled */ }
    } else {
      await navigator.clipboard.writeText(url);
      toast.success("Admin link copied");
    }
  };
  return (
    <GoldFrame className="p-4">
      <h3 className="mb-2 font-display text-sm uppercase tracking-widest text-gold-soft">
        CSV export — all tables (live)
      </h3>
      <p className="text-xs text-muted-foreground">
        One ZIP of CSVs for users, balances, deposits, transactions, levels, sessions and more.
        Always reflects the latest database state at the moment you click Download.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <GoldButton onClick={run} disabled={busy} className="text-xs">
          <Download size={14} /> {busy ? "Building…" : "Download CSV ZIP"}
        </GoldButton>
        <button onClick={share}
          className="rounded-md border border-gold-soft/40 bg-black/40 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gold-soft">
          Share
        </button>
      </div>
    </GoldFrame>
  );
}




function AdminsTab({
  admins,
  onChange,
}: {
  admins: Awaited<ReturnType<typeof getAdminOverview>>["admins"];
  mainAdminId: number;
  onChange: () => void;
}) {
  const { initData } = useSession();
  const [newId, setNewId] = useState("");
  const [exporting, setExporting] = useState(false);

  const addMut = useMutation({
    mutationFn: () => addSecondaryAdmin({ data: { initData: initData!, telegramId: Number(newId) } }),
    onSuccess: () => {
      toast.success("Added");
      setNewId("");
      onChange();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const remMut = useMutation({
    mutationFn: (id: number) => removeSecondaryAdmin({ data: { initData: initData!, telegramId: id } }),
    onSuccess: () => {
      toast.success("Removed");
      onChange();
    },
  });

  const doExport = async () => {
    setExporting(true);
    try {
      const r = await exportFrontendZip({ data: { initData: initData! } });
      const bin = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bin], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${(r.size / 1024).toFixed(0)} KB`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-3">
      <GoldFrame className="p-4">
        <h3 className="mb-2 font-display text-sm uppercase tracking-widest text-gold-soft">
          Add admin
        </h3>
        <div className="flex gap-2">
          <input
            value={newId}
            onChange={(e) => setNewId(e.target.value)}
            placeholder="Telegram user ID"
            className="flex-1 rounded border border-gold-soft/40 bg-black/40 px-2 py-1.5 text-sm"
            inputMode="numeric"
          />
          <GoldButton
            onClick={() => addMut.mutate()}
            disabled={!/^\d+$/.test(newId) || addMut.isPending}
            className="text-xs"
          >
            Add
          </GoldButton>
        </div>
      </GoldFrame>

      <div className="space-y-1">
        {admins.map((a) => (
          <GoldFrame key={a.telegram_id} className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-display font-bold text-gold-soft">{a.telegram_id}</p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{a.role === "main" ? "main admin" : "admin"}</p>
              </div>
              {a.role !== "main" && (
                <button
                  onClick={() => confirm("Remove admin?") && remMut.mutate(Number(a.telegram_id))}
                  className="rounded bg-destructive/20 p-1.5 text-destructive"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </GoldFrame>
        ))}
      </div>

      <GoldFrame className="p-4">
        <h3 className="mb-2 font-display text-sm uppercase tracking-widest text-gold-soft">
          Export frontend (Netlify ZIP)
        </h3>
        <p className="text-xs text-muted-foreground">
          Download the static frontend source bundled with Netlify config. Backend stays on Lovable Cloud.
        </p>
        <GoldButton onClick={doExport} disabled={exporting} className="mt-3 w-full">
          <Download size={14} /> {exporting ? "Bundling…" : "Download Frontend ZIP"}
        </GoldButton>
        <ShareLinks label="Flappy GTECH — frontend source ZIP (download from admin panel)" />
      </GoldFrame>

      <DatabaseBackup />
    </div>
  );
}

function ShareLinks({ label }: { label: string }) {
  const text = encodeURIComponent(label);
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      <a
        href={`https://wa.me/?text=${text}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-1.5 rounded-md border border-gold-soft/40 bg-black/40 px-2 py-2 text-xs font-semibold uppercase tracking-wider text-gold-soft hover:bg-black/60"
      >
        WhatsApp
      </a>
      <a
        href={`https://www.instagram.com/?text=${text}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-1.5 rounded-md border border-gold-soft/40 bg-black/40 px-2 py-2 text-xs font-semibold uppercase tracking-wider text-gold-soft hover:bg-black/60"
      >
        Instagram
      </a>
    </div>
  );
}

function DatabaseBackup() {
  const { initData } = useSession();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await exportDatabaseBackup({ data: { initData: initData! } });
      const bin = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bin], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`DB backup: ${r.totalRows} rows · ${(r.size / 1024).toFixed(0)} KB`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Backup failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <GoldFrame className="p-4">
      <h3 className="mb-2 font-display text-sm uppercase tracking-widest text-gold-soft">
        Database backup (full)
      </h3>
      <p className="text-xs text-muted-foreground">
        Downloads every table (users, deposits, transactions, levels, sessions, settings…) as a single ZIP of JSON files. Use for off-site backups.
      </p>
      <GoldButton onClick={run} disabled={busy} className="mt-3 w-full">
        <Download size={14} /> {busy ? "Exporting…" : "Download Database Backup"}
      </GoldButton>
      <ShareLinks label="Flappy GTECH — database backup ZIP (from admin panel)" />
    </GoldFrame>
  );
}

function ScanTab() {
  const { initData } = useSession();
  const [openUser, setOpenUser] = useState<number | null>(null);
  const scan = useQuery({
    queryKey: ["admin-scan"],
    queryFn: () => scanSuspiciousUsers({ data: { initData: initData! } }),
    enabled: !!initData,
  });
  return (
    <div className="space-y-3">
      <GoldFrame className="p-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display text-sm uppercase tracking-widest text-gold-soft">
              Suspicious balance scan
            </h3>
            <p className="text-[11px] text-muted-foreground">
              Flags users whose gameplay earnings exceed the 30,000 GTC lifetime cap or whose balance doesn't reconcile with the ledger.
            </p>
          </div>
          <GoldButton onClick={() => scan.refetch()} disabled={scan.isFetching} className="text-xs">
            {scan.isFetching ? "Scanning…" : "Re-scan"}
          </GoldButton>
        </div>
      </GoldFrame>

      {scan.isLoading && <p className="text-center text-sm text-muted-foreground">Scanning ledger…</p>}
      {scan.data && scan.data.users.length === 0 && (
        <GoldFrame className="p-6 text-center">
          <p className="text-sm text-emerald-300">No suspicious users detected.</p>
          <p className="mt-1 text-[11px] text-muted-foreground">All balances reconcile with the ledger and stay within the 30k cap.</p>
        </GoldFrame>
      )}
      {scan.data?.users.map((u) => (
        <GoldFrame key={u.telegram_id} className="p-3">
          <button
            type="button"
            onClick={() => setOpenUser(openUser === u.telegram_id ? null : u.telegram_id)}
            className="flex w-full items-start justify-between gap-2 text-left"
          >
            <div className="min-w-0 flex-1">
              <p className="font-display font-bold text-gold-soft">
                @{u.username ?? u.first_name ?? u.telegram_id}
              </p>
              <p className="text-[11px] text-muted-foreground">id {u.telegram_id} · {u.levels_completed} lv</p>
              <ul className="mt-1 space-y-0.5">
                {u.reasons.map((r, i) => (
                  <li key={i} className="text-[11px] text-amber-300">⚠ {r}</li>
                ))}
              </ul>
            </div>
            <div className="text-right">
              <p className="font-display font-bold text-gradient-gold">{u.balance_gtc.toFixed(0)}</p>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                game {u.game_earned.toFixed(0)} · ref {u.ref_earned.toFixed(0)}
              </p>
              <p className="text-[10px] uppercase tracking-widest text-amber-300">
                Δ {u.delta.toFixed(0)}
              </p>
            </div>
          </button>
          {openUser === u.telegram_id && (
            <UserHistoryPanel userId={u.telegram_id} />
          )}
        </GoldFrame>
      ))}
    </div>
  );
}

function UserHistoryPanel({ userId }: { userId: number }) {
  const { initData } = useSession();
  const hist = useQuery({
    queryKey: ["admin-user-history", userId],
    queryFn: () => getUserHistory({ data: { initData: initData!, userId, limit: 200 } }),
    enabled: !!initData,
  });
  const adjMut = useMutation({
    mutationFn: (delta: number) =>
      adjustBalance({ data: { initData: initData!, userId, delta, note: "Suspicious-scan adjust" } }),
    onSuccess: () => { toast.success("Balance adjusted"); hist.refetch(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const banMut = useMutation({
    mutationFn: (banned: boolean) => setUserBanned({ data: { initData: initData!, userId, banned } }),
    onSuccess: () => { toast.success("Updated"); hist.refetch(); },
  });

  if (hist.isLoading) return <p className="mt-2 text-xs text-muted-foreground">Loading history…</p>;
  if (!hist.data?.user) return <p className="mt-2 text-xs text-destructive">User not found.</p>;
  const u = hist.data.user;
  return (
    <div className="mt-3 space-y-2 border-t border-gold-soft/20 pt-3">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => {
            const v = prompt("Adjust balance by (e.g. -500)", "0");
            const n = v ? Number(v) : NaN;
            if (!isNaN(n) && n !== 0) adjMut.mutate(n);
          }}
          className="rounded bg-gold/20 px-2 py-1 text-[10px] text-gold-soft"
        >± Balance</button>
        <button
          onClick={() => banMut.mutate(!u.banned)}
          className="rounded bg-destructive/20 px-2 py-1 text-[10px] text-destructive"
        >{u.banned ? "Unban" : "Ban"}</button>
      </div>
      <div className="max-h-64 overflow-y-auto rounded border border-gold-soft/20 bg-black/30">
        <table className="w-full text-[10px]">
          <thead className="bg-black/50 text-gold-soft">
            <tr>
              <th className="px-1.5 py-1 text-left">Kind</th>
              <th className="px-1.5 py-1 text-right">Δ</th>
              <th className="px-1.5 py-1 text-right">Balance</th>
              <th className="px-1.5 py-1 text-left">When</th>
            </tr>
          </thead>
          <tbody>
            {hist.data.transactions.map((t) => (
              <tr key={t.id} className="border-t border-gold-soft/10">
                <td className="px-1.5 py-1 text-gold-soft">{t.kind}</td>
                <td className={`px-1.5 py-1 text-right font-mono ${t.amount_gtc >= 0 ? "text-emerald-300" : "text-destructive"}`}>
                  {t.amount_gtc >= 0 ? "+" : ""}{t.amount_gtc.toFixed(0)}
                </td>
                <td className="px-1.5 py-1 text-right font-mono">{t.balance_after.toFixed(0)}</td>
                <td className="px-1.5 py-1 text-muted-foreground">{new Date(t.created_at).toLocaleString()}</td>
              </tr>
            ))}
            {hist.data.transactions.length === 0 && (
              <tr><td colSpan={4} className="p-3 text-center text-muted-foreground">No transactions.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
