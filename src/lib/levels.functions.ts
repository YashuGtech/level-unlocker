/**
 * Level editor server functions (admin-only).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireAdmin, logAdminAction } from "@/lib/auth-helpers.server";

export const OBJ_TYPES = [
  "pipe", "coin", "bear", "spike", "spike_wall", "poll",
  "wall", "block", "gate", "blade", "hammer", "laser", "shooter",
] as const;

const ObjectSchema = z.object({
  obj_type: z.enum(OBJ_TYPES),
  x_time: z.number().min(0).max(3600),
  y: z.number().min(0).max(1),
  props: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});

const UpsertLevelInput = z.object({
  initData: z.string().min(1).max(16384),
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(100),
  duration_seconds: z.number().int().min(10).max(900),
  gravity: z.number().min(0.05).max(3),
  jump_strength: z.number().min(-20).max(-1),
  scroll_speed: z.number().min(0.5).max(10),
  pipe_gap: z.number().int().min(80).max(300),
  enabled: z.boolean(),
  weight: z.number().int().min(0).max(1000),
  repeat_loop: z.boolean(),
  reward_per_coin: z.number().min(0).max(1000),
  bg_color: z.string().min(1).max(20).default("#0a0a0a"),
  objects: z.array(ObjectSchema).max(2000),
});

export const upsertLevel = createServerFn({ method: "POST" })
  .inputValidator((input) => UpsertLevelInput.parse(input))
  .handler(async ({ data }) => {
    const { user: admin } = await requireAdmin(data.initData);

    let levelId = data.id;
    const payload = {
      name: data.name,
      duration_seconds: data.duration_seconds,
      gravity: data.gravity,
      jump_strength: data.jump_strength,
      scroll_speed: data.scroll_speed,
      pipe_gap: data.pipe_gap,
      enabled: data.enabled,
      weight: data.weight,
      repeat_loop: data.repeat_loop,
      reward_per_coin: data.reward_per_coin,
      bg_color: data.bg_color,
    };

    if (levelId) {
      await supabaseAdmin.from("levels").update(payload).eq("id", levelId);
      await supabaseAdmin.from("level_objects").delete().eq("level_id", levelId);
    } else {
      const { data: created } = await supabaseAdmin
        .from("levels")
        .insert({ ...payload, created_by: admin.telegram_id })
        .select("id")
        .single();
      levelId = created!.id;
    }

    if (data.objects.length > 0) {
      const rows = data.objects.map((o) => ({
        level_id: levelId!,
        obj_type: o.obj_type,
        x_time: o.x_time,
        y: o.y,
        props: o.props as never,
      }));
      await supabaseAdmin.from("level_objects").insert(rows);
    }

    await logAdminAction(admin.telegram_id, data.id ? "update_level" : "create_level", levelId ?? null, {
      name: data.name,
      objects: data.objects.length,
    });
    return { ok: true, id: levelId };
  });

const GetLevelInput = z.object({
  initData: z.string().min(1).max(16384),
  id: z.string().uuid(),
});

export const getLevel = createServerFn({ method: "POST" })
  .inputValidator((input) => GetLevelInput.parse(input))
  .handler(async ({ data }) => {
    await requireAdmin(data.initData);
    const { data: lv } = await supabaseAdmin.from("levels").select("*").eq("id", data.id).single();
    const { data: objs } = await supabaseAdmin
      .from("level_objects")
      .select("*")
      .eq("level_id", data.id)
      .order("x_time");
    return {
      level: {
        id: lv!.id,
        name: lv!.name,
        duration_seconds: lv!.duration_seconds,
        gravity: Number(lv!.gravity),
        jump_strength: Number(lv!.jump_strength),
        scroll_speed: Number(lv!.scroll_speed),
        pipe_gap: lv!.pipe_gap,
        enabled: lv!.enabled,
        weight: lv!.weight,
        repeat_loop: lv!.repeat_loop,
        reward_per_coin: Number(lv!.reward_per_coin),
        bg_color: lv!.bg_color ?? "#0a0a0a",
      },
      objects: (objs ?? []).map((o) => ({
        id: o.id,
        obj_type: o.obj_type as (typeof OBJ_TYPES)[number],
        x_time: Number(o.x_time),
        y: Number(o.y),
        props: (o.props ?? {}) as Record<string, string | number | boolean>,
      })),
    };
  });

const DeleteLevelInput = z.object({
  initData: z.string().min(1).max(16384),
  id: z.string().uuid(),
});

export const deleteLevel = createServerFn({ method: "POST" })
  .inputValidator((input) => DeleteLevelInput.parse(input))
  .handler(async ({ data }) => {
    const { user: admin } = await requireAdmin(data.initData);
    await supabaseAdmin.from("levels").delete().eq("id", data.id);
    await logAdminAction(admin.telegram_id, "delete_level", data.id);
    return { ok: true };
  });

// ─── Dev/Admin browser editor (password-gated, no Telegram) ────────────
const DEV_PASSWORD_FALLBACK = "7207";
function checkDevPassword(p: string) {
  const expected = process.env.DEV_ADMIN_PASSWORD || DEV_PASSWORD_FALLBACK;
  if (p !== expected) throw new Error("Invalid dev password");
}

const DevUpsertInput = z.object({
  password: z.string().min(1).max(64),
  level_index: z.number().int().min(1).max(1000),
  name: z.string().min(1).max(100).default(""),
  duration_seconds: z.number().int().min(10).max(900).default(60),
  gravity: z.number().min(0.05).max(3).default(0.45),
  jump_strength: z.number().min(-20).max(-1).default(-7.5),
  scroll_speed: z.number().min(0.5).max(10).default(2.5),
  pipe_gap: z.number().int().min(80).max(300).default(170),
  enabled: z.boolean().default(true),
  weight: z.number().int().min(0).max(1000).default(10),
  repeat_loop: z.boolean().default(true),
  reward_per_coin: z.number().min(0).max(1000).default(1),
  bg_color: z.string().min(1).max(20).default("#0a0a0a"),
  objects: z.array(ObjectSchema).max(2000),
});

/** Upsert a level by its player-facing index (1..100). Browser-only auth. */
export const devUpsertLevelByIndex = createServerFn({ method: "POST" })
  .inputValidator((input) => DevUpsertInput.parse(input))
  .handler(async ({ data }) => {
    checkDevPassword(data.password);
    const name = data.name || `Lv ${data.level_index} · Dev`;

    // Auto-enable repeat_loop when the designed map is shorter than the
    // level duration so real players see a continuous 60s run.
    const lastT = data.objects.reduce((m, o) => Math.max(m, o.x_time), 0);
    const repeat = data.repeat_loop || lastT < data.duration_seconds - 1;

    const payload = {
      level_index: data.level_index,
      name,
      duration_seconds: data.duration_seconds,
      gravity: data.gravity,
      jump_strength: data.jump_strength,
      scroll_speed: data.scroll_speed,
      pipe_gap: data.pipe_gap,
      enabled: data.enabled,
      weight: data.weight,
      repeat_loop: repeat,
      reward_per_coin: data.reward_per_coin,
      bg_color: data.bg_color,
    };

    // `level_index` is added by the dev-admin migration; the generated
    // Database types may be stale until it runs, so we cast through any.
    const levelsTbl = supabaseAdmin.from("levels") as unknown as {
      select: (s: string) => {
        eq: (c: string, v: unknown) => { maybeSingle: () => Promise<{ data: { id: string } | null }> };
      };
      update: (p: Record<string, unknown>) => { eq: (c: string, v: unknown) => Promise<unknown> };
      insert: (p: Record<string, unknown>) => {
        select: (s: string) => { single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }> };
      };
    };

    const { data: existing } = await levelsTbl
      .select("id")
      .eq("level_index", data.level_index)
      .maybeSingle();

    let levelId: string;
    if (existing?.id) {
      levelId = existing.id;
      await levelsTbl.update(payload as unknown as Record<string, unknown>).eq("id", levelId);
      await supabaseAdmin.from("level_objects").delete().eq("level_id", levelId);
    } else {
      const { data: created, error } = await levelsTbl
        .insert({ ...payload, created_by: 0 } as unknown as Record<string, unknown>)
        .select("id")
        .single();
      if (error || !created) throw new Error(error?.message || "Failed to create level");
      levelId = created.id;
    }

    if (data.objects.length > 0) {
      const rows = data.objects.map((o) => ({
        level_id: levelId,
        obj_type: o.obj_type,
        x_time: o.x_time,
        y: o.y,
        props: o.props as never,
      }));
      const { error } = await supabaseAdmin.from("level_objects").insert(rows);
      if (error) throw new Error(error.message);
    }

    await supabaseAdmin.from("admin_logs").insert({
      admin_id: 0,
      action: "dev_upsert_level",
      target: levelId,
      details: { level_index: data.level_index, objects: data.objects.length, repeat } as never,
    });

    return { ok: true, id: levelId, level_index: data.level_index, repeat };
  });

