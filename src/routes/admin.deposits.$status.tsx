import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Check, Search, X, Clock, XCircle, CheckCircle2, Database } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { GoldFrame, GoldButton } from "@/components/gold-ui";
import { useSession } from "@/lib/session";
import { sfx } from "@/lib/sfx";
import {
  listDepositsByStatus,
  approveDeposit,
  rejectDeposit,
} from "@/lib/admin.functions";

type StatusParam = "pending" | "rejected" | "approved" | "all";

const META: Record<StatusParam, { label: string; Icon: typeof Clock; color: string }> = {
  pending: { label: "Pending Deposits", Icon: Clock, color: "text-gold" },
  rejected: { label: "Rejected Deposits", Icon: XCircle, color: "text-destructive" },
  approved: { label: "Approved Deposits", Icon: CheckCircle2, color: "text-success" },
  all: { label: "All Deposits", Icon: Database, color: "text-gold-soft" },
};

export const Route = createFileRoute("/admin/deposits/$status")({
  component: DepositsByStatusRoute,
});

function DepositsByStatusRoute() {
  return (
    <AppShell>
      <Page />
    </AppShell>
  );
}

function Page() {
  const { status } = Route.useParams();
  const navigate = useNavigate();
  const { admin, initData } = useSession();
  const s = (["pending", "rejected", "approved", "all"].includes(status) ? status : "pending") as StatusParam;
  const meta = META[s];
  const readInitial = () => {
    if (typeof window === "undefined") return "";
    try {
      const v = sessionStorage.getItem("admin-deposit-search") ?? "";
      if (v) sessionStorage.removeItem("admin-deposit-search");
      return v;
    } catch {
      return "";
    }
  };
  const [search, setSearch] = useState(readInitial);
  const [submitted, setSubmitted] = useState(search);

  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["admin-deposits", s, submitted],
    queryFn: () =>
      listDepositsByStatus({
        data: { initData: initData!, status: s, search: submitted || undefined, limit: 100, offset: 0 },
      }),
    enabled: !!initData && !!admin,
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => approveDeposit({ data: { initData: initData!, depositId: id } }),
    onSuccess: (r) => {
      sfx.win();
      toast.success(`Approved · +${r.credited.toFixed(2)} GTC`);
      qc.invalidateQueries({ queryKey: ["admin-deposits"] });
      qc.invalidateQueries({ queryKey: ["admin-deposit-stats"] });
      qc.invalidateQueries({ queryKey: ["admin-overview"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const [reasonId, setReasonId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const rejectMut = useMutation({
    mutationFn: (v: { id: string; reason: string }) =>
      rejectDeposit({ data: { initData: initData!, depositId: v.id, reason: v.reason } }),
    onSuccess: () => {
      sfx.coin();
      toast.success("Rejected");
      setReasonId(null);
      setReason("");
      qc.invalidateQueries({ queryKey: ["admin-deposits"] });
      qc.invalidateQueries({ queryKey: ["admin-deposit-stats"] });
      qc.invalidateQueries({ queryKey: ["admin-overview"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (!admin) {
    return (
      <div className="p-6">
        <GoldFrame className="p-6 text-center">
          <p className="text-sm text-muted-foreground">Admin only.</p>
        </GoldFrame>
      </div>
    );
  }

  const Icon = meta.Icon;

  return (
    <div className="space-y-4 p-4 pt-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate({ to: "/admin" })}
          className="rounded-md border border-gold-soft/40 p-1.5 text-gold-soft"
        >
          <ArrowLeft size={16} />
        </button>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-gold">Admin · Deposits</p>
          <h1 className={`font-display text-2xl ${meta.color} flex items-center gap-2`}>
            <Icon size={20} /> {meta.label}
          </h1>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {(["pending", "rejected", "approved", "all"] as StatusParam[]).map((k) => {
          const m = META[k];
          const I = m.Icon;
          const active = k === s;
          return (
            <Link
              key={k}
              to="/admin/deposits/$status"
              params={{ status: k }}
              className={`rounded-md border px-2 py-2 text-center text-[10px] uppercase tracking-wider ${active ? "border-gold-soft bg-gradient-gold-flat text-primary-foreground" : "border-gold-soft/30 text-muted-foreground"}`}
            >
              <I size={14} className="mx-auto" />
              {k}
            </Link>
          );
        })}
      </div>

      <GoldFrame className="p-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setSubmitted(search.trim())}
              placeholder="Search by UID (telegram id) or TX hash"
              className="w-full rounded-md border border-gold-soft/40 bg-black/40 px-8 py-2 text-sm font-mono"
            />
          </div>
          <GoldButton onClick={() => setSubmitted(search.trim())} className="text-xs">
            Search
          </GoldButton>
          {submitted && (
            <button
              onClick={() => {
                setSearch("");
                setSubmitted("");
              }}
              className="rounded-md border border-gold-soft/40 px-2 text-xs text-muted-foreground"
            >
              Clear
            </button>
          )}
        </div>
      </GoldFrame>

      {q.isLoading && <p className="text-center text-xs text-muted-foreground">Loading…</p>}
      {q.error && (
        <p className="text-center text-xs text-destructive">{(q.error as Error).message}</p>
      )}

      {q.data && (
        <p className="text-xs text-muted-foreground">
          {q.data.total} result{q.data.total === 1 ? "" : "s"}
        </p>
      )}

      <div className="space-y-2">
        {(q.data?.deposits ?? []).map((d) => (
          <GoldFrame key={d.id} className="p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="font-display font-bold text-gold-soft">
                  +{d.amount_gtc.toFixed(2)} GTC
                  <span className="ml-2 text-xs text-muted-foreground">${d.amount_usdt.toFixed(2)}</span>
                </p>
                <p className="text-[11px] text-muted-foreground">
                  @{d.username ?? d.first_name ?? d.user_id} · UID {d.user_id}
                </p>
                <a
                  href={`https://bscscan.com/tx/${d.tx_hash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate font-mono text-[10px] text-gold-soft/70 underline"
                >
                  {d.tx_hash}
                </a>
                <p className="text-[10px] uppercase tracking-wider">
                  <span
                    className={
                      d.status === "approved"
                        ? "text-success"
                        : d.status === "rejected"
                          ? "text-destructive"
                          : "text-gold"
                    }
                  >
                    {d.status}
                  </span>
                  <span className="ml-2 text-muted-foreground">
                    {new Date(d.created_at).toLocaleString()}
                  </span>
                </p>
                {d.admin_note && (
                  <p className="text-[11px] italic text-muted-foreground">Note: {d.admin_note}</p>
                )}
              </div>
              {d.status === "pending" && (
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => approveMut.mutate(d.id)}
                    className="rounded bg-success/20 px-2 py-1 text-success"
                    aria-label="Approve"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    onClick={() => setReasonId(d.id)}
                    className="rounded bg-destructive/20 px-2 py-1 text-destructive"
                    aria-label="Reject"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>
            {reasonId === d.id && (
              <div className="mt-2 space-y-2">
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason"
                  className="w-full rounded border border-gold-soft/40 bg-black/40 px-2 py-1 text-xs"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => rejectMut.mutate({ id: d.id, reason })}
                    disabled={!reason.trim()}
                    className="flex-1 rounded bg-destructive/30 px-2 py-1 text-xs"
                  >
                    Confirm reject
                  </button>
                  <button
                    onClick={() => setReasonId(null)}
                    className="flex-1 rounded bg-card px-2 py-1 text-xs"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </GoldFrame>
        ))}
        {q.data && q.data.deposits.length === 0 && (
          <p className="text-center text-xs text-muted-foreground">No deposits found.</p>
        )}
      </div>
    </div>
  );
}
