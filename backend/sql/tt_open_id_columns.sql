-- Add TikTok auto-upload target (which connected TikTok account) to channels
-- and backfill_channels, so watchlist/digest auto-uploads can post to TikTok.
-- Run in Supabase SQL Editor.

ALTER TABLE public.channels          ADD COLUMN IF NOT EXISTS tt_open_id text;
ALTER TABLE public.backfill_channels ADD COLUMN IF NOT EXISTS tt_open_id text;
