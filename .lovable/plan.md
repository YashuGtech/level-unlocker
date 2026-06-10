## Goal

Add a browser-accessible Dev/Admin mode (gated by password **7207**) where an admin can pick any level (1–100), place all 10 obstacle types on a timeline, and save it. Saved levels are persisted in Supabase and served to real players. If the designed map is shorter than 60s, the engine repeats it to fill the run.

Nothing in `.env` is touched. Telegram-admin flow, trial mode, and the existing `/admin/level/$id` editor stay intact.

## What changes

### 1. New route `/dev` — Browser admin mode
- Password gate (7207, persisted in `localStorage` under `gtech_dev_unlocked`).
- After unlock: grid of levels 1–100. Pick one → opens a Level Editor.
- Editor reuses the existing tap-to-place timeline UI from `admin.level.$id.tsx`, but:
  - Adds the missing obstacle types to the tool palette:
    `pipe` (gold top), `poll` (gold bottom), `wall` (brick top/bottom), `block`, `hammer`, `blade` (rotating), `blade_hanging`, `spike`, `coin`, `bear`.
  - Loads existing level data for the selected number (if any) from Supabase.
  - Saves via a new password-auth server fn — no Telegram `initData` needed.
  - Auto-sets `repeat_loop=true` whenever the last object's `x_time` is under the level's `duration_seconds`, so a short map loops to fill 60s for real players.

### 2. New server fn `upsertLevelByDevPassword` (password-gated)
- Lives in `src/lib/levels.functions.ts`.
- Validates the password against `process.env.DEV_ADMIN_PASSWORD` (falls back to `"7207"` so no env edit is required).
- Resolves the target level by `level_index` (1–100) instead of UUID. Creates the row if it doesn't exist, otherwise updates and replaces its `level_objects`.
- Logs the action to `admin_logs` with `admin_id = 0` and `action = "dev_upsert_level"`.

### 3. SQL migration (Supabase)

```sql
-- 1. Extend the obj_type enum to cover every obstacle the engine renders.
ALTER TYPE public.level_object_type ADD VALUE IF NOT EXISTS 'wall';
ALTER TYPE public.level_object_type ADD VALUE IF NOT EXISTS 'block';
ALTER TYPE public.level_object_type ADD VALUE IF NOT EXISTS 'hammer';
ALTER TYPE public.level_object_type ADD VALUE IF NOT EXISTS 'blade';
ALTER TYPE public.level_object_type ADD VALUE IF NOT EXISTS 'blade_hanging';
ALTER TYPE public.level_object_type ADD VALUE IF NOT EXISTS 'laser';
ALTER TYPE public.level_object_type ADD VALUE IF NOT EXISTS 'gate';
ALTER TYPE public.level_object_type ADD VALUE IF NOT EXISTS 'spike_wall';
ALTER TYPE public.level_object_type ADD VALUE IF NOT EXISTS 'shooter';

-- 2. Make levels addressable by their player-facing index (1..100).
ALTER TABLE public.levels
  ADD COLUMN IF NOT EXISTS level_index integer;
CREATE UNIQUE INDEX IF NOT EXISTS levels_level_index_uidx
  ON public.levels(level_index) WHERE level_index IS NOT NULL;

-- 3. Service-role grants (admin server fn uses supabaseAdmin).
GRANT ALL ON public.levels        TO service_role;
GRANT ALL ON public.level_objects TO service_role;
```

(All other policies stay as-is. The existing Telegram-admin editor keeps working because the enum is only widened.)

### 4. Zod validator update
- `UpsertLevelInput.objects[].obj_type` widened to the new enum.
- Add a new schema `UpsertLevelByDevInput` with `password`, `level_index`, and the same level fields.

### 5. Engine auto-repeat
- `flappy.tsx` already honours `repeat_loop`. The Dev editor just sets it to `true` for any map whose objects don't fill `duration_seconds`. No engine change.

## Files

- New: `src/routes/dev.tsx` (password gate + level picker + editor)
- New: `supabase/migrations/<ts>_dev_admin_levels.sql` (the SQL above)
- Edit: `src/lib/levels.functions.ts` (new `upsertLevelByDevPassword` fn, extended enum in Zod)
- Edit: `src/lib/level-obstacles.ts` (export full obstacle palette metadata used by the editor)

## What stays the same

- `.env` untouched
- Telegram auth / `/admin` / `/admin/level/$id` unchanged
- Trial mode and password gate at `/trial` unchanged
- Real-player game (`/game`) keeps reading from `levels` + `level_objects` — they will just see the new obstacles when an admin places them
