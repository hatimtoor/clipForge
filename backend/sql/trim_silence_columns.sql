-- Add the silence-trimming toggle to channels and backfill_channels.
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query).

ALTER TABLE public.channels          ADD COLUMN IF NOT EXISTS trim_silence boolean NOT NULL DEFAULT false;
ALTER TABLE public.backfill_channels ADD COLUMN IF NOT EXISTS trim_silence boolean NOT NULL DEFAULT false;
