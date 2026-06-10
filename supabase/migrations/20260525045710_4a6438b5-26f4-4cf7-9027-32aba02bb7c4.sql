ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS referral_code_redeemed_at timestamp with time zone;