-- Add auto_upload toggle to backfill_channels.
-- Run in Supabase SQL Editor.

ALTER TABLE public.backfill_channels
  ADD COLUMN IF NOT EXISTS auto_upload boolean NOT NULL DEFAULT false;
