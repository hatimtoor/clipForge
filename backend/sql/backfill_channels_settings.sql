-- Add clip/caption settings columns to backfill_channels.
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query).

ALTER TABLE public.backfill_channels ADD COLUMN IF NOT EXISTS max_clips             int  NOT NULL DEFAULT 3;
ALTER TABLE public.backfill_channels ADD COLUMN IF NOT EXISTS min_duration          int  NOT NULL DEFAULT 30;
ALTER TABLE public.backfill_channels ADD COLUMN IF NOT EXISTS max_duration          int  NOT NULL DEFAULT 90;
ALTER TABLE public.backfill_channels ADD COLUMN IF NOT EXISTS caption_style         text NOT NULL DEFAULT 'bold_bottom';
ALTER TABLE public.backfill_channels ADD COLUMN IF NOT EXISTS caption_font_size     int;
ALTER TABLE public.backfill_channels ADD COLUMN IF NOT EXISTS caption_highlight_color text;
ALTER TABLE public.backfill_channels ADD COLUMN IF NOT EXISTS caption_language      text NOT NULL DEFAULT 'source';
