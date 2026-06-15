/**
 * Admin server functions.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireAdmin, logAdminAction } from "@/lib/auth-helpers.server";
import { verifyTokenTransfer } from "@/lib/bscscan.server";
import { sendBotMessage } from "@/lib/telegram.server";

const InitOnly = z.object({ initData: z.string().min(1).max(16384) });

export const getAdminOverview = createServerFn({ method: "POST" })
  .inputValidator((input) => InitOnly.parse(input))
  .handler(async ({ data }) => {
    const { admin } = await requireAdmin(data.initData);

    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const [
      { count: totalUsers },
      { count: onlineUsers },
      { count: pendingDeposits },
      { data: recentDeposits },
      { data: settings },
      { data: announcements },
      { data: levels },
      { data: admins },
      { data: recentLogs },
    ] = await Promise.all([
      supabaseAdmin.from("users").select("*", { count: "exact", head: true }),
      supabaseAdmin
        .from("users")
        .select("*", { count: "exact", head: true })
        .gte("last_seen", fiveMinAgo),
      supabaseAdmin.from("deposits").select("*", { count: "exact", head: true }).eq("status", "pending"),
      supabaseAdmin
        .from("deposits")
        .select("*, users(username, first_name)")
        .order("created_at", { ascending: false })
        .limit(20),
      supabaseAdmin.from("settings").select("key, value"),
      supabaseAdmin.from("announcements").select("*").order("created_at", { ascending: false }),
      supabaseAdmin.from("levels").select("*").order("created_at", { ascending: false }),
      supabaseAdmin.from("admins").select("*"),
      // Only surface deposit-related and user-related admin actions in the dashboard.
      supabaseAdmin
        .from("admin_logs")
        .select("*")
        .or(
          [
            "action.ilike.%deposit%",
            "action.ilike.%user%",
            "action.ilike.%ban%",
            "action.ilike.%unban%",
            "action.ilike.%lock%",
            "action.ilike.%unlock%",
            "action.ilike.%adjust%",
          ].join(","),
        )
        .order("created_at", { ascending: false })
        .limit(20),
    ]);


    const settingsMap: Record<string, string | number | boolean | null> = {};
    (settings ?? []).forEach((s) => {
      settingsMap[s.key] = s.value as string | number | boolean | null;
    });

    return {
      role: admin!.role,
      stats: {
        totalUsers: totalUsers ?? 0,
        onlineUsers: onlineUsers ?? 0,
        pendingDeposits: pendingDeposits ?? 0,
      },
      deposits: (recentDeposits ?? []).map((d) => ({
        id: d.id,
        user_id: d.user_id,
        username: (d.users as { username: string | null } | null)?.username ?? null,
        first_name: (d.users as { first_name: string | null } | null)?.first_name ?? null,
        amount_gtc: Number(d.amount_gtc),
        amount_usdt: Number(d.amount_usdt),
        tx_hash: d.tx_hash,
        status: d.status,
        created_at: d.created_at,
      })),
      settings: settingsMap,
      announcements: (announcements ?? []).map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        active: a.active,
        created_at: a.created_at,
      })),
      levels: (levels ?? []).map((l) => ({
        id: l.id,
        name: l.name,
        duration_seconds: l.duration_seconds,
        enabled: l.enabled,
        weight: l.weight,
        repeat_loop: l.repeat_loop,
        pipe_gap: l.pipe_gap,
        reward_per_coin: Number(l.reward_per_coin),
      })),
      admins: (admins ?? []).map((a) => ({
        telegram_id: a.telegram_id,
        role: a.role,
        added_by: a.added_by,
      })),
      recentLogs: (recentLogs ?? []).map((l) => ({
        id: l.id,
        admin_id: l.admin_id,
        action: l.action,
        target: l.target,
        created_at: l.created_at,
      })),
    };
  });

/**
 * Company treasury / net-worth.
 * - GTC inflow:  approved deposits (paid via USDT), revive_spend (user paid), level_skip fee net.
 * - GTC outflow: game_reward (won), admin positive adjust.
 * Formula: any transaction that credits the user reduces treasury; any
 * transaction that debits the user adds to treasury. Deposits are special:
 * they credit the user AND credit the treasury (because the user paid USDT).
 */
