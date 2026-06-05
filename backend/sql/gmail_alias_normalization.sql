-- Collapse email aliases so one person can't farm many free accounts from a
-- single inbox (e.g. u.ser@gmail.com, user+1@gmail.com, user+2@gmail.com all
-- map to the same real inbox). A BEFORE INSERT trigger on auth.users rejects a
-- signup whose NORMALIZED email already belongs to an existing account.
--
-- Run once in Supabase SQL Editor. Safe to run after block_disposable_emails.sql.

-- Canonical form of an email for dedup purposes:
--   * lowercased + trimmed
--   * +suffix stripped (common alias mechanism on most providers)
--   * for gmail/googlemail: dots removed from the local part, domain unified to gmail.com
CREATE OR REPLACE FUNCTION public.normalize_email(p_email text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_local  text;
  v_domain text;
BEGIN
  p_email  := lower(trim(p_email));
  v_local  := split_part(p_email, '@', 1);
  v_domain := split_part(p_email, '@', 2);

  -- strip +suffix for everyone
  v_local := split_part(v_local, '+', 1);

  -- gmail-specific: dots are insignificant, googlemail == gmail
  IF v_domain IN ('gmail.com', 'googlemail.com') THEN
    v_local  := replace(v_local, '.', '');
    v_domain := 'gmail.com';
  END IF;

  RETURN v_local || '@' || v_domain;
END;
$$;

-- Reject inserts whose normalized email already exists on another account.
CREATE OR REPLACE FUNCTION public.block_email_aliases()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NEW.email IS NOT NULL AND EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id <> NEW.id
      AND public.normalize_email(u.email) = public.normalize_email(NEW.email)
  ) THEN
    RAISE EXCEPTION 'An account already exists for this email address.'
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_email_aliases ON auth.users;
CREATE TRIGGER trg_block_email_aliases
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.block_email_aliases();

-- NOTE ON SCALE: this scans auth.users applying normalize_email() per row on each
-- signup. Fine at current volume (signups are infrequent). If the user table grows
-- large, add a generated/maintained normalized_email column with a UNIQUE index and
-- compare against that instead of a full scan.
