/**
 * Shared server-only auth helpers used by other server functions.
 * NEVER import from client code.
 *
 * Two auth modes:
 *   - Telegram WebApp initData (verified by HMAC against the bot token).
 *   - Browser web session token, sent as the string `web:<hex>`. The token
 *     is looked up in public.web_sessions (created by web-auth.functions.ts).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyInitData } from "@/lib/telegram.server";

const WEB_PREFIX = "web:";

async function resolveByWebToken(raw: string) {
  const token = raw.slice(WEB_PREFIX.length);
  if (!token) return null;
  // Cast: web_sessions not yet in generated types.
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
  const { data: row } = await sb
    .from("web_sessions")
    .select("user_id")
    .eq("token", token)
    .maybeSingle();
  if (!row) return null;
  await sb.from("web_sessions").update({ last_seen: new Date().toISOString() }).eq("token", token);
  return Number(row.user_id);
}

export async function requireUser(initData: string) {
  let tgId: number | null = null;

  if (initData.startsWith(WEB_PREFIX)) {
    tgId = await resolveByWebToken(initData);
    if (tgId == null) throw new Error("Web session expired. Please sign in again.");
  } else {
    const token = process.env.TELEGRAM_BOT_TOKEN || "8989647034:AAGGyGXPXyhb89PZxjc-pbet3G2b3tUQEvs";
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN not configured");
    const v = verifyInitData(initData, token);
    if (!v) throw new Error("Invalid Telegram authentication");
    tgId = v.user.id;
  }

  const { data: user } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("telegram_id", tgId)
    .single();
  if (!user) throw new Error("User not found");
  if (user.banned) throw new Error("Account banned");

  // Admin grant: telegram_id match OR phone match (when user has a phone).
  const { data: adminById } = await supabaseAdmin
    .from("admins")
    .select("role")
    .eq("telegram_id", tgId)
    .maybeSingle();

  let admin = adminById ? { role: adminById.role as "main" | "secondary" } : null;
  if (!admin && (user as { phone?: string | null }).phone) {
    const phone = (user as { phone?: string | null }).phone!;
    const sbAdmin = supabaseAdmin as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (col: string, v: unknown) => {
            maybeSingle: () => Promise<{ data: { role: string } | null }>;
          };
        };
      };
    };
    const { data: adminByPhone } = await sbAdmin
      .from("admins")
      .select("role")
      .eq("phone", phone)
      .maybeSingle();
    if (adminByPhone) admin = { role: adminByPhone.role as "main" | "secondary" };
  }

  return { user, admin };
}

export async function requireAdmin(initData: string, mainOnly = false) {
  const r = await requireUser(initData);
  if (!r.admin) throw new Error("Forbidden: admin only");
  if (mainOnly && r.admin.role !== "main") throw new Error("Forbidden: main admin only");
  return r;
}

export async function logAdminAction(
  adminId: number,
  action: string,
  target: string | null,
  details: Record<string, unknown> = {},
) {
  await supabaseAdmin.from("admin_logs").insert({
    admin_id: adminId,
    action,
    target,
    details: details as never,
  });
}