export const getTreasury = createServerFn({ method: "POST" })
  .inputValidator((input) => InitOnly.parse(input))
  .handler(async ({ data }) => {
    await requireAdmin(data.initData);

    // Optional reset cutoff: only count events after this timestamp.
    const { data: resetRow } = await supabaseAdmin
      .from("settings")
      .select("value")
      .eq("key", "treasury_reset_at")
      .maybeSingle();
    const resetAt = resetRow?.value ? String(resetRow.value) : null;
    const sinceFilter = resetAt ? new Date(resetAt).toISOString() : null;

    let depQ = supabaseAdmin
      .from("deposits")
      .select("amount_usdt, amount_gtc, created_at")
      .eq("status", "approved");
    if (sinceFilter) depQ = depQ.gte("created_at", sinceFilter);

    let txQ = supabaseAdmin
      .from("transactions")
      .select("kind, amount_gtc, created_at")
      .in("kind", ["game_reward", "revive_spend", "level_skip", "admin_adjust", "deposit", "referral_bonus", "referral_share"]);
    if (sinceFilter) txQ = txQ.gte("created_at", sinceFilter);

    const [{ data: approvedDeposits }, { data: txs }, { data: users }] = await Promise.all([
      depQ,
      txQ,
      supabaseAdmin.from("users").select("balance_gtc"),
    ]);

    const totalUsdtIn = (approvedDeposits ?? []).reduce((s, d) => s + Number(d.amount_usdt), 0);
    const totalGtcIssued = (approvedDeposits ?? []).reduce((s, d) => s + Number(d.amount_gtc), 0);

    let inflow = totalGtcIssued;
    let outflow = 0;
    for (const t of txs ?? []) {
      if (t.kind === "deposit") continue;
      const a = Number(t.amount_gtc);
      if (a < 0) inflow += -a;
      else outflow += a;
    }
    const treasuryGtc = inflow - outflow;
    const userLiabilities = (users ?? []).reduce((s, u) => s + Number(u.balance_gtc), 0);

    const days = 30;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const buckets: { day: string; inflow: number; outflow: number; net: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86_400_000);
      const key = d.toISOString().slice(0, 10);
      buckets.push({ day: key.slice(5), inflow: 0, outflow: 0, net: 0 });
    }
    const byDay = new Map(buckets.map((b, i) => [b.day, i]));
    const bump = (createdAt: string, inflowDelta: number, outflowDelta: number) => {
      const k = new Date(createdAt).toISOString().slice(5, 10);
      const idx = byDay.get(k);
      if (idx == null) return;
      buckets[idx].inflow += inflowDelta;
      buckets[idx].outflow += outflowDelta;
      buckets[idx].net = buckets[idx].inflow - buckets[idx].outflow;
    };
    for (const d of approvedDeposits ?? []) bump(d.created_at, Number(d.amount_gtc), 0);
    for (const t of txs ?? []) {
      if (t.kind === "deposit") continue;
      const a = Number(t.amount_gtc);
      if (a < 0) bump(t.created_at, -a, 0);
      else bump(t.created_at, 0, a);
    }

    const hasActivity = inflow > 0 || outflow > 0;

    return {
      treasuryGtc,
      treasuryUsdt: totalUsdtIn,
      totalGtcIssued,
      userLiabilities,
      inflow,
      outflow,
      daily: buckets,
      hasActivity,
      resetAt,
    };
  });

export const resetTreasury = createServerFn({ method: "POST" })
  .inputValidator((input) => InitOnly.parse(input))
  .handler(async ({ data }) => {
    const { user: admin } = await requireAdmin(data.initData);
    const stamp = new Date().toISOString();
    await supabaseAdmin
      .from("settings")
      .upsert({
        key: "treasury_reset_at",
        value: stamp as never,
        updated_by: admin.telegram_id,
        updated_at: stamp,
      });
    await logAdminAction(admin.telegram_id, "reset_treasury", null, { resetAt: stamp });
    return { ok: true as const, resetAt: stamp };
  });

