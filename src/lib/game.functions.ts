/**
 * Game server functions.
 *
 * Economy:
 *   - Plays are UNLIMITED and FREE — no per-day cap, no entry fee.
 *   - Each completed level pays a FLAT 200 GTC reward.
 *   - Milestone bonuses: +5000 GTC at level 50, +5000 GTC at level 100.
 *   - Revives are PER-GAME-SESSION:
 *       • 2 free revives per session (every new game restarts the count).
 *       • From the 3rd revive onward: 200, 400, 800, 1600 … GTC (×2 each time).
 *   - The 200 GTC base, free-revive count, and daily counters all reset at
 *     local midnight (kept for back-compat — UI shows the reset clock).
 *
 * Level timer:
 *   Fixed 60 seconds for EVERY level (1–100+). Applies to both Dev Trial
 *   previews and real Telegram players (same server function path).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireUser } from "@/lib/auth-helpers.server";
import { MAP_TEMPLATES } from "@/lib/maps.server";

const InitOnly = z.object({
  initData: z.string().min(1).max(16384),
  levelOverride: z.number().int().min(1).max(10000).optional(),
});

export type LevelObject = {
  id: string;
  obj_type:
    | "pipe"
    | "coin"
    | "bear"
    | "spike"
    | "spike_wall"
    | "poll"
    | "wall"
    | "block"
    | "gate"
    | "blade"
    | "hammer"
    | "laser"
    | "shooter";
  x_time: number;
  y: number;
  props: Record<string, number | string | boolean>;
};

const LEVEL_FLAT_REWARD_DEFAULT = 200;
const MILESTONE_BONUS = 5000;

function durationForLevel(_idx: number): number {
  // Fixed 60-second timer for every level (1–100+).
  return 60;
}

async function loadSettings() {
  const { data: rows } = await supabaseAdmin.from("settings").select("key, value");
  const map: Record<string, unknown> = {};
  (rows ?? []).forEach((r) => {
    map[r.key] = r.value;
  });
  return {
    enabled: map.game_enabled !== false,
    // Hard cap at 100 — players cannot play beyond the dev-built levels.
    cap: Math.min(100, Math.max(1, Number(map.level_cap ?? 100))),
    paidReviveBase: Math.max(0, Number(map.paid_revive_base_gtc ?? 200)),
    paidReviveMultiplier: Math.max(1, Number(map.paid_revive_multiplier ?? 2)),
    freeRevivesPerDay: 2,
    bonusRevivesPerWin: 0,
    levelWinPrizeGtc: Math.max(0, Number(map.level_win_prize_gtc ?? 200)),
    levelSkipFeeGtc: Math.max(0, Number(map.level_skip_fee_gtc ?? 500)),
    levelSkipPrizeGtc: Math.max(0, Number(map.level_skip_prize_gtc ?? 200)),
    // Admin-set: how many GTC each collected coin is worth. Default 1 GTC.
    coinValueGtc: Math.max(0, Number(map.level_reward_per_coin ?? 1)),
    // Auto-coins awarded per level completion (in addition to coins collected).
    levelCoinBonus: Math.max(0, Number(map.level_coin_bonus ?? 40)),
  };
}

/** Returns the calendar date in Dubai (UTC+4, no DST) as YYYY-MM-DD. */
function dubaiDateStr(d: Date = new Date()): string {
  const t = new Date(d.getTime() + 4 * 3600 * 1000);
  return t.toISOString().slice(0, 10);
}

/** Reset daily counters at Dubai 12:00 AM. bonus_free_revives PERSISTS. */
async function ensureDailyReset(userId: number, lastReset: string | null) {
  const today = dubaiDateStr();
  if (lastReset === today) return;
  await supabaseAdmin
    .from("users")
    .update({
      free_revives_used_today: 0,
      paid_revives_used_today: 0,
      free_plays_used_today: 0,
      paid_plays_used_today: 0,
      last_revive_reset_date: today,
    } as never)
    .eq("telegram_id", userId);
}

