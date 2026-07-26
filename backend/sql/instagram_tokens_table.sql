-- Instagram OAuth tokens (Instagram API with Instagram Login), one row per
-- connected professional account per user. Long-lived tokens (~60 days) are
-- refreshed in place — Instagram has no separate refresh token.
-- Run once in Supabase SQL Editor (Dashboard → SQL Editor → New query).

CREATE TABLE IF NOT EXISTS public.instagram_tokens (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ig_user_id   text        NOT NULL DEFAULT '',
  ig_username  text        NOT NULL DEFAULT 'Instagram',
  access_token text        NOT NULL,
  expires_at   timestamptz,
  created_at   timestamptz DEFAULT now(),
  CONSTRAINT instagram_tokens_user_account_unique UNIQUE (user_id, ig_user_id)
);

ALTER TABLE public.instagram_tokens ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.instagram_tokens TO service_role;
