-- Backfill channels: process historical videos from a channel on a daily schedule.
-- Run once in Supabase SQL Editor (Dashboard → SQL Editor → New query).

CREATE TABLE IF NOT EXISTS public.backfill_channels (
  id                    uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id               uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_url           text        NOT NULL,
  channel_name          text        NOT NULL DEFAULT '',
  days_back             int         NOT NULL DEFAULT 30,
  videos_per_day        int         NOT NULL DEFAULT 2,
  yt_upload_channel_id  text        NOT NULL DEFAULT '',
  processed_video_ids   jsonb       NOT NULL DEFAULT '[]',
  total_videos          int         NOT NULL DEFAULT 0,
  status                text        NOT NULL DEFAULT 'active',
  last_run_at           timestamptz,
  created_at            timestamptz DEFAULT now()
);
