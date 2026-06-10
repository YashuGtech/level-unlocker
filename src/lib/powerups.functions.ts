/**
 * Power-up purchases run locally through our Supabase backend.
 * Replaces the external /api/powerups/purchase endpoint.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireUser } from "@/lib/auth-helpers.server";

const PurchaseInput = z.object({
  initData: z.string().min(1).max(16384),
  items: z.array(z.string().min(1).max(32)).min(1).max(8),
  cost_gtc: z.number().min(0).max(1_000_000),
});

export const purchasePowerups = createServerFn({ method: "POST" })
  .inputValidator((input) => PurchaseInput.parse(input))
  .handler(async ({ data }) => {
    const { user } = await requireUser(data.initData);
    const bal = Number(user.balance_gtc ?? 0);
    if (bal < data.cost_gtc) throw new Error(`Insufficient balance (need ${data.cost_gtc} GTC)`);
    const newBal = bal - data.cost_gtc;
    const { error: updErr } = await supabaseAdmin
      .from("users")
      .update({ balance_gtc: newBal })
      .eq("telegram_id", user.telegram_id);
    if (updErr) throw new Error(updErr.message);
    await supabaseAdmin.from("transactions").insert({
      user_id: user.telegram_id,
      kind: "powerup_spend",
      amount_gtc: -data.cost_gtc,
      balance_after: newBal,
      note: `powerups: ${data.items.join(",")}`,
    });
    return { ok: true, balance_gtc: newBal };
  });
