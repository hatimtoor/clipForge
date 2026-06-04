-- Track whether a job's R2 clips have been auto-deleted after the retention window.
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query).

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS clips_expired boolean NOT NULL DEFAULT false;