const DevGetInput = z.object({
  password: z.string().min(1).max(64),
  level_index: z.number().int().min(1).max(1000),
});

/** Load a level by index (or null if none yet) for the dev editor. */
export const devGetLevelByIndex = createServerFn({ method: "POST" })
  .inputValidator((input) => DevGetInput.parse(input))
  .handler(async ({ data }) => {
    checkDevPassword(data.password);
    type LvRow = {
      id: string; name: string; duration_seconds: number;
      gravity: number | string; jump_strength: number | string;
      scroll_speed: number | string; pipe_gap: number;
      enabled: boolean; weight: number; repeat_loop: boolean;
      reward_per_coin: number | string; bg_color: string | null;
    };
    const lvRes = await (supabaseAdmin.from("levels") as unknown as {
      select: (s: string) => { eq: (c: string, v: unknown) => { maybeSingle: () => Promise<{ data: LvRow | null }> } };
    })
      .select("*")
      .eq("level_index", data.level_index)
      .maybeSingle();
    const lv = lvRes.data;
    if (!lv) return { level: null, objects: [] as Array<{ id: string; obj_type: string; x_time: number; y: number; props: Record<string, string | number | boolean> }> };
    const { data: objs } = await supabaseAdmin
      .from("level_objects")
      .select("*")
      .eq("level_id", lv.id)
      .order("x_time");
    return {
      level: {
        id: lv.id,
        name: lv.name,
        duration_seconds: lv.duration_seconds,
        gravity: Number(lv.gravity),
        jump_strength: Number(lv.jump_strength),
        scroll_speed: Number(lv.scroll_speed),
        pipe_gap: lv.pipe_gap,
        enabled: lv.enabled,
        weight: lv.weight,
        repeat_loop: lv.repeat_loop,
        reward_per_coin: Number(lv.reward_per_coin),
        bg_color: lv.bg_color ?? "#0a0a0a",
      },
      objects: (objs ?? []).map((o) => ({
        id: o.id as string,
        obj_type: o.obj_type as string,
        x_time: Number(o.x_time),
        y: Number(o.y),
        props: (o.props ?? {}) as Record<string, string | number | boolean>,
      })),
    };
  });

