-- Atomic quota claim for ClipForge free-tier users.
-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
--
-- What it does: checks clips_used + count <= limit in a single transaction,
-- increments if within quota, and returns true/false. This prevents the
-- race condition where concurrent requests all see clips_used < limit.

CREATE OR REPLACE FUNCTION claim_clips(p_user_id uuid, p_count int, p_limit int)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_used int;
BEGIN
  -- Lock the row for the duration of this transaction
  SELECT clips_used INTO v_used
  FROM profiles
  WHERE id = p_user_id
  FOR UPDATE;

  -- Profile doesn't exist yet — let the app create it, deny this attempt
  IF v_used IS NULL THEN
    RETURN false;
  END IF;

  -- Over quota
  IF v_used + p_count > p_limit THEN
    RETURN false;
  END IF;

  -- Claim the slots atomically
  UPDATE profiles
  SET clips_used = clips_used + p_count
  WHERE id = p_user_id;

  RETURN true;
END;
$$;