const FindTxnInput = z.object({
  initData: z.string().min(1).max(16384),
  q: z.string().min(3).max(128),
});

export const findTransaction = createServerFn({ method: "POST" })
  .inputValidator((input) => FindTxnInput.parse(input))
  .handler(async ({ data }) => {
    await requireAdmin(data.initData);
    const q = data.q.trim();
    const results: Array<{
      kind: "transaction" | "deposit";
      id: string;
      user_id: number;
      username: string | null;
      first_name: string | null;
      balance_gtc: number;
      amount: number;
      note: string | null;
      tx_hash: string | null;
      created_at: string;
    }> = [];

    // Look up by transactions.id (uuid) OR by deposits.id (uuid) OR by tx_hash.
    const isUuid = /^[0-9a-f-]{8,}$/i.test(q);
    if (isUuid) {
      const { data: txRow } = await supabaseAdmin
        .from("transactions")
        .select("*")
        .eq("id", q)
        .maybeSingle();
      if (txRow) {
        const { data: u } = await supabaseAdmin
          .from("users")
          .select("username, first_name, balance_gtc")
          .eq("telegram_id", txRow.user_id)
          .maybeSingle();
        results.push({
          kind: "transaction",
          id: txRow.id,
          user_id: Number(txRow.user_id),
          username: u?.username ?? null,
          first_name: u?.first_name ?? null,
          balance_gtc: Number(u?.balance_gtc ?? 0),
          amount: Number(txRow.amount_gtc),
          note: txRow.note ?? txRow.kind,
          tx_hash: null,
          created_at: txRow.created_at,
        });
      }
      const { data: depRow } = await supabaseAdmin
        .from("deposits")
        .select("*")
        .eq("id", q)
        .maybeSingle();
      if (depRow) {
        const { data: u } = await supabaseAdmin
          .from("users")
          .select("username, first_name, balance_gtc")
          .eq("telegram_id", depRow.user_id)
          .maybeSingle();
        results.push({
          kind: "deposit",
          id: depRow.id,
          user_id: Number(depRow.user_id),
          username: u?.username ?? null,
          first_name: u?.first_name ?? null,
          balance_gtc: Number(u?.balance_gtc ?? 0),
          amount: Number(depRow.amount_gtc),
          note: `${depRow.status} · $${Number(depRow.amount_usdt).toFixed(2)}`,
          tx_hash: depRow.tx_hash,
          created_at: depRow.created_at,
        });
      }
    }

    // Also try by deposit tx_hash (chain hash).
    const { data: depByHash } = await supabaseAdmin
      .from("deposits")
      .select("*")
      .eq("tx_hash", q)
      .maybeSingle();
    if (depByHash && !results.find((r) => r.id === depByHash.id)) {
      const { data: u } = await supabaseAdmin
        .from("users")
        .select("username, first_name, balance_gtc")
        .eq("telegram_id", depByHash.user_id)
        .maybeSingle();
      results.push({
        kind: "deposit",
        id: depByHash.id,
        user_id: Number(depByHash.user_id),
        username: u?.username ?? null,
        first_name: u?.first_name ?? null,
        balance_gtc: Number(u?.balance_gtc ?? 0),
        amount: Number(depByHash.amount_gtc),
        note: `${depByHash.status} · $${Number(depByHash.amount_usdt).toFixed(2)}`,
        tx_hash: depByHash.tx_hash,
        created_at: depByHash.created_at,
      });
    }

    return { results };
  });




const ListUsersInput = z.object({
  initData: z.string().min(1).max(16384),
  search: z.string().max(100).optional(),
});

