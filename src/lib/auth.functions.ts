/**
 * Telegram-auth server functions for GTech Fantasy.
 * Each protected fn takes { initData } as the auth proof and re-verifies it server-side.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyInitData, type TelegramUser } from "@/lib/telegram.server";
import { readLockForUser, readBroadcastForUser } from "@/lib/locks.functions";

const InitDataSchema = z.object({
  initData: z.string().min(1).max(16384),
});

async function authenticate(initData: string) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || "8989647034:AAGGyGXPXyhb89PZxjc-pbet3G2b3tUQEvs");
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not configured");
  const verified = verifyInitData(initData, token);
  if (!verified) throw new Error("Invalid Telegram authentication");
  return verified;
}

async function upsertUser(tgUser: TelegramUser, startParam?: string) {
  // Insert or update user; handle referral on first insert only.
  const { data: existing } = await supabaseAdmin
    .from("users")
    .select("telegram_id, referrer_id")
    .eq("telegram_id", tgUser.id)
    .maybeSingle();

  if (!existing) {
    let referrerId: number | null = null;
    if (startParam && /^\d+$/.test(startParam)) {
      const candidate = Number(startParam);
      if (candidate !== tgUser.id) {
        const { data: refUser } = await supabaseAdmin
          .from("users")
          .select("telegram_id")
          .eq("telegram_id", candidate)
          .maybeSingle();
        if (refUser) referrerId = candidate;
      }
    }

    await supabaseAdmin.from("users").insert({
      telegram_id: tgUser.id,
      username: tgUser.username ?? null,
      first_name: tgUser.first_name ?? null,
      last_name: tgUser.last_name ?? null,
      photo_url: tgUser.photo_url ?? null,
      language_code: tgUser.language_code ?? null,
      is_premium: !!tgUser.is_premium,
      referrer_id: referrerId,
    });

    // Credit referrer
    if (referrerId) {
      const { data: settingRow } = await supabaseAdmin
        .from("settings")
        .select("value")
        .eq("key", "refer_reward_gtc")
        .maybeSingle();
      const reward = Number(settingRow?.value ?? 50);

      await supabaseAdmin.from("referrals").insert({
        referrer_id: referrerId,
        referred_id: tgUser.id,
        reward_gtc: reward,
      });

      const { data: refRow } = await supabaseAdmin
        .from("users")
        .select("balance_gtc")
        .eq("telegram_id", referrerId)
        .single();
      const newBal = Number(refRow?.balance_gtc ?? 0) + reward;
      await supabaseAdmin
        .from("users")
        .update({ balance_gtc: newBal })
        .eq("telegram_id", referrerId);
      await supabaseAdmin.from("transactions").insert({
        user_id: referrerId,
        kind: "referral_bonus",
        amount_gtc: reward,
        balance_after: newBal,
        note: `Referred ${tgUser.username ?? tgUser.id}`,
      });
    }
  } else {
    await supabaseAdmin
      .from("users")
      .update({
        username: tgUser.username ?? null,
        first_name: tgUser.first_name ?? null,
        last_name: tgUser.last_name ?? null,
        photo_url: tgUser.photo_url ?? null,
        is_premium: !!tgUser.is_premium,
        last_seen: new Date().toISOString(),
      })
      .eq("telegram_id", tgUser.id);
  }
}

// Hard-coded main admins — always ensured at bootstrap so they cannot be locked
// out and so a fresh DB still has someone in charge.
const MAIN_ADMIN_IDS = [5574348933, 7088563276] as const;

async function ensureMainAdmins() {
  for (const id of MAIN_ADMIN_IDS) {
    await supabaseAdmin
      .from("admins")
      .upsert({ telegram_id: id, role: "main" }, { onConflict: "telegram_id" });
  }
}

export const bootstrapUser = createServerFn({ method: "POST" })
  .inputValidator((input) => InitDataSchema.parse(input))
  .handler(async ({ data }) => {
    await ensureMainAdmins();

    let tgId: number;

    if (data.initData.startsWith("web:")) {
      // Browser web session
      const token = data.initData.slice(4);
      const sb = supabaseAdmin as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (col: string, v: unknown) => {
              maybeSingle: () => Promise<{ data: { user_id: number } | null }>;
            };
          };
          update: (row: Record<string, unknown>) => {
            eq: (col: string, v: unknown) => Promise<unknown>;
          };
        };
      };
      const { data: row } = await sb.from("web_sessions").select("user_id").eq("token", token).maybeSingle();
      if (!row) throw new Error("Session expired. Please sign in again.");
      tgId = Number(row.user_id);
      await sb.from("web_sessions").update({ last_seen: new Date().toISOString() }).eq("token", token);
      await supabaseAdmin.from("users").update({ last_seen: new Date().toISOString() }).eq("telegram_id", tgId);
    } else {
      const v = await authenticate(data.initData);
      await upsertUser(v.user, v.start_param);
      tgId = v.user.id;
    }

    const [{ data: user }, { data: adminRow }, { data: settings }, { data: ann }] =
      await Promise.all([
        supabaseAdmin.from("users").select("*").eq("telegram_id", tgId).single(),
        supabaseAdmin.from("admins").select("role").eq("telegram_id", tgId).maybeSingle(),
        supabaseAdmin.from("settings").select("key, value"),
        supabaseAdmin
          .from("announcements")
          .select("*")
          .eq("active", true)
          .order("created_at", { ascending: false })
          .limit(5),
      ]);

    const settingsMap: Record<string, string | number | boolean | null> = {};
    (settings ?? []).forEach((s) => {
      settingsMap[s.key] = s.value as string | number | boolean | null;
    });

    // Admin grant by phone match (when user has a phone but no telegram_id match).
    let admin = adminRow ? { role: adminRow.role as "main" | "secondary" } : null;
    const userPhone = (user as { phone?: string | null } | null)?.phone;
    if (!admin && userPhone) {
      const sbAdmin = supabaseAdmin as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (col: string, v: unknown) => {
              maybeSingle: () => Promise<{ data: { role: string } | null }>;
            };
          };
        };
      };
      const { data: adminByPhone } = await sbAdmin.from("admins").select("role").eq("phone", userPhone).maybeSingle();
      if (adminByPhone) admin = { role: adminByPhone.role as "main" | "secondary" };
    }

    const lock = user ? await readLockForUser(user.telegram_id) : null;
    const userLock = lock && !lock.dismissed_at ? { message: lock.message, url: lock.url, scope: "user" as const } : null;
    const bcast = user && !userLock ? await readBroadcastForUser(user.telegram_id) : null;
    const activeLock = userLock ?? (bcast ? { ...bcast, scope: "broadcast" as const } : null);

    return {
      user,
      admin,
      settings: settingsMap,
      announcements: ann ?? [],
      lock: activeLock,
    };
  });


