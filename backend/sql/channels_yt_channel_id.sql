-- Watchlist per-channel YouTube upload destination. The frontend has always
-- PATCHed yt_channel_id (and auto-selects it when exactly one channel is
-- connected), but the column was never created — discovered 2026-07-28 when a
-- single-channel account's auto-upload toggle 500'd with PGRST204.
-- Run once in Supabase SQL Editor (already applied to prod 2026-07-28).

ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS yt_channel_id text;
NOTIFY pgrst, 'reload schema';
