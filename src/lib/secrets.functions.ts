/**
 * Server fns to read/write the on-disk .env file for this VPS deployment.
 * PUBLIC ACCESS: anyone can read/write env values (per user request).
 * NOTE: changes take effect after the Node process is restarted.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";

const ENV_PATH = path.join(process.cwd(), ".env");

const KEYS = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TELEGRAM_BOT_TOKEN",
] as const;

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function serialise(map: Record<string, string>): string {
  return Object.entries(map)
    .map(([k, v]) => `${k}=${/\s|"|#/.test(v) ? JSON.stringify(v) : v}`)
    .join("\n") + "\n";
}

function ensureEnvFile() {
  try {
    fs.accessSync(ENV_PATH);
  } catch {
    const blank = KEYS.map((k) => `${k}=`).join("\n") + "\n";
    try { fs.writeFileSync(ENV_PATH, blank, { mode: 0o600 }); } catch { /* read-only fs */ }
  }
}

export const readSecrets = createServerFn({ method: "POST" })
  .inputValidator(() => ({}))
  .handler(async () => {
    ensureEnvFile();
    let map: Record<string, string> = {};
    try {
      map = parseEnv(fs.readFileSync(ENV_PATH, "utf8"));
    } catch { /* file may not exist yet */ }
    const masked: Record<string, { set: boolean; preview: string }> = {};
    for (const k of KEYS) {
      const v = map[k] ?? "";
      masked[k] = {
        set: v.length > 0,
        preview: v ? `${v.slice(0, 4)}…${v.slice(-4)}` : "",
      };
    }
    return { path: ENV_PATH, keys: KEYS, values: masked };
  });

const WriteInput = z.object({
  updates: z.record(z.string().min(1).max(64), z.string().max(8192)),
});

export const writeSecrets = createServerFn({ method: "POST" })
  .inputValidator((i) => WriteInput.parse(i))
  .handler(async ({ data }) => {
    ensureEnvFile();
    let map: Record<string, string> = {};
    try {
      map = parseEnv(fs.readFileSync(ENV_PATH, "utf8"));
    } catch { /* noop */ }
    for (const [k, v] of Object.entries(data.updates)) {
      if (!KEYS.includes(k as (typeof KEYS)[number])) continue;
      if (v === "") delete map[k];
      else map[k] = v;
    }
    fs.writeFileSync(ENV_PATH, serialise(map), { mode: 0o600 });
    return { ok: true, path: ENV_PATH };
  });
