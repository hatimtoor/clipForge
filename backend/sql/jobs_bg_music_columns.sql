-- Add background music columns to the jobs table.
-- The HelloPage clip flow (start_clip → db_create_job) stores these per job.
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query).

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS bg_music_url    text;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS bg_music_volume float NOT NULL DEFAULT 0.15;
