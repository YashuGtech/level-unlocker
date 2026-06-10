ALTER TABLE public.deposits
  ADD CONSTRAINT deposits_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(telegram_id) ON DELETE CASCADE;