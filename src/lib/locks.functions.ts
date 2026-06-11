/**
 * Per-user lockout-notify.
 *
 * Stored in the existing `settings` table under key `lock_user_<telegram_id>`
 * as JSON `{ message, url, created_at, dismissed_at|null }`. This avoids
 * needing a new table while giving us a single source of truth.
 *
 * Active lock = row exists AND dismissed_at is null. Once a user clicks the
 * provided URL, dismissMyLock() sets dismissed_at — the bot becomes usable
 * again and the same lock will never re-trigger. Admins can remove the row
 * entirely (adminUnlockUser) to reset the slot.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireUser, requireAdmin, logAdminAction } from "@/lib/auth-helpers.server";

const InitOnly = z.object({ initData: z.string().min(1).max(16384) });

export type LockPayload = {
  message: string;
  url: string;
  created_at: string;
  dismissed_at: string | null;
};

const lockKey = (uid: number) => `lock_user_${uid}`;

export async function readLockForUser(uid: number): Promise<LockPayload | null> {
  const { data } = await supabaseAdmin
    .from("settings")
    .select("value")
    .eq("key", lockKey(uid))
    .maybeSingle();
  const v = data?.value as unknown as LockPayload | null;
  if (!v || typeof v !== "object") return null;
  return v;
}

export const getMyLock = createServerFn({ method: "POST" })
  .inputValidator((input) => InitOnly.parse(input))
  .handler(async ({ data }) => {
    const { user } = await requireUser(data.initData);
    const lock = await readLockForUser(user.telegram_id);
    if (!lock || lock.dismissed_at) return { lock: null };
    return { lock: { message: lock.message, url: lock.url } };
  });

export const dismissMyLock = createServerFn({ method: "POST" })
  .inputValidator((input) => InitOnly.parse(input))
  .handler(async ({ data }) => {
    const { user } = await requireUser(data.initData);
    const lock = await readLockForUser(user.telegram_id);
    if (!lock || lock.dismissed_at) return { ok: true };
    const updated: LockPayload = { ...lock, dismissed_at: new Date().toISOString() };
    await supabaseAdmin
      .from("settings")
      .upsert({ key: lockKey(user.telegram_id), value: updated as never }, { onConflict: "key" });
    return { ok: true };
  });

const AdminLockInput = z.object({
  initData: z.string().min(1).max(16384),
  userId: z.number().int(),
  message: z.string().min(1).max(800),
  url: z.string().url().max(800),
});

export const adminLockUser = createServerFn({ method: "POST" })
  .inputValidator((input) => AdminLockInput.parse(input))
  .handler(async ({ data }) => {
    const { user: adminUser } = await requireAdmin(data.initData);
    const payload: LockPayload = {
      message: data.message,
      url: data.url,
      created_at: new Date().toISOString(),
      dismissed_at: null,
    };
    await supabaseAdmin
      .from("settings")
      .upsert({ key: lockKey(data.userId), value: payload as never }, { onConflict: "key" });
    await logAdminAction(adminUser.telegram_id, "lock_user", String(data.userId), { url: data.url });
    return { ok: true };
  });

const AdminLockManyInput = z.object({
  initData: z.string().min(1).max(16384),
  userIds: z.array(z.number().int()).min(1).max(5000),
  message: z.string().min(1).max(800),
  url: z.string().url().max(800),
});

/** Lock a hand-picked group of users with the same notice. */
export const adminLockUsers = createServerFn({ method: "POST" })
  .inputValidator((input) => AdminLockManyInput.parse(input))
  .handler(async ({ data }) => {
    const { user: adminUser } = await requireAdmin(data.initData);
    const now = new Date().toISOString();
    const rows = data.userIds.map((uid) => ({
      key: lockKey(uid),
      value: { message: data.message, url: data.url, created_at: now, dismissed_at: null } as never,
    }));
    // Upsert in chunks to stay safely within request size limits.
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await supabaseAdmin
        .from("settings")
        .upsert(rows.slice(i, i + CHUNK), { onConflict: "key" });
    }
    await logAdminAction(adminUser.telegram_id, "lock_users_bulk", null, {
      count: data.userIds.length,
      url: data.url,
    });
    return { ok: true, count: data.userIds.length };
  });

const AdminUnlockInput = z.object({
  initData: z.string().min(1).max(16384),
  userId: z.number().int(),
});
export const adminUnlockUser = createServerFn({ method: "POST" })
  .inputValidator((input) => AdminUnlockInput.parse(input))
  .handler(async ({ data }) => {
    const { user: adminUser } = await requireAdmin(data.initData);
    await supabaseAdmin.from("settings").delete().eq("key", lockKey(data.userId));
    await logAdminAction(adminUser.telegram_id, "unlock_user", String(data.userId), {});
    return { ok: true };
  });

const AdminStatusInput = z.object({
  initData: z.string().min(1).max(16384),
  userId: z.number().int(),
});
export const adminGetUserLock = createServerFn({ method: "POST" })
  .inputValidator((input) => AdminStatusInput.parse(input))
  .handler(async ({ data }) => {
    await requireAdmin(data.initData);
    const lock = await readLockForUser(data.userId);
    return { lock };
  });

// ─── Broadcast (all-user) lock ────────────────────────────────────────────
// Stored in `settings` under key `lock_broadcast` as
// { id, message, url, created_at }. Each user that clicks acknowledges via
// settings row `lock_bcast_ack_<telegram_id>` = { broadcast_id, dismissed_at }.
type BroadcastLock = { id: string; message: string; url: string; created_at: string };
const BCAST_KEY = "lock_broadcast";
const ackKey = (uid: number) => `lock_bcast_ack_${uid}`;

export async function readBroadcastLock(): Promise<BroadcastLock | null> {
  const { data } = await supabaseAdmin
    .from("settings")
    .select("value")
    .eq("key", BCAST_KEY)
    .maybeSingle();
  const v = data?.value as unknown as BroadcastLock | null;
  if (!v || typeof v !== "object" || !v.id) return null;
  return v;
}

export async function readBroadcastForUser(uid: number): Promise<{ message: string; url: string } | null> {
  const bcast = await readBroadcastLock();
  if (!bcast) return null;
  const { data } = await supabaseAdmin
    .from("settings")
    .select("value")
    .eq("key", ackKey(uid))
    .maybeSingle();
  const ack = data?.value as { broadcast_id?: string } | null;
  if (ack && ack.broadcast_id === bcast.id) return null;
  return { message: bcast.message, url: bcast.url };
}

export const dismissMyBroadcastLock = createServerFn({ method: "POST" })
  .inputValidator((input) => InitOnly.parse(input))
  .handler(async ({ data }) => {
    const { user } = await requireUser(data.initData);
    const bcast = await readBroadcastLock();
    if (!bcast) return { ok: true };
    await supabaseAdmin.from("settings").upsert(
      {
        key: ackKey(user.telegram_id),
        value: { broadcast_id: bcast.id, dismissed_at: new Date().toISOString() } as never,
      },
      { onConflict: "key" },
    );
    return { ok: true };
  });

const AdminBroadcastInput = z.object({
  initData: z.string().min(1).max(16384),
  message: z.string().min(1).max(800),
  url: z.string().url().max(800),
});
export const adminBroadcastLock = createServerFn({ method: "POST" })
  .inputValidator((input) => AdminBroadcastInput.parse(input))
  .handler(async ({ data }) => {
    const { user: adminUser } = await requireAdmin(data.initData);
    const payload: BroadcastLock = {
      id: crypto.randomUUID(),
      message: data.message,
      url: data.url,
      created_at: new Date().toISOString(),
    };
    await supabaseAdmin
      .from("settings")
      .upsert({ key: BCAST_KEY, value: payload as never }, { onConflict: "key" });
    await logAdminAction(adminUser.telegram_id, "broadcast_lock", null, { url: data.url });
    return { ok: true, id: payload.id };
  });

export const adminClearBroadcastLock = createServerFn({ method: "POST" })
  .inputValidator((input) => InitOnly.parse(input))
  .handler(async ({ data }) => {
    const { user: adminUser } = await requireAdmin(data.initData);
    await supabaseAdmin.from("settings").delete().eq("key", BCAST_KEY);
    await logAdminAction(adminUser.telegram_id, "broadcast_lock_clear", null, {});
    return { ok: true };
  });

export const adminBroadcastLockStats = createServerFn({ method: "POST" })
  .inputValidator((input) => InitOnly.parse(input))
  .handler(async ({ data }) => {
    await requireAdmin(data.initData);
    const bcast = await readBroadcastLock();
    if (!bcast) return { active: null, verifiedCount: 0 };
    const { data: rows } = await supabaseAdmin
      .from("settings")
      .select("value")
      .like("key", "lock_bcast_ack_%");
    let verifiedCount = 0;
    for (const r of rows ?? []) {
      const v = r.value as { broadcast_id?: string } | null;
      if (v && v.broadcast_id === bcast.id) verifiedCount += 1;
    }
    return { active: bcast, verifiedCount };
  });
