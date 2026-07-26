-- Instagram auto-upload destination for watchlist channels and digest backfills.
-- Run once in Supabase SQL Editor (Dashboard → SQL Editor → New query).

ALTER TABLE public.channels          ADD COLUMN IF NOT EXISTS ig_user_id text;
ALTER TABLE public.backfill_channels ADD COLUMN IF NOT EXISTS ig_user_id text;
