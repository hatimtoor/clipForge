-- Scheduler / calendar (W5.5): queue a rendered clip for publishing at a
-- specific time. Run in the Supabase SQL editor.
CREATE TABLE IF NOT EXISTS public.scheduled_posts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  job_id      uuid NOT NULL,
  clip_index  int  NOT NULL,
  platform    text NOT NULL CHECK (platform IN ('youtube', 'tiktok')),
  target_id   text,                       -- yt_channel_id / tt_open_id
  title       text,
  description text,
  privacy     text,
  publish_at  timestamptz NOT NULL,
  status      text NOT NULL DEFAULT 'scheduled',  -- scheduled|publishing|done|error|cancelled
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scheduled_posts_due_idx
  ON public.scheduled_posts (status, publish_at);
CREATE INDEX IF NOT EXISTS scheduled_posts_user_idx
  ON public.scheduled_posts (user_id, publish_at DESC);

-- service_role bypasses RLS but still needs table privileges (learned the
-- hard way — see channels/profiles setup).
GRANT ALL ON public.scheduled_posts TO service_role;
