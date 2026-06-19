-- Lemon Squeezy billing fields on profiles.
-- Run this in Supabase BEFORE deploying the billing webhook — PostgREST silently
-- drops writes to columns that don't exist yet.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ls_subscription_id  text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ls_customer_id      text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS subscription_status text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS plan_renews_at      timestamptz;
