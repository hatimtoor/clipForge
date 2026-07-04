-- Fix youtube_tokens to support multiple channels per user.
-- The original table has user_id as the PRIMARY KEY, which prevents
-- inserting a second row for the same user (different channel).
-- This migration adds a surrogate uuid id column as the new PK.
--
-- Run once in Supabase SQL Editor (Dashboard → SQL Editor → New query).

-- Step 1: Add surrogate id column with a default
ALTER TABLE public.youtube_tokens
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();

-- Step 2: Fill id for any existing rows that got NULL (safety)
UPDATE public.youtube_tokens SET id = gen_random_uuid() WHERE id IS NULL;

-- Step 3: Drop the old single-column primary key on user_id
ALTER TABLE public.youtube_tokens DROP CONSTRAINT youtube_tokens_pkey;

-- Step 4: Make id NOT NULL and the new primary key
ALTER TABLE public.youtube_tokens ALTER COLUMN id SET NOT NULL;
ALTER TABLE public.youtube_tokens ADD PRIMARY KEY (id);

-- Step 5: Ensure the composite unique on (user_id, yt_channel_id) exists
--         (was added by youtube_tokens_multi_channel.sql — safe to re-run)
ALTER TABLE public.youtube_tokens
  DROP CONSTRAINT IF EXISTS youtube_tokens_user_channel_unique;
ALTER TABLE public.youtube_tokens
  ADD CONSTRAINT youtube_tokens_user_channel_unique UNIQUE (user_id, yt_channel_id);
