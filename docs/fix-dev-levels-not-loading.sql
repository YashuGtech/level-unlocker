-- ─── Run ONCE in the Supabase SQL editor ─────────────────────────────
-- Fixes: levels built in /dev (e.g. Level 12) not showing up for real
-- players. Root cause = the `level_index` column/unique-index from the
-- earlier dev-admin migration wasn't actually applied, so either no row
-- matched `level_index = 12` at game start, or multiple rows did and
-- `maybeSingle()` errored / picked the wrong one. After this, every
-- dev save is keyed uniquely by level_index and the game runtime loads
-- the exact placements the dev saved.

-- 1. Ensure the player-facing index column exists.
ALTER TABLE public.levels
  ADD COLUMN IF NOT EXISTS level_index integer;

-- 2. Deduplicate any existing rows per level_index, keeping the most
--    recently updated row (the latest /dev save) and removing the
--    older duplicates + their orphaned level_objects.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY level_index
           ORDER BY COALESCE(updated_at, created_at) DESC, created_at DESC
         ) AS rn
    FROM public.levels
   WHERE level_index IS NOT NULL
)
DELETE FROM public.level_objects
 WHERE level_id IN (SELECT id FROM ranked WHERE rn > 1);

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY level_index
           ORDER BY COALESCE(updated_at, created_at) DESC, created_at DESC
         ) AS rn
    FROM public.levels
   WHERE level_index IS NOT NULL
)
DELETE FROM public.levels
 WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 3. Enforce uniqueness so future /dev saves can never re-introduce
--    ambiguity.
DROP INDEX IF EXISTS public.levels_level_index_uidx;
CREATE UNIQUE INDEX levels_level_index_uidx
  ON public.levels(level_index)
  WHERE level_index IS NOT NULL;

-- 4. Service-role grants used by the /dev editor and the game runtime
--    (both go through supabaseAdmin). Re-asserted in case earlier
--    migrations tightened them.
GRANT ALL ON public.levels        TO service_role;
GRANT ALL ON public.level_objects TO service_role;

-- 5. (Sanity check) — after running the above, this should return
--    exactly one row per built level, with the object count that
--    matches what you see in the /dev editor:
-- SELECT l.level_index, l.name, l.enabled, count(o.id) AS objects
--   FROM public.levels l
--   LEFT JOIN public.level_objects o ON o.level_id = l.id
--  WHERE l.level_index IS NOT NULL
--  GROUP BY l.level_index, l.name, l.enabled
--  ORDER BY l.level_index;
