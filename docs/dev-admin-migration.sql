-- ─── Dev/Admin browser mode — run once in the Supabase SQL editor ───
-- Adds a stable player-facing level number so the password-gated editor
-- (/dev, password 7207) can load/save by level index without UUIDs.
-- obj_type is already TEXT, so the editor's new obstacle types
-- (wall, block, hammer, blade, laser, gate, spike_wall, shooter) work
-- against the existing schema with no enum change.

ALTER TABLE public.levels
  ADD COLUMN IF NOT EXISTS level_index integer;

CREATE UNIQUE INDEX IF NOT EXISTS levels_level_index_uidx
  ON public.levels(level_index)
  WHERE level_index IS NOT NULL;

-- The dev editor writes via service_role (no Telegram session). Re-assert
-- the grants in case they were tightened by an earlier migration.
GRANT ALL ON public.levels        TO service_role;
GRANT ALL ON public.level_objects TO service_role;