const DevVerifyInput = z.object({ password: z.string().min(1).max(64) });
export const devVerifyPassword = createServerFn({ method: "POST" })
  .inputValidator((input) => DevVerifyInput.parse(input))
  .handler(async ({ data }) => {
    checkDevPassword(data.password);
    return { ok: true };
  });

/** List all dev-indexed levels (with object counts) for the clone picker. */
export const devListLevels = createServerFn({ method: "POST" })
  .inputValidator((input) => DevVerifyInput.parse(input))
  .handler(async ({ data }) => {
    checkDevPassword(data.password);
    type Row = { id: string; name: string; level_index: number | null; enabled: boolean };
    const { data: rows } = await (supabaseAdmin.from("levels") as unknown as {
      select: (s: string) => { not: (c: string, op: string, v: unknown) => { order: (c: string) => Promise<{ data: Row[] | null }> } };
    })
      .select("id,name,level_index,enabled")
      .not("level_index", "is", null)
      .order("level_index");
    const list = rows ?? [];
    const ids = list.map((r) => r.id);
    const counts: Record<string, number> = {};
    if (ids.length > 0) {
      const { data: objs } = await supabaseAdmin
        .from("level_objects")
        .select("level_id")
        .in("level_id", ids);
      for (const o of (objs ?? []) as Array<{ level_id: string }>) {
        counts[o.level_id] = (counts[o.level_id] ?? 0) + 1;
      }
    }
    return list
      .filter((r) => r.level_index != null)
      .map((r) => ({
        id: r.id,
        name: r.name,
        level_index: r.level_index as number,
        enabled: r.enabled,
        object_count: counts[r.id] ?? 0,
      }));
  });

// ─── Public read for /trial and other browser previews (no auth) ─────
const PublicGetInput = z.object({
  level_index: z.number().int().min(1).max(1000),
});

/**
 * Fetch a dev-built level + its placed objects by player-facing index.
 * Returns `null` when no level has been built yet for that index, so the
 * caller can fall back to its built-in preview map.
 */
export const getPublicLevelByIndex = createServerFn({ method: "POST" })
  .inputValidator((input) => PublicGetInput.parse(input))
  .handler(async ({ data }) => {
    type LvRow = {
      id: string; name: string; duration_seconds: number;
      gravity: number | string; jump_strength: number | string;
      scroll_speed: number | string; pipe_gap: number;
      enabled: boolean; repeat_loop: boolean;
      reward_per_coin: number | string; bg_color: string | null;
    };
    const lvRes = await (supabaseAdmin.from("levels") as unknown as {
      select: (s: string) => {
        eq: (c: string, v: unknown) => {
          maybeSingle: () => Promise<{ data: LvRow | null }>;
        };
      };
    })
      .select("id,name,duration_seconds,gravity,jump_strength,scroll_speed,pipe_gap,enabled,repeat_loop,reward_per_coin,bg_color")
      .eq("level_index", data.level_index)
      .maybeSingle();
    const lv = lvRes.data;
    if (!lv || !lv.enabled) return { level: null, objects: [] as Array<{ id: string; obj_type: string; x_time: number; y: number; props: Record<string, string | number | boolean> }> };
    const { data: objs } = await supabaseAdmin
      .from("level_objects")
      .select("*")
      .eq("level_id", lv.id)
      .order("x_time");
    return {
      level: {
        id: lv.id,
        name: lv.name,
        duration_seconds: lv.duration_seconds,
        gravity: Number(lv.gravity),
        jump_strength: Number(lv.jump_strength),
        scroll_speed: Number(lv.scroll_speed),
        pipe_gap: lv.pipe_gap,
        repeat_loop: lv.repeat_loop,
        reward_per_coin: Number(lv.reward_per_coin),
        bg_color: lv.bg_color ?? "#0a0a0a",
      },
      objects: (objs ?? []).map((o) => ({
        id: o.id as string,
        obj_type: o.obj_type as string,
        x_time: Number(o.x_time),
        y: Number(o.y),
        props: (o.props ?? {}) as Record<string, string | number | boolean>,
      })),
    };
  });


