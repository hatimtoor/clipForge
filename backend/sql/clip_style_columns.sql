-- Add clip_style to jobs, channels, and backfill_channels tables.
-- "reframe" = existing YOLO crop-to-portrait style (default, backwards-compatible)
-- "blur_bg"  = landscape clip centered on 9:16 with blurred background fill

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS clip_style text DEFAULT 'reframe';

ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS clip_style text DEFAULT 'reframe';

ALTER TABLE public.backfill_channels
  ADD COLUMN IF NOT EXISTS clip_style text DEFAULT 'reframe';