export const listUsers = createServerFn({ method: "POST" })
  .inputValidator((input) => ListUsersInput.parse(input))
  .handler(async ({ data }) => {
    await requireAdmin(data.initData);
    let q = supabaseAdmin
      .from("users")
      .select("telegram_id, username, first_name, balance_gtc, banned, created_at")
      .order("balance_gtc", { ascending: false })
      .limit(200);
    if (data.search && data.search.trim()) {
      const s = data.search.trim();
      if (/^\d+$/.test(s)) q = q.eq("telegram_id", Number(s));
      else q = q.or(`username.ilike.%${s}%,first_name.ilike.%${s}%`);
    }
    const { data: rows } = await q;
    return (rows ?? []).map((r) => ({
      telegram_id: Number(r.telegram_id),
      username: r.username,
      first_name: r.first_name,
      balance_gtc: Number(r.balance_gtc),
      banned: !!r.banned,
      created_at: r.created_at,
    }));
  });

const ApproveDepositInput = z.object({
  initData: z.string().min(1).max(16384),
  depositId: z.string().uuid(),
});

export const approveDeposit = createServerFn({ method: "POST" })
  .inputValidator((input) => ApproveDepositInput.parse(input))
  .handler(async ({ data }) => {
    const { user: admin } = await requireAdmin(data.initData);

    const { data: dep } = await supabaseAdmin
      .from("deposits")
      .select("*")
      .eq("id", data.depositId)
      .single();
    if (!dep) throw new Error("Deposit not found");
    if (dep.status !== "pending") throw new Error("Deposit not pending");

    // Re-verify on chain
    const apiKey = process.env.BSCSCAN_API_KEY;
    let verification = { ok: false, reason: "no api key" } as { ok: boolean; reason?: string; amountToken?: number };
    if (apiKey) {
      const r = await verifyTokenTransfer(dep.tx_hash, apiKey);
      verification = r.ok
        ? { ok: true, amountToken: r.amountToken }
        : { ok: false, reason: r.reason };
    }

    // Use on-chain amount if available, else admin trusts the declared amount
    const credited = verification.ok && verification.amountToken ? verification.amountToken : Number(dep.amount_gtc);

    const { data: u } = await supabaseAdmin
      .from("users")
      .select("balance_gtc")
      .eq("telegram_id", dep.user_id)
      .single();
    const newBal = Number(u?.balance_gtc ?? 0) + credited;

    await supabaseAdmin
      .from("users")
      .update({ balance_gtc: newBal })
      .eq("telegram_id", dep.user_id);

    await supabaseAdmin
      .from("deposits")
      .update({
        status: "approved",
        amount_gtc: credited,
        reviewed_by: admin.telegram_id,
        reviewed_at: new Date().toISOString(),
        admin_note: verification.ok ? "Verified on-chain at approval" : `Manual approve: ${verification.reason}`,
      })
      .eq("id", dep.id);

    await supabaseAdmin.from("transactions").insert({
      user_id: dep.user_id,
      kind: "deposit",
      amount_gtc: credited,
      balance_after: newBal,
      ref_id: dep.id,
      note: `Approved by admin`,
    });

    await logAdminAction(admin.telegram_id, "approve_deposit", String(dep.id), {
      credited,
      tx_hash: dep.tx_hash,
    });

    // Notify user via bot
    const token = (process.env.TELEGRAM_BOT_TOKEN || "8989647034:AAGGyGXPXyhb89PZxjc-pbet3G2b3tUQEvs");
    if (token) {
      await sendBotMessage(
        Number(dep.user_id),
        `✅ <b>Deposit approved!</b>\n\n+${credited.toFixed(2)} GTC credited to your balance.\nNew balance: ${newBal.toFixed(2)} GTC`,
        token,
      );
    }

    return { ok: true as const, credited, newBalance: newBal };
  });

const RejectDepositInput = z.object({
  initData: z.string().min(1).max(16384),
  depositId: z.string().uuid(),
  reason: z.string().min(1).max(500),
});

