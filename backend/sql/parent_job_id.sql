-- Reprompt: child jobs re-analyze a finished job's video with a new prompt,
-- reusing its cached source + transcript. Run in the Supabase SQL Editor.

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS parent_job_id uuid;
CREATE INDEX IF NOT EXISTS jobs_parent_job_id_idx ON public.jobs (parent_job_id);
