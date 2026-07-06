-- Brand kit (W5.4): per-user settings bag on profiles.
-- profiles.options.brand = {enabled, position, opacity, size, color}
-- PostgREST silently drops the key on update if this column doesn't exist.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS options jsonb NOT NULL DEFAULT '{}'::jsonb;
