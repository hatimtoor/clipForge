-- Add caption settings columns to the channels table.
-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor → New query).

ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS caption_style          text    NOT NULL DEFAULT 'bold_bottom';
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS caption_font_size       integer;
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS caption_highlight_color text;
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS caption_language        text    NOT NULL DEFAULT 'source';