export const rejectDeposit = createServerFn({ method: "POST" })
  .inputValidator((input) => RejectDepositInput.parse(input))
  .handler(async ({ data }) => {
    const { user: admin } = await requireAdmin(data.initData);
    const { data: dep } = await supabaseAdmin
      .from("deposits")
      .select("*")
      .eq("id", data.depositId)
      .single();
    if (!dep) throw new Error("Deposit not found");
    if (dep.status !== "pending") throw new Error("Deposit not pending");

    await supabaseAdmin
      .from("deposits")
      .update({
        status: "rejected",
        admin_note: data.reason,
        reviewed_by: admin.telegram_id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", dep.id);

    await logAdminAction(admin.telegram_id, "reject_deposit", String(dep.id), { reason: data.reason });

    // Log to transaction history so user sees the rejection status
    const { data: u } = await supabaseAdmin
      .from("users")
      .select("balance_gtc")
      .eq("telegram_id", dep.user_id)
      .single();
    const bal = Number(u?.balance_gtc ?? 0);
    await supabaseAdmin.from("transactions").insert({
      user_id: dep.user_id,
      kind: "admin_adjust",
      amount_gtc: 0,
      balance_after: bal,
      ref_id: dep.id,
      note: `Deposit rejected: ${data.reason}`,
    });

    const token = (process.env.TELEGRAM_BOT_TOKEN || "8989647034:AAGGyGXPXyhb89PZxjc-pbet3G2b3tUQEvs");
    if (token) {
      await sendBotMessage(
        Number(dep.user_id),
        `❌ <b>Deposit rejected</b>\n\nTX: <code>${dep.tx_hash.slice(0, 14)}…</code>\nReason: ${data.reason}`,
        token,
      );
    }

    return { ok: true as const };
  });

// Admin can ONLY edit prize (reward per coin) and timer (level duration).
// Admin-editable global settings.
const UpdateSettingsInput = z.object({
  initData: z.string().min(1).max(16384),
  level_duration_seconds: z.number().int().min(15).max(300).optional(),
  level_reward_per_coin: z.number().min(0).max(1000).optional(),
  level_win_prize_gtc: z.number().min(0).max(1_000_000).optional(),
  level_skip_fee_gtc: z.number().min(0).max(1_000_000).optional(),
  level_skip_prize_gtc: z.number().min(0).max(1_000_000).optional(),
  level_coin_bonus: z.number().int().min(0).max(100_000).optional(),
});

export const updateSettings = createServerFn({ method: "POST" })
  .inputValidator((input) => UpdateSettingsInput.parse(input))
  .handler(async ({ data }) => {
    const { user: admin } = await requireAdmin(data.initData);
    const updates: Array<{ key: string; value: unknown }> = [];
    const fields: Array<keyof typeof data> = [
      "level_duration_seconds",
      "level_reward_per_coin",
      "level_win_prize_gtc",
      "level_skip_fee_gtc",
      "level_skip_prize_gtc",
      "level_coin_bonus",
    ];
    for (const k of fields) {
      const v = data[k];
      if (typeof v === "number") updates.push({ key: k, value: v });
    }
    for (const u of updates) {
      await supabaseAdmin
        .from("settings")
        .upsert({ key: u.key, value: u.value as never, updated_by: admin.telegram_id, updated_at: new Date().toISOString() });
    }
    await logAdminAction(admin.telegram_id, "update_settings", null, { updates });
    return { ok: true };
  });

const SetLevelPrizeInput = z.object({
  initData: z.string().min(1).max(16384),
  levelIndex: z.number().int().min(1).max(1000),
  rewardPerCoin: z.number().min(0).max(10_000),
});

export const setLevelPrize = createServerFn({ method: "POST" })
  .inputValidator((input) => SetLevelPrizeInput.parse(input))
  .handler(async ({ data }) => {
    const { user: admin } = await requireAdmin(data.initData);
    const { data: row } = await supabaseAdmin
      .from("settings")
      .select("value")
      .eq("key", "level_prize_overrides")
      .maybeSingle();
    const current = ((row?.value ?? {}) as Record<string, number>) || {};
    current[String(data.levelIndex)] = data.rewardPerCoin;
    await supabaseAdmin
      .from("settings")
      .upsert({
        key: "level_prize_overrides",
        value: current as never,
        updated_by: admin.telegram_id,
        updated_at: new Date().toISOString(),
      });
    await logAdminAction(admin.telegram_id, "set_level_prize", String(data.levelIndex), {
      rewardPerCoin: data.rewardPerCoin,
    });
    return { ok: true };
  });

export const getLevelPrizes = createServerFn({ method: "POST" })
  .inputValidator((input) => InitOnly.parse(input))
  .handler(async ({ data }) => {
    await requireAdmin(data.initData);
    const { data: row } = await supabaseAdmin
      .from("settings")
      .select("value")
      .eq("key", "level_prize_overrides")
      .maybeSingle();
    return (row?.value ?? {}) as Record<string, number>;
  });



const AnnouncementInput = z.object({
  initData: z.string().min(1).max(16384),
  id: z.string().uuid().optional(),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
  active: z.boolean().default(true),
});

export const upsertAnnouncement = createServerFn({ method: "POST" })
  .inputValidator((input) => AnnouncementInput.parse(input))
  .handler(async ({ data }) => {
    const { user: admin } = await requireAdmin(data.initData);
    if (data.id) {
      await supabaseAdmin
        .from("announcements")
        .update({ title: data.title, body: data.body, active: data.active })
        .eq("id", data.id);
    } else {
      await supabaseAdmin.from("announcements").insert({
        title: data.title,
        body: data.body,
        active: data.active,
        created_by: admin.telegram_id,
      });
    }
    await logAdminAction(admin.telegram_id, "upsert_announcement", data.id ?? null, { title: data.title });
    return { ok: true };
  });

const DeleteAnnouncementInput = z.object({
  initData: z.string().min(1).max(16384),
  id: z.string().uuid(),
});

export const deleteAnnouncement = createServerFn({ method: "POST" })
  .inputValidator((input) => DeleteAnnouncementInput.parse(input))
  .handler(async ({ data }) => {
    const { user: admin } = await requireAdmin(data.initData);
    await supabaseAdmin.from("announcements").delete().eq("id", data.id);
    await logAdminAction(admin.telegram_id, "delete_announcement", data.id);
    return { ok: true };
  });

const AdjustBalanceInput = z.object({
  initData: z.string().min(1).max(16384),
  userId: z.number().int().positive(),
  delta: z.number().min(-1_000_000).max(1_000_000),
  note: z.string().max(500).default("Admin adjustment"),
});

export const adjustBalance = createServerFn({ method: "POST" })
  .inputValidator((input) => AdjustBalanceInput.parse(input))
  .handler(async ({ data }) => {
    const { user: admin } = await requireAdmin(data.initData);
    const { data: u } = await supabaseAdmin
      .from("users")
      .select("balance_gtc")
      .eq("telegram_id", data.userId)
      .single();
    if (!u) throw new Error("User not found");
    const newBal = Number(u.balance_gtc) + data.delta;
    await supabaseAdmin.from("users").update({ balance_gtc: newBal }).eq("telegram_id", data.userId);
    await supabaseAdmin.from("transactions").insert({
      user_id: data.userId,
      kind: "admin_adjust",
      amount_gtc: data.delta,
      balance_after: newBal,
      note: data.note,
    });
    await logAdminAction(admin.telegram_id, "adjust_balance", String(data.userId), { delta: data.delta, note: data.note });
    return { ok: true, newBalance: newBal };
  });

const BanInput = z.object({
  initData: z.string().min(1).max(16384),
  userId: z.number().int().positive(),
  banned: z.boolean(),
});

export const setUserBanned = createServerFn({ method: "POST" })
  .inputValidator((input) => BanInput.parse(input))
  .handler(async ({ data }) => {
    const { user: admin } = await requireAdmin(data.initData);
    await supabaseAdmin.from("users").update({ banned: data.banned }).eq("telegram_id", data.userId);
    await logAdminAction(admin.telegram_id, data.banned ? "ban_user" : "unban_user", String(data.userId));
    return { ok: true };
  });

// ===== Admin management (main admin only) =====
const AddAdminInput = z.object({
  initData: z.string().min(1).max(16384),
  telegramId: z.number().int().positive(),
});

export const addSecondaryAdmin = createServerFn({ method: "POST" })
  .inputValidator((input) => AddAdminInput.parse(input))
  .handler(async ({ data }) => {
    const { user: admin } = await requireAdmin(data.initData, true);
    // Added admins are 'secondary' so main admins can remove them.
    await supabaseAdmin
      .from("admins")
      .upsert({ telegram_id: data.telegramId, role: "secondary", added_by: admin.telegram_id });
    await logAdminAction(admin.telegram_id, "add_admin", String(data.telegramId));
    return { ok: true };
  });


const RemoveAdminInput = z.object({
  initData: z.string().min(1).max(16384),
  telegramId: z.number().int().positive(),
});

export const removeSecondaryAdmin = createServerFn({ method: "POST" })
  .inputValidator((input) => RemoveAdminInput.parse(input))
  .handler(async ({ data }) => {
    const { user: admin } = await requireAdmin(data.initData, true);
    await supabaseAdmin
      .from("admins")
      .delete()
      .eq("telegram_id", data.telegramId)
      .neq("telegram_id", admin.telegram_id);
    await logAdminAction(admin.telegram_id, "remove_admin", String(data.telegramId));
    return { ok: true };
  });

// ===== Deposit stats & listing per status =====

export const getDepositStats = createServerFn({ method: "POST" })
  .inputValidator((input) => InitOnly.parse(input))
  .handler(async ({ data }) => {
    await requireAdmin(data.initData);
    const statuses = ["pending", "rejected", "approved"] as const;
    const out: Record<string, { count: number; totalGtc: number; totalUsdt: number }> = {
      pending: { count: 0, totalGtc: 0, totalUsdt: 0 },
      rejected: { count: 0, totalGtc: 0, totalUsdt: 0 },
      approved: { count: 0, totalGtc: 0, totalUsdt: 0 },
      total: { count: 0, totalGtc: 0, totalUsdt: 0 },
    };
    for (const s of statuses) {
      const { data: rows } = await supabaseAdmin
        .from("deposits")
        .select("amount_gtc, amount_usdt")
        .eq("status", s);
      const r = rows ?? [];
      out[s] = {
        count: r.length,
        totalGtc: r.reduce((a, x) => a + Number(x.amount_gtc), 0),
        totalUsdt: r.reduce((a, x) => a + Number(x.amount_usdt), 0),
      };
      out.total.count += out[s].count;
      out.total.totalGtc += out[s].totalGtc;
      out.total.totalUsdt += out[s].totalUsdt;
    }
    return out;
  });

const ListDepositsInput = z.object({
  initData: z.string().min(1).max(16384),
  status: z.enum(["pending", "rejected", "approved", "all"]),
  search: z.string().max(128).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).max(10_000).default(0),
});

export const listDepositsByStatus = createServerFn({ method: "POST" })
  .inputValidator((input) => ListDepositsInput.parse(input))
  .handler(async ({ data }) => {
    await requireAdmin(data.initData);
    let q = supabaseAdmin
      .from("deposits")
      .select("*, users(username, first_name)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);
    if (data.status !== "all") q = q.eq("status", data.status);
    const s = data.search?.trim();
    if (s) {
      if (/^\d+$/.test(s)) q = q.eq("user_id", Number(s));
      else q = q.ilike("tx_hash", `%${s.toLowerCase()}%`);
    }
    const { data: rows, count } = await q;
    return {
      total: count ?? 0,
      deposits: (rows ?? []).map((d) => ({
        id: d.id,
        user_id: Number(d.user_id),
        username: (d.users as { username: string | null } | null)?.username ?? null,
        first_name: (d.users as { first_name: string | null } | null)?.first_name ?? null,
        amount_gtc: Number(d.amount_gtc),
        amount_usdt: Number(d.amount_usdt),
        tx_hash: d.tx_hash,
        status: d.status,
        admin_note: d.admin_note,
        created_at: d.created_at,
      })),
    };
  });

// ===== Suspicious balance scan =====
// Flags users whose gameplay earnings exceed the 30k lifetime cap, or whose
// balance can't be explained by deposits + capped gameplay + referrals.
const LIFETIME_GAME_CAP = 30_000;

export const scanSuspiciousUsers = createServerFn({ method: "POST" })
  .inputValidator((input) => InitOnly.parse(input))
  .handler(async ({ data }) => {
    await requireAdmin(data.initData);

    const { data: txs } = await supabaseAdmin
      .from("transactions")
      .select("user_id, kind, amount_gtc");

    type Agg = { game: number; ref: number; deposit: number; adjust: number; spend: number };
    const byUser = new Map<number, Agg>();
    for (const t of txs ?? []) {
      const uid = Number(t.user_id);
      const a = Number(t.amount_gtc);
      const row = byUser.get(uid) ?? { game: 0, ref: 0, deposit: 0, adjust: 0, spend: 0 };
      if (t.kind === "game_reward") row.game += a;
      else if (t.kind === "referral_bonus" || t.kind === "referral_share") row.ref += a;
      else if (t.kind === "deposit") row.deposit += a;
      else if (t.kind === "admin_adjust") row.adjust += a;
      else if (a < 0) row.spend += -a;
      byUser.set(uid, row);
    }

    const uids = Array.from(byUser.keys());
    if (uids.length === 0) return { users: [] };

    const { data: urows } = await supabaseAdmin
      .from("users")
      .select("telegram_id, username, first_name, balance_gtc, levels_completed")
      .in("telegram_id", uids);

    const flagged: Array<{
      telegram_id: number;
      username: string | null;
      first_name: string | null;
      balance_gtc: number;
      levels_completed: number;
      game_earned: number;
      ref_earned: number;
      deposit_total: number;
      adjust_total: number;
      expected_balance: number;
      delta: number;
      reasons: string[];
    }> = [];

    for (const u of urows ?? []) {
      const uid = Number(u.telegram_id);
      const agg = byUser.get(uid)!;
      const expected = agg.game + agg.ref + agg.deposit + agg.adjust - agg.spend;
      const bal = Number(u.balance_gtc);
      const delta = bal - expected;
      const reasons: string[] = [];
      if (agg.game > LIFETIME_GAME_CAP + 0.5) reasons.push(`game earnings ${agg.game.toFixed(0)} > 30k cap`);
      if (Math.abs(delta) > 1) reasons.push(`balance off by ${delta.toFixed(0)} vs ledger`);
      if (reasons.length > 0) {
        flagged.push({
          telegram_id: uid,
          username: u.username,
          first_name: u.first_name,
          balance_gtc: bal,
          levels_completed: Number(u.levels_completed ?? 0),
          game_earned: agg.game,
          ref_earned: agg.ref,
          deposit_total: agg.deposit,
          adjust_total: agg.adjust,
          expected_balance: expected,
          delta,
          reasons,
        });
      }
    }

    flagged.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    return { users: flagged };
  });

const HistoryInput = z.object({
  initData: z.string().min(1).max(16384),
  userId: z.number().int().positive(),
  limit: z.number().int().min(1).max(500).default(200),
});

export const getUserHistory = createServerFn({ method: "POST" })
  .inputValidator((input) => HistoryInput.parse(input))
  .handler(async ({ data }) => {
    await requireAdmin(data.initData);
    const [{ data: user }, { data: txs }] = await Promise.all([
      supabaseAdmin
        .from("users")
        .select("telegram_id, username, first_name, balance_gtc, levels_completed, banned, created_at")
        .eq("telegram_id", data.userId)
        .maybeSingle(),
      supabaseAdmin
        .from("transactions")
        .select("id, kind, amount_gtc, balance_after, note, created_at")
        .eq("user_id", data.userId)
        .order("created_at", { ascending: false })
        .limit(data.limit),
    ]);
    return {
      user: user
        ? {
            telegram_id: Number(user.telegram_id),
            username: user.username,
            first_name: user.first_name,
            balance_gtc: Number(user.balance_gtc),
            levels_completed: Number(user.levels_completed ?? 0),
            banned: !!user.banned,
            created_at: user.created_at,
          }
        : null,
      transactions: (txs ?? []).map((t) => ({
        id: t.id,
        kind: t.kind,
        amount_gtc: Number(t.amount_gtc),
        balance_after: Number(t.balance_after),
        note: t.note,
        created_at: t.created_at,
      })),
    };
  });
