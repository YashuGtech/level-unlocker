-- Apply in Supabase SQL editor (Lovable Cloud → SQL Editor).
-- Adds browser-auth support: phone columns + web_sessions table.

ALTER TABLE public.users  ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS phone TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique  ON public.users  (phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS admins_phone_unique ON public.admins (phone) WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.web_sessions (
  token       TEXT PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES public.users(telegram_id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.web_sessions TO authenticated;
GRANT ALL    ON public.web_sessions TO service_role;
ALTER TABLE public.web_sessions ENABLE ROW LEVEL SECURITY;
-- No policies: service role only (server functions).
