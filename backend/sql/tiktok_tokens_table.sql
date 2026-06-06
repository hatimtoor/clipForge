-- TikTok OAuth tokens, one row per connected TikTok account per user.
-- Run once in Supabase SQL Editor (Dashboard → SQL Editor → New query).

CREATE TABLE IF NOT EXISTS public.tiktok_tokens (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tt_open_id      text        NOT NULL DEFAULT '',
  tt_display_name text        NOT NULL DEFAULT 'TikTok',
  access_token    text        NOT NULL,
  refresh_token   text,
  expires_at      timestamptz,
  created_at      timestamptz DEFAULT now(),
  CONSTRAINT tiktok_tokens_user_account_unique UNIQUE (user_id, tt_open_id)
);

ALTER TABLE public.tiktok_tokens ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.tiktok_tokens TO service_role;
