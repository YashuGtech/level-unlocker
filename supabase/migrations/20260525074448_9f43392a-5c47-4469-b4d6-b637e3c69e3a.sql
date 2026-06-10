CREATE TABLE IF NOT EXISTS public.users (
  telegram_id BIGINT PRIMARY KEY, username TEXT, first_name TEXT, last_name TEXT, photo_url TEXT, language_code TEXT,
  is_premium BOOLEAN DEFAULT false, balance_gtc NUMERIC(20,4) NOT NULL DEFAULT 0, referrer_id BIGINT,
  banned BOOLEAN NOT NULL DEFAULT false, current_level INT NOT NULL DEFAULT 1, levels_completed INT NOT NULL DEFAULT 0,
  last_played_date DATE, last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  free_revives_used_today INT NOT NULL DEFAULT 0, paid_revives_used_today INT NOT NULL DEFAULT 0,
  last_revive_reset_date DATE, free_plays_used_today INT NOT NULL DEFAULT 0,
  paid_plays_used_today INT NOT NULL DEFAULT 0, bonus_free_revives INT NOT NULL DEFAULT 0,
  referral_code_redeemed_at TIMESTAMPTZ
);
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.admins (
  telegram_id BIGINT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('main','secondary')),
  added_by BIGINT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.settings (
  key TEXT PRIMARY KEY, value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by BIGINT
);
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL, body TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT true,
  created_by BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level_number INT UNIQUE, name TEXT NOT NULL,
  duration_seconds INT NOT NULL DEFAULT 60,
  gravity NUMERIC NOT NULL DEFAULT 0.5, jump_strength NUMERIC NOT NULL DEFAULT -8,
  scroll_speed NUMERIC NOT NULL DEFAULT 2.5, pipe_gap INT NOT NULL DEFAULT 220,
  bg_color TEXT DEFAULT '#0a0a0a', enabled BOOLEAN NOT NULL DEFAULT true,
  weight INT NOT NULL DEFAULT 1, repeat_loop BOOLEAN NOT NULL DEFAULT false,
  reward_per_coin NUMERIC NOT NULL DEFAULT 1, prize_gtc NUMERIC NOT NULL DEFAULT 10,
  free_revives INT NOT NULL DEFAULT 2, paid_revive_base NUMERIC NOT NULL DEFAULT 100,
  paid_revive_multiplier NUMERIC NOT NULL DEFAULT 2, paid_revive_limit INT NOT NULL DEFAULT 1000,
  obstacle_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.levels ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.level_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level_id UUID NOT NULL REFERENCES public.levels(id) ON DELETE CASCADE,
  obj_type TEXT NOT NULL, x_time NUMERIC NOT NULL, y NUMERIC NOT NULL,
  props JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.level_objects ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.game_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES public.users(telegram_id) ON DELETE CASCADE,
  level_id UUID REFERENCES public.levels(id) ON DELETE SET NULL,
  map_template_id TEXT, level_index INT,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','failed','abandoned')),
  coins_pending INT NOT NULL DEFAULT 0, coins_credited INT NOT NULL DEFAULT 0,
  revives_used INT NOT NULL DEFAULT 0, paid_revives_used INT NOT NULL DEFAULT 0,
  entry_fee_gtc NUMERIC(20,4) NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(), ended_at TIMESTAMPTZ
);
ALTER TABLE public.game_sessions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES public.users(telegram_id) ON DELETE CASCADE,
  amount_usdt NUMERIC(20,6) NOT NULL, amount_gtc NUMERIC(20,4) NOT NULL,
  tx_hash TEXT NOT NULL UNIQUE, screenshot_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','auto_approved')),
  verification_data JSONB, admin_note TEXT, reviewed_by BIGINT, reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.deposits ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES public.users(telegram_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('deposit','game_reward','referral_bonus','referral_share','admin_adjust','revive_spend','level_prize','powerup_spend','play_fee','play_refund','level_skip')),
  amount_gtc NUMERIC(20,4) NOT NULL, balance_after NUMERIC(20,4) NOT NULL,
  ref_id UUID, note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id BIGINT NOT NULL REFERENCES public.users(telegram_id) ON DELETE CASCADE,
  referred_id BIGINT NOT NULL REFERENCES public.users(telegram_id) ON DELETE CASCADE,
  reward_gtc NUMERIC(20,4) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.admin_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id BIGINT NOT NULL, action TEXT NOT NULL, target TEXT, details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_logs ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','admins','announcements','settings','levels','level_objects','game_sessions','deposits','transactions','referrals','admin_logs']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'backend_only_deny', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO public USING (false) WITH CHECK (false)', 'backend_only_deny', t);
  END LOOP;
END $$;

INSERT INTO public.admins (telegram_id, role) VALUES (5574348933, 'main') ON CONFLICT DO NOTHING;

INSERT INTO public.settings (key, value) VALUES
  ('game_enabled','true'::jsonb),
  ('level_cap','100'::jsonb),
  ('refer_reward_gtc','50'::jsonb),
  ('gtc_usdt_rate','0.05'::jsonb),
  ('play_fee_gtc','100'::jsonb),
  ('daily_free_revives','2'::jsonb),
  ('paid_revive_base_gtc','200'::jsonb),
  ('paid_revive_multiplier','2'::jsonb),
  ('paid_play_base_gtc','200'::jsonb),
  ('paid_play_multiplier','2'::jsonb),
  ('daily_free_plays','2'::jsonb),
  ('level_skip_fee_gtc','500'::jsonb),
  ('level_skip_prize_gtc','200'::jsonb),
  ('level_win_prize_gtc','200'::jsonb)
ON CONFLICT (key) DO NOTHING;