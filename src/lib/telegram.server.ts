/**
 * Telegram WebApp initData HMAC verification.
 * Server-only — never import from client code.
 * Spec: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
import { createHmac } from "crypto";

export type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
};

export type VerifiedInit = {
  user: TelegramUser;
  start_param?: string;
  auth_date: number;
};

export function verifyInitData(initData: string, botToken: string): VerifiedInit | null {
  if (!initData || !botToken) return null;

  let parsed: URLSearchParams;
  try {
    parsed = new URLSearchParams(initData);
  } catch {
    return null;
  }

  const hash = parsed.get("hash");
  if (!hash) return null;
  parsed.delete("hash");

  // Build data_check_string: alphabetically sorted "key=value" lines
  const entries: [string, string][] = [];
  parsed.forEach((value, key) => entries.push([key, value]));
  entries.sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computed = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (computed !== hash) return null;

  const userJson = parsed.get("user");
  if (!userJson) return null;

  let user: TelegramUser;
  try {
    user = JSON.parse(userJson) as TelegramUser;
  } catch {
    return null;
  }
  if (!user || typeof user.id !== "number") return null;

  const authDate = Number(parsed.get("auth_date") ?? 0);
  // Reject initData older than 24h
  if (!authDate || Date.now() / 1000 - authDate > 60 * 60 * 24) return null;

  return {
    user,
    start_param: parsed.get("start_param") ?? undefined,
    auth_date: authDate,
  };
}

/**
 * Send a message to a user via the Telegram bot.
 * Best-effort; logs and swallows errors.
 */
export async function sendBotMessage(
  chatId: number,
  text: string,
  botToken: string,
): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
  } catch (e) {
    console.error("sendBotMessage failed", e);
  }
}
