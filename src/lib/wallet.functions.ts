/**
 * Wallet & deposit server functions.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireUser } from "@/lib/auth-helpers.server";
import { sendBotMessage } from "@/lib/telegram.server";

const InitDataInput = z.object({ initData: z.string().min(1).max(16384) });

export const getWallet = createServerFn({ method: "POST" })
  .inputValidator((input) => InitDataInput.parse(input))
  .handler(async ({ data }) => {
    const { user } = await requireUser(data.initData);

    const [{ data: deposits }, { data: txs }, { data: settings }] = await Promise.all([
      supabaseAdmin
        .from("deposits")
        .select("*")
        .eq("user_id", user.telegram_id)
        .order("created_at", { ascending: false })
        .limit(20),
      supabaseAdmin
        .from("transactions")
        .select("*")
        .eq("user_id", user.telegram_id)
        .order("created_at", { ascending: false })
        .limit(20),
      supabaseAdmin
        .from("settings")
        .select("key, value")
        .in("key", ["gtc_usdt_rate", "deposit_address"]),
    ]);

    const settingsMap: Record<string, string | number> = {};
    (settings ?? []).forEach((s) => {
      settingsMap[s.key] = s.value as string | number;
    });

    return {
      balance_gtc: Number(user.balance_gtc),
      rate: Number(settingsMap.gtc_usdt_rate ?? 0.05),
      depositAddress: String(settingsMap.deposit_address ?? ""),
      deposits: (deposits ?? []).map((d) => ({
        id: d.id,
        amount_usdt: Number(d.amount_usdt),
        amount_gtc: Number(d.amount_gtc),
        tx_hash: d.tx_hash,
        status: d.status,
        created_at: d.created_at,
        admin_note: d.admin_note,
      })),
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

const SubmitDepositInput = z.object({
  initData: z.string().min(1).max(16384),
  txHash: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/, "Invalid transaction hash"),
  declaredAmountGtc: z.number().min(1000, "Minimum deposit is 1000 GTC").max(100_000_000),
  screenshotUrl: z.string().url().max(500).optional().nullable(),
});

export const submitDeposit = createServerFn({ method: "POST" })
  .inputValidator((input) => SubmitDepositInput.parse(input))
  .handler(async ({ data }) => {
    const { user } = await requireUser(data.initData);
    const txHash = data.txHash.toLowerCase();

    // Block if user already has a pending deposit
    const { data: pending } = await supabaseAdmin
      .from("deposits")
      .select("id")
      .eq("user_id", user.telegram_id)
      .eq("status", "pending")
      .limit(1)
      .maybeSingle();
    if (pending) {
      return {
        ok: false as const,
        message: "You already have a pending deposit. Please wait for admin review.",
      };
    }

    // Dedupe — block duplicate TX hashes
    const { data: existing } = await supabaseAdmin
      .from("deposits")
      .select("id")
      .eq("tx_hash", txHash)
      .maybeSingle();
    if (existing) {
      return { ok: false as const, message: "This transaction has already been submitted." };
    }

    // Pull current rate to compute GTC equivalent
    const { data: rateRow } = await supabaseAdmin
      .from("settings")
      .select("value")
      .eq("key", "gtc_usdt_rate")
      .single();
    const rate = Number(rateRow?.value ?? 0.05);
    const amountGtc = data.declaredAmountGtc;
    const amountUsdt = amountGtc * rate;

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("deposits")
      .insert({
        user_id: user.telegram_id,
        amount_usdt: amountUsdt,
        amount_gtc: amountGtc,
        tx_hash: txHash,
        screenshot_url: data.screenshotUrl ?? null,
        status: "pending",
      })
      .select()
      .single();
    if (insertErr) {
      return { ok: false as const, message: insertErr.message };
    }

    // Notify all admins via the bot
    const token = (process.env.TELEGRAM_BOT_TOKEN || "8989647034:AAGGyGXPXyhb89PZxjc-pbet3G2b3tUQEvs");
    if (token && inserted) {
      const { data: admins } = await supabaseAdmin.from("admins").select("telegram_id");
      const uname = user.username ? `@${user.username}` : user.first_name ?? `id ${user.telegram_id}`;
      const msg =
        `💰 <b>New deposit request</b>\n\n` +
        `From: ${uname} (<code>${user.telegram_id}</code>)\n` +
        `Amount: <b>${amountGtc.toFixed(2)} GTC</b> (~${amountUsdt.toFixed(2)} USDT)\n` +
        `TX: <code>${txHash}</code>`;
      await Promise.all(
        (admins ?? []).map((a) => sendBotMessage(Number(a.telegram_id), msg, token)),
      );
    }

    return {
      ok: true as const,
      autoApproved: false,
      message: "Deposit request submitted. Awaiting admin approval.",
    };
  });

