/**
 * Referral system — code = the referrer's Telegram username.
 * - A new user enters someone's username as a referral code.
 * - On first redemption they get +50 GTC (configurable).
 * - Each user can redeem ONE code, ever.
 * - 5% of the new user's future game winnings is also credited to the
 *   referrer (handled inside game.functions.ts → finishGame).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireUser } from "@/lib/auth-helpers.server";

const InitOnly = z.object({ initData: z.string().min(1).max(16384) });

export const getMyReferrals = createServerFn({ method: "POST" })
  .inputValidator((input) => InitOnly.parse(input))
  .handler(async ({ data }) => {
    const { user } = await requireUser(data.initData);

    const { data: refs } = await supabaseAdmin
      .from("referrals")
      .select("referred_id, reward_gtc, created_at")
      .eq("referrer_id", user.telegram_id)
      .order("created_at", { ascending: false })
      .limit(100);

    const ids = (refs ?? []).map((r) => Number(r.referred_id));
    const userMap = new Map<number, { username: string | null; first_name: string | null }>();
    if (ids.length) {
      const { data: users } = await supabaseAdmin
        .from("users")
        .select("telegram_id, username, first_name")
        .in("telegram_id", ids);
      (users ?? []).forEach((u) => {
        userMap.set(Number(u.telegram_id), {
          username: u.username,
          first_name: u.first_name,
        });
      });
    }

    const totalEarned = (refs ?? []).reduce((sum, r) => sum + Number(r.reward_gtc), 0);
    const userAny = user as unknown as { username: string | null; referrer_id: number | null; referral_code_redeemed_at: string | null };

    return {
      myCode: userAny.username ?? null,
      hasRedeemed: !!userAny.referral_code_redeemed_at || !!userAny.referrer_id,
      count: refs?.length ?? 0,
      totalEarned,
      referrals: (refs ?? []).map((r) => {
        const u = userMap.get(Number(r.referred_id));
        return {
          referred_id: Number(r.referred_id),
          username: u?.username ?? null,
          first_name: u?.first_name ?? null,
          reward_gtc: Number(r.reward_gtc),
          created_at: r.created_at,
        };
      }),
    };
  });

const RedeemInput = z.object({
  initData: z.string().min(1).max(16384),
  code: z.string().min(1).max(64),
});

export const redeemReferralCode = createServerFn({ method: "POST" })
  .inputValidator((input) => RedeemInput.parse(input))
  .handler(async ({ data }) => {
    const { user } = await requireUser(data.initData);
    const userAny = user as unknown as {
      telegram_id: number;
      username: string | null;
      balance_gtc: number;
      referrer_id: number | null;
      referral_code_redeemed_at: string | null;
    };

    if (userAny.referral_code_redeemed_at || userAny.referrer_id) {
      throw new Error("You have already redeemed a referral code.");
    }

    const code = data.code.trim().replace(/^@/, "");
    if (!code) throw new Error("Enter a valid code.");
    if (userAny.username && code.toLowerCase() === userAny.username.toLowerCase()) {
      throw new Error("You can't redeem your own code.");
    }

    // Look up referrer by username (case-insensitive).
    const { data: refRows } = await supabaseAdmin
      .from("users")
      .select("telegram_id, balance_gtc, username")
      .ilike("username", code)
      .limit(1);
    const referrer = (refRows ?? [])[0] as
      | { telegram_id: number; balance_gtc: number; username: string | null }
      | undefined;
    if (!referrer) throw new Error("Code not found.");
    if (Number(referrer.telegram_id) === Number(userAny.telegram_id)) {
      throw new Error("You can't redeem your own code.");
    }

    // Load reward amount from settings (default 50).
    const { data: rewardSetting } = await supabaseAdmin
      .from("settings")
      .select("value")
      .eq("key", "refer_reward_gtc")
      .maybeSingle();
    const reward = Math.max(0, Number(rewardSetting?.value ?? 50));

    const newBalUser = Number(userAny.balance_gtc ?? 0) + reward;

    // Credit referee (welcome bonus) and stamp redemption.
    await supabaseAdmin
      .from("users")
      .update({
        balance_gtc: newBalUser,
        referrer_id: referrer.telegram_id,
        referral_code_redeemed_at: new Date().toISOString(),
      } as never)
      .eq("telegram_id", userAny.telegram_id);

    await supabaseAdmin.from("transactions").insert({
      user_id: userAny.telegram_id,
      kind: "referral_bonus",
      amount_gtc: reward,
      balance_after: newBalUser,
      note: `Redeemed code @${referrer.username ?? referrer.telegram_id}`,
    } as never);

    // Credit referrer with the SAME 50 GTC bonus for bringing a friend.
    const newBalReferrer = Number(referrer.balance_gtc ?? 0) + reward;
    await supabaseAdmin
      .from("users")
      .update({ balance_gtc: newBalReferrer } as never)
      .eq("telegram_id", referrer.telegram_id);
    await supabaseAdmin.from("transactions").insert({
      user_id: referrer.telegram_id,
      kind: "referral_bonus",
      amount_gtc: reward,
      balance_after: newBalReferrer,
      note: `Friend @${userAny.username ?? userAny.telegram_id} joined with your code`,
    } as never);

    // Track in referrals table — record the one-shot reward; the ongoing
    // 5% commission on the friend's winnings is added by finishGame.
    await supabaseAdmin.from("referrals").insert({
      referrer_id: referrer.telegram_id,
      referred_id: userAny.telegram_id,
      reward_gtc: reward,
    } as never);

    return { ok: true as const, reward, newBalance: newBalUser, referrerUsername: referrer.username };
  });