export const startGame = createServerFn({ method: "POST" })
  .inputValidator((input) => InitOnly.parse(input))
  .handler(async ({ data }) => {
    const { user, admin } = await requireUser(data.initData);
    const settings = await loadSettings();
    if (!settings.enabled) throw new Error("Game is currently disabled by admin.");

    const userAny = user as unknown as {
      current_level?: number;
      telegram_id: number;
      balance_gtc: number | null;
      last_revive_reset_date: string | null;
    };

    await ensureDailyReset(userAny.telegram_id, userAny.last_revive_reset_date);

    const isAdminTest = !!(data.levelOverride && admin);
    const requested = data.levelOverride && admin ? data.levelOverride : (userAny.current_level ?? 1);

    // Players can only play levels the dev team has built (1..cap, cap = 100).
    // Requests beyond the cap are clamped down to the highest available level
    // so nobody can play above 100 (those levels are not made yet).
    const levelIndex = Math.min(settings.cap, Math.max(1, requested));
    const duration = durationForLevel(levelIndex);

    // ─── Load the dev-admin custom level for this index ───────────────
    // Real players ONLY play levels created by the dev team in /dev.
    // There is no random/template fallback — if a level isn't built and
    // enabled in the backend, it simply can't be played yet.
    type CustomLvl = {
      id: string; name: string; gravity: number | string;
      jump_strength: number | string; scroll_speed: number | string;
      pipe_gap: number; bg_color: string | null; repeat_loop: boolean;
      reward_per_coin: number | string; enabled: boolean;
    };
    const customRes = await (supabaseAdmin.from("levels") as unknown as {
      select: (s: string) => { eq: (c: string, v: unknown) => { maybeSingle: () => Promise<{ data: CustomLvl | null }> } };
    })
      .select("id, name, gravity, jump_strength, scroll_speed, pipe_gap, bg_color, repeat_loop, reward_per_coin, enabled")
      .eq("level_index", levelIndex)
      .maybeSingle();
    const customLvl = customRes.data && customRes.data.enabled ? customRes.data : null;

    if (!customLvl) {
      throw new Error(
        `Level ${levelIndex} is being prepared by the dev team and isn't available yet. Please check back soon!`,
      );
    }

    const mapTemplateId = 0;
    let objects: LevelObject[];
    let levelMeta: {
      id: string; name: string; gravity: number; jump_strength: number;
      scroll_speed: number; pipe_gap: number; bg_color: string;
      repeat_loop: boolean; reward_per_coin: number;
    };

    {
      const { data: rawObjs } = await supabaseAdmin
        .from("level_objects")
        .select("*")
        .eq("level_id", customLvl.id)
        .order("x_time");
      const base = (rawObjs ?? []).map((o, i) => ({
        id: `cust_${customLvl.id}_${i}`,
        obj_type: o.obj_type as LevelObject["obj_type"],
        x_time: Number(o.x_time),
        y: Number(o.y),
        props: (o.props ?? {}) as Record<string, number | string | boolean>,
      }));
      // Auto-repeat: if the designed map doesn't fill the duration,
      // tile it across the full 60s window.
      const last = base.reduce((m, o) => Math.max(m, o.x_time), 0);
      const looped: LevelObject[] = [];
      if (customLvl.repeat_loop && base.length > 0 && last > 0 && last < duration) {
        const period = last + 1.5; // small breather between loops
        let offset = 0;
        let safety = 0;
        while (offset < duration && safety++ < 200) {
          base.forEach((o, i) => {
            const t = o.x_time + offset;
            if (t <= duration) {
              looped.push({ ...o, id: `cust_${customLvl.id}_l${safety}_${i}`, x_time: t });
            }
          });
          offset += period;
        }
        objects = looped;
      } else {
        objects = base;
      }

      levelMeta = {
        id: customLvl.id,
        name: customLvl.name,
        gravity: Number(customLvl.gravity),
        jump_strength: Number(customLvl.jump_strength),
        scroll_speed: Number(customLvl.scroll_speed),
        pipe_gap: customLvl.pipe_gap,
        bg_color: customLvl.bg_color ?? "#0a0a0a",
        repeat_loop: customLvl.repeat_loop,
        reward_per_coin: Number(customLvl.reward_per_coin),
      };
    }

    const insertRow = {
      user_id: userAny.telegram_id,
      level_id: customLvl ? customLvl.id : null,
      map_template_id: mapTemplateId,
      level_index: levelIndex,
      status: "in_progress",
      entry_fee_gtc: 0,
      revives_used: 0,
      paid_revives_used: 0,
    } as unknown as never;
    const { data: session, error: sessErr } = await supabaseAdmin
      .from("game_sessions")
      .insert(insertRow)
      .select()
      .single();

    if (sessErr || !session) {
      throw new Error("Could not start game — please try again.");
    }

    return {
      sessionId: (session as { id: string }).id,
      levelIndex,
      levelCap: settings.cap,
      mapTemplateId,
      balanceAfter: Number(userAny.balance_gtc ?? 0),
      playFee: 0,
      level: {
        id: levelMeta.id,
        name: levelMeta.name,
        duration_seconds: duration,
        gravity: levelMeta.gravity,
        jump_strength: levelMeta.jump_strength,
        scroll_speed: levelMeta.scroll_speed,
        pipe_gap: levelMeta.pipe_gap,
        bg_color: levelMeta.bg_color,
        repeat_loop: levelMeta.repeat_loop,
        reward_per_coin: levelMeta.reward_per_coin,
      },
      objects,
      adminTest: isAdminTest,
    };
  });

