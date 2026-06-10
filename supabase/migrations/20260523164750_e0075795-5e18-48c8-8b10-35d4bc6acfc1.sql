
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS free_plays_used_today integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_plays_used_today integer NOT NULL DEFAULT 0;

-- Ensure settings.key is unique so upserts work
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'settings_key_key'
  ) THEN
    ALTER TABLE public.settings ADD CONSTRAINT settings_key_key UNIQUE (key);
  END IF;
END $$;

INSERT INTO public.settings (key, value) VALUES
  ('paid_revive_base_gtc', '300'::jsonb),
  ('paid_revive_multiplier', '2'::jsonb),
  ('daily_free_revives', '2'::jsonb),
  ('paid_play_base_gtc', '200'::jsonb),
  ('paid_play_multiplier', '2'::jsonb),
  ('daily_free_plays', '2'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
