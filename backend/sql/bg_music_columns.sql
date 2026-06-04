-- Add background music settings to channels and backfill_channels.
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query).

ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS bg_music_url    text;
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS bg_music_volume float NOT NULL DEFAULT 0.15;

ALTER TABLE public.backfill_channels ADD COLUMN IF NOT EXISTS bg_music_url    text;
ALTER TABLE public.backfill_channels ADD COLUMN IF NOT EXISTS bg_music_volume float NOT NULL DEFAULT 0.15;
