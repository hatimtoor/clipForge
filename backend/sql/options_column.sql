-- One flexible JSONB bag for new per-job/per-channel settings so we stop
-- adding a column per knob. First users: caption_position, caption_keywords.
-- Run in the Supabase SQL Editor.

ALTER TABLE public.jobs              ADD COLUMN IF NOT EXISTS options jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.channels          ADD COLUMN IF NOT EXISTS options jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.backfill_channels ADD COLUMN IF NOT EXISTS options jsonb NOT NULL DEFAULT '{}'::jsonb;
