ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS bonus_free_revives integer NOT NULL DEFAULT 0;

INSERT INTO public.settings (key, value)
VALUES ('paid_revive_base_gtc', '200'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

INSERT INTO public.settings (key, value)
VALUES ('paid_revive_multiplier', '2'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();