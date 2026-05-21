-- Atomic clips_used increment for ClipForge Pro users.
-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
--
-- Used by db_increment_clips_used() after a pipeline completes to avoid
-- the read-modify-write race in the old Python-side approach.

CREATE OR REPLACE FUNCTION increment_clips_used(p_user_id uuid, p_count int)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE profiles
  SET clips_used = COALESCE(clips_used, 0) + p_count
  WHERE id = p_user_id;
$$;
