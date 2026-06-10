
-- Users (keyed by Telegram ID; no Supabase auth)
CREATE TABLE public.users (
  telegram_id BIGINT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  photo_url TEXT,
  language_code TEXT,
  is_premium BOOLEAN NOT NULL DEFAULT FALSE,
  balance_gtc NUMERIC(20,4) NOT NULL DEFAULT 0,
  current_level INTEGER NOT NULL DEFAULT 1,
  levels_completed INTEGER NOT NULL DEFAULT 0,
  free_revives_used_today INTEGER NOT NULL DEFAULT 0,
  paid_revives_used_today INTEGER NOT NULL DEFAULT 0,
  free_plays_used_today INTEGER NOT NULL DEFAULT 0,
  paid_plays_used_today INTEGER NOT NULL DEFAULT 0,
  bonus_free_revives INTEGER NOT NULL DEFAULT 0,
  last_revive_reset_date DATE,
  last_played_date DATE,
  last_seen TIMESTAMPTZ,
  referrer_id BIGINT,
  referral_code_redeemed_at TIMESTAMPTZ,
  banned BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.users TO service_role;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.admins (
  telegram_id BIGINT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'secondary',
  added_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.admins TO service_role;
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.admin_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id BIGINT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.admin_logs TO service_role;
ALTER TABLE public.admin_logs ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.settings (
  key TEXT PRIMARY KEY,
  value JSONB,
  updated_by BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.settings TO service_role;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.announcements TO service_role;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 60,
  gravity NUMERIC(6,3) NOT NULL DEFAULT 0.5,
  jump_strength NUMERIC(6,3) NOT NULL DEFAULT -8,
  scroll_speed NUMERIC(6,3) NOT NULL DEFAULT 2,
  pipe_gap INTEGER NOT NULL DEFAULT 150,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  weight INTEGER NOT NULL DEFAULT 1,
  repeat_loop BOOLEAN NOT NULL DEFAULT FALSE,
  reward_per_coin NUMERIC(10,2) NOT NULL DEFAULT 1,
  bg_color TEXT DEFAULT '#0a0a0a',
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.levels TO service_role;
ALTER TABLE public.levels ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.level_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level_id UUID NOT NULL REFERENCES public.levels(id) ON DELETE CASCADE,
  obj_type TEXT NOT NULL,
  x_time NUMERIC(10,3) NOT NULL,
  y NUMERIC(10,4) NOT NULL,
  props JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.level_objects TO service_role;
ALTER TABLE public.level_objects ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.game_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL,
  level_id UUID,
  map_template_id TEXT,
  level_index INTEGER,
  status TEXT NOT NULL DEFAULT 'in_progress',
  entry_fee_gtc NUMERIC(20,4) NOT NULL DEFAULT 0,
  revives_used INTEGER NOT NULL DEFAULT 0,
  paid_revives_used INTEGER NOT NULL DEFAULT 0,
  coins_pending INTEGER NOT NULL DEFAULT 0,
  coins_credited INTEGER NOT NULL DEFAULT 0,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.game_sessions TO service_role;
ALTER TABLE public.game_sessions ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL,
  amount_usdt NUMERIC(20,4) NOT NULL,
  amount_gtc NUMERIC(20,4) NOT NULL,
  tx_hash TEXT NOT NULL UNIQUE,
  screenshot_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  admin_note TEXT,
  reviewed_by BIGINT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.deposits TO service_role;
ALTER TABLE public.deposits ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL,
  kind TEXT NOT NULL,
  amount_gtc NUMERIC(20,4) NOT NULL,
  balance_after NUMERIC(20,4) NOT NULL,
  ref_id UUID,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.transactions TO service_role;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_transactions_user_id_created ON public.transactions(user_id, created_at DESC);

CREATE TABLE public.referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id BIGINT NOT NULL,
  referred_id BIGINT NOT NULL,
  reward_gtc NUMERIC(20,4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.referrals TO service_role;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_referrals_referrer ON public.referrals(referrer_id);
CREATE INDEX idx_deposits_user_status ON public.deposits(user_id, status);
CREATE INDEX idx_game_sessions_user ON public.game_sessions(user_id);