/** Server-validated revive endpoint (per-session).
 * - First 2 revives in a session are FREE.
 * - From the 3rd revive: cost = base × multiplier^(paidIndex). With defaults
 *   (base=200, mul=2) this gives 200 → 400 → 800 → 1600 …
 */
const ReviveInput = z.object({
  initData: z.string().min(1).max(16384),
  sessionId: z.string().uuid(),
});

export const reviveGame = createServerFn({ method: "POST" })
  .inputValidator((input) => ReviveInput.parse(input))
  .handler(async ({ data }) => {
    const { user } = await requireUser(data.initData);
    const settings = await loadSettings();
    const userAny = user as unknown as {
      telegram_id: number;
      balance_gtc: number | null;
      last_revive_reset_date: string | null;
    };
    await ensureDailyReset(userAny.telegram_id, userAny.last_revive_reset_date);

    // Re-read user after potential reset.
    const { data: freshUser } = await supabaseAdmin
      .from("users")
      .select("balance_gtc, free_revives_used_today, paid_revives_used_today, bonus_free_revives")
      .eq("telegram_id", userAny.telegram_id)
      .single();
    const u = freshUser as unknown as {
      balance_gtc: number;
      free_revives_used_today: number;
      paid_revives_used_today: number;
      bonus_free_revives: number;
    } | null;
    if (!u) throw new Error("User not found");

    const dailyLeft = Math.max(0, settings.freeRevivesPerDay - (u.free_revives_used_today ?? 0));
    const bonusLeft = Math.max(0, u.bonus_free_revives ?? 0);
    const paidUsed = u.paid_revives_used_today ?? 0;

    // Free path: consume daily first, then bonus.
    if (dailyLeft > 0) {
      await supabaseAdmin
        .from("users")
        .update({ free_revives_used_today: (u.free_revives_used_today ?? 0) + 1 } as never)
        .eq("telegram_id", userAny.telegram_id);
      await supabaseAdmin
        .from("game_sessions")
        .update({ revives_used: 0, status: "in_progress" } as never)
        .eq("id", data.sessionId);
      return {
        ok: true,
        kind: "free" as const,
        balance_gtc: Number(u.balance_gtc ?? 0),
        freeLeft: dailyLeft - 1 + bonusLeft,
        nextPaidCost: settings.paidReviveBase * Math.pow(settings.paidReviveMultiplier, paidUsed),
        charged: 0,
      };
    }
    if (bonusLeft > 0) {
      await supabaseAdmin
        .from("users")
        .update({ bonus_free_revives: bonusLeft - 1 } as never)
        .eq("telegram_id", userAny.telegram_id);
      await supabaseAdmin
        .from("game_sessions")
        .update({ status: "in_progress" } as never)
        .eq("id", data.sessionId);
      return {
        ok: true,
        kind: "bonus" as const,
        balance_gtc: Number(u.balance_gtc ?? 0),
        freeLeft: bonusLeft - 1,
        nextPaidCost: settings.paidReviveBase * Math.pow(settings.paidReviveMultiplier, paidUsed),
        charged: 0,
      };
    }

    // Paid revive — base 200 × 2^paidUsed (today). Resets at midnight.
    const cost = settings.paidReviveBase * Math.pow(settings.paidReviveMultiplier, paidUsed);
    const bal = Number(u.balance_gtc ?? 0);
    if (bal < cost) throw new Error(`Need ${cost} GTC to revive — you have ${bal.toFixed(0)}.`);
    const newBal = bal - cost;

    await supabaseAdmin
      .from("users")
      .update({
        balance_gtc: newBal,
        paid_revives_used_today: paidUsed + 1,
      } as never)
      .eq("telegram_id", userAny.telegram_id);
    await supabaseAdmin
      .from("game_sessions")
      .update({ status: "in_progress" } as never)
      .eq("id", data.sessionId);
    await supabaseAdmin.from("transactions").insert({
      user_id: userAny.telegram_id,
      kind: "revive_spend",
      amount_gtc: -cost,
      balance_after: newBal,
      ref_id: data.sessionId,
      note: `Paid revive #${paidUsed + 1} today`,
    } as never);

    return {
      ok: true,
      kind: "paid" as const,
      balance_gtc: newBal,
      freeLeft: 0,
      nextPaidCost: settings.paidReviveBase * Math.pow(settings.paidReviveMultiplier, paidUsed + 1),
      charged: cost,
    };
  });

/** Returns revive state for the user. */
const StatusInput = z.object({
  initData: z.string().min(1).max(16384),
  sessionId: z.string().uuid().optional(),
});
export const getReviveStatus = createServerFn({ method: "POST" })
  .inputValidator((input) => StatusInput.parse(input))
  .handler(async ({ data }) => {
    const { user } = await requireUser(data.initData);
    const settings = await loadSettings();
    const userAny = user as unknown as {
      telegram_id: number;
      last_revive_reset_date: string | null;
    };
    await ensureDailyReset(userAny.telegram_id, userAny.last_revive_reset_date);

    const { data: freshUser } = await supabaseAdmin
      .from("users")
      .select("balance_gtc, free_revives_used_today, paid_revives_used_today, bonus_free_revives")
      .eq("telegram_id", userAny.telegram_id)
      .single();
    const u = freshUser as unknown as {
      balance_gtc: number;
      free_revives_used_today: number;
      paid_revives_used_today: number;
      bonus_free_revives: number;
    } | null;

    const dailyLeft = Math.max(0, settings.freeRevivesPerDay - (u?.free_revives_used_today ?? 0));
    const bonusLeft = Math.max(0, u?.bonus_free_revives ?? 0);
    const paidUsed = u?.paid_revives_used_today ?? 0;

    return {
      freeLeft: dailyLeft + bonusLeft,
      nextPaidCost: settings.paidReviveBase * Math.pow(settings.paidReviveMultiplier, paidUsed),
      freePlaysLeft: 999,
      playFee: 0,
      nextPaidPlayCost: 0,
      balance_gtc: Number(u?.balance_gtc ?? 0),
    };

  });

const CompleteInput = z.object({
  initData: z.string().min(1).max(16384),
  sessionId: z.string().uuid(),
  coinsCollected: z.number().int().min(0).max(10000),
  completed: z.boolean(),
});

