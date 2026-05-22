-- Enable multiple YouTube channels per ClipForge user.
-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor → New query).

-- Step 1: add channel identity columns
ALTER TABLE public.youtube_tokens ADD COLUMN IF NOT EXISTS yt_channel_id   text NOT NULL DEFAULT '';
ALTER TABLE public.youtube_tokens ADD COLUMN IF NOT EXISTS yt_channel_name text NOT NULL DEFAULT 'YouTube';

-- Step 2: drop the old unique constraint on user_id alone
--         (Postgres default name is youtube_tokens_user_id_key)
ALTER TABLE public.youtube_tokens DROP CONSTRAINT IF EXISTS youtube_tokens_user_id_key;

-- Step 3: add composite unique so each user can have one row per YouTube channel
ALTER TABLE public.youtube_tokens
  ADD CONSTRAINT youtube_tokens_user_channel_unique UNIQUE (user_id, yt_channel_id);