export const finishGame = createServerFn({ method: "POST" })
  .inputValidator((input) => CompleteInput.parse(input))
  .handler(async ({ data }) => {
    const { user } = await requireUser(data.initData);
    const settings = await loadSettings();

    const { data: session } = await supabaseAdmin
      .from("game_sessions")
      .select("*")
      .eq("id", data.sessionId)
      .eq("user_id", user.telegram_id)
      .maybeSingle();

    if (!session) throw new Error("Session not found");
    if (session.status !== "in_progress") {
      return { ok: false as const, message: "Session already finalized" };
    }

    if (!data.completed) {
      await supabaseAdmin
        .from("game_sessions")
        .update({
          status: "failed",
          coins_pending: data.coinsCollected,
          coins_credited: 0,
          ended_at: new Date().toISOString(),
        })
        .eq("id", data.sessionId);
      return {
        ok: true as const,
        completed: false,
        coinsCollected: data.coinsCollected,
        credited: 0,
        bonus: 0,
        newBalance: Number(user.balance_gtc),
        newLevel: (user as unknown as { current_level?: number }).current_level ?? 1,
        levelCap: settings.cap,
      };
    }

    const { data: latestRaw } = await supabaseAdmin
      .from("users")
      .select("balance_gtc, current_level, levels_completed, bonus_free_revives, referrer_id")
      .eq("telegram_id", user.telegram_id)
      .single();
    const latest = latestRaw as unknown as {
      balance_gtc: number | null;
      current_level?: number | null;
      levels_completed?: number | null;
      bonus_free_revives?: number | null;
      referrer_id?: number | null;
    } | null;

    const oldLevel = Number(
      latest?.current_level ?? (user as unknown as { current_level?: number }).current_level ?? 1,
    );
    const milestone = oldLevel === 50 || oldLevel === 100 ? MILESTONE_BONUS : 0;
    // ── HARD EARNINGS CAPS ─────────────────────────────────────────────
    // Players earn EXACTLY 200 GTC per level + milestone bonuses (5k at
    // level 50, 5k at level 100). Coins are cosmetic. Lifetime gameplay
    // earnings are capped at 30,000 GTC. Total lifetime earnings
    // (gameplay + referral) are capped at 100,000 GTC.
    const LIFETIME_GAME_CAP = 30000;
    const LIFETIME_TOTAL_CAP = 100000;
    const basePrize = LEVEL_FLAT_REWARD_DEFAULT;
    const totalCoins = data.coinsCollected + settings.levelCoinBonus;
    void settings.coinValueGtc; // retained for backward compat; coins are cosmetic
    let credited = basePrize + milestone;

    // Sum prior earnings.
    const { data: priorGame } = await supabaseAdmin
      .from("transactions")
      .select("amount_gtc")
      .eq("user_id", user.telegram_id)
      .eq("kind", "game_reward");
    const earnedSoFar = (priorGame ?? []).reduce((s, r) => s + Number(r.amount_gtc), 0);
    const remainingGameCap = Math.max(0, LIFETIME_GAME_CAP - earnedSoFar);
    if (credited > remainingGameCap) credited = remainingGameCap;

    // Total cap across game + referral earnings.
    const { data: priorAll } = await supabaseAdmin
      .from("transactions")
      .select("amount_gtc, kind")
      .eq("user_id", user.telegram_id)
      .in("kind", ["game_reward", "referral_share", "referral_bonus", "level_skip"]);
    const totalEarned = (priorAll ?? []).reduce((s, r) => s + Math.max(0, Number(r.amount_gtc)), 0);
    const remainingTotalCap = Math.max(0, LIFETIME_TOTAL_CAP - totalEarned);
    if (credited > remainingTotalCap) credited = remainingTotalCap;

    const newBal = Number(latest?.balance_gtc ?? 0) + credited;
    const newLevel = Math.min(settings.cap, oldLevel + 1);
    const completedCount = Number(latest?.levels_completed ?? 0) + 1;

    const newBonusRevives = Number(latest?.bonus_free_revives ?? 0) + settings.bonusRevivesPerWin;

    await supabaseAdmin
      .from("users")
      .update({
        balance_gtc: newBal,
        current_level: newLevel,
        levels_completed: completedCount,
        bonus_free_revives: newBonusRevives,
        last_played_date: new Date().toISOString().slice(0, 10),
      } as unknown as never)
      .eq("telegram_id", user.telegram_id);


    await supabaseAdmin
      .from("game_sessions")
      .update({
        status: "completed",
        coins_pending: 0,
        coins_credited: totalCoins,
        ended_at: new Date().toISOString(),
      })
      .eq("id", data.sessionId);

    const noteParts = [
      `Lv ${oldLevel} complete`,
      `base ${basePrize}`,
      `coins ${data.coinsCollected}+${settings.levelCoinBonus} (cosmetic)`,
    ];
    if (credited < basePrize + milestone) noteParts.push(`capped at 30k lifetime`);
    if (milestone > 0) noteParts.push(`milestone +${milestone}`);
    await supabaseAdmin.from("transactions").insert({
      user_id: user.telegram_id,
      kind: "game_reward",
      amount_gtc: credited,
      balance_after: newBal,
      ref_id: data.sessionId,
      note: noteParts.join(" • "),
    });

    // 5% referral payout to the user's referrer (if any) — also capped at 100k total.
    if (latest?.referrer_id) {
      let refShare = Math.round(credited * 0.05 * 100) / 100;
      const { data: refPrior } = await supabaseAdmin
        .from("transactions")
        .select("amount_gtc, kind")
        .eq("user_id", latest.referrer_id)
        .in("kind", ["game_reward", "referral_share", "referral_bonus", "level_skip"]);
      const refTotal = (refPrior ?? []).reduce(
        (s, r) => s + Math.max(0, Number(r.amount_gtc)),
        0,
      );
      const refRemaining = Math.max(0, 100000 - refTotal);
      if (refShare > refRemaining) refShare = refRemaining;
      if (refShare > 0) {
        const { data: refRow } = await supabaseAdmin
          .from("users")
          .select("balance_gtc")
          .eq("telegram_id", latest.referrer_id)
          .maybeSingle();
        if (refRow) {
          const refNewBal = Number(refRow.balance_gtc) + refShare;
          await supabaseAdmin
            .from("users")
            .update({ balance_gtc: refNewBal } as never)
            .eq("telegram_id", latest.referrer_id);
          await supabaseAdmin.from("transactions").insert({
            user_id: latest.referrer_id,
            kind: "referral_share",
            amount_gtc: refShare,
            balance_after: refNewBal,
            ref_id: data.sessionId,
            note: `5% from referee ${user.telegram_id} (Lv ${oldLevel})`,
          } as never);
          await supabaseAdmin.from("referrals").insert({
            referrer_id: latest.referrer_id,
            referred_id: user.telegram_id,
            reward_gtc: refShare,
          } as never);
        }
      }
    }


    return {
      ok: true as const,
      completed: true,
      coinsCollected: data.coinsCollected,
      credited,
      bonus: milestone,
      newBalance: newBal,
      newLevel,
      levelCap: settings.cap,
    };
  });

export const listMapTemplates = createServerFn({ method: "GET" }).handler(async () => {
  return MAP_TEMPLATES.map((m) => ({
    id: m.id,
    name: m.name,
    bg_color: m.bg_color,
    pipe_gap: m.pipe_gap,
    scroll_speed: m.scroll_speed,
  }));
});

/** Skip the current level by paying a fee; awards a smaller prize and advances. */
const SkipInput = z.object({ initData: z.string().min(1).max(16384) });

export const skipLevel = createServerFn({ method: "POST" })
  .inputValidator((input) => SkipInput.parse(input))
  .handler(async ({ data }) => {
    const { user } = await requireUser(data.initData);
    const settings = await loadSettings();
    if (!settings.enabled) throw new Error("Game is disabled.");

    const fee = settings.levelSkipFeeGtc;
    const prize = settings.levelSkipPrizeGtc;

    const { data: latestRaw } = await supabaseAdmin
      .from("users")
      .select("balance_gtc, current_level, levels_completed")
      .eq("telegram_id", user.telegram_id)
      .single();
    const latest = latestRaw as unknown as {
      balance_gtc: number;
      current_level: number;
      levels_completed: number;
    } | null;
    if (!latest) throw new Error("User not found");

    const bal = Number(latest.balance_gtc);
    if (bal < fee) throw new Error(`Need ${fee} GTC to skip (you have ${bal.toFixed(0)}).`);

    const oldLevel = Number(latest.current_level ?? 1);
    const newBal = bal - fee + prize;
    const newLevel = Math.min(settings.cap, oldLevel + 1);

    await supabaseAdmin
      .from("users")
      .update({
        balance_gtc: newBal,
        current_level: newLevel,
        levels_completed: Number(latest.levels_completed ?? 0) + 1,
      } as unknown as never)
      .eq("telegram_id", user.telegram_id);

    await supabaseAdmin.from("transactions").insert({
      user_id: user.telegram_id,
      kind: "level_skip",
      amount_gtc: prize - fee,
      balance_after: newBal,
      note: `Skipped Lv ${oldLevel} (fee ${fee}, prize ${prize})`,
    } as never);

    return { ok: true as const, fee, prize, newBalance: newBal, newLevel };
  });
