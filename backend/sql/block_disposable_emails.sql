-- Block disposable / temp-mail signups at the database level.
-- This is the unbypassable gate: a BEFORE INSERT trigger on auth.users that
-- rejects any email whose domain is in disposable_email_domains. Works no matter
-- how the account is created (email/password, admin API, etc.).
--
-- Run once in Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- To add more domains later: INSERT INTO public.disposable_email_domains VALUES ('newdomain.com');

CREATE TABLE IF NOT EXISTS public.disposable_email_domains (
  domain text PRIMARY KEY
);

-- Lock the table down — only the trigger (SECURITY DEFINER) and service_role touch it.
ALTER TABLE public.disposable_email_domains ENABLE ROW LEVEL SECURITY;

-- Seed with the most-abused disposable providers (extend anytime).
INSERT INTO public.disposable_email_domains (domain) VALUES
  ('mailinator.com'),('guerrillamail.com'),('guerrillamail.info'),('guerrillamail.net'),
  ('guerrillamail.org'),('guerrillamail.biz'),('sharklasers.com'),('grr.la'),('spam4.me'),
  ('10minutemail.com'),('10minutemail.net'),('20minutemail.com'),('temp-mail.org'),
  ('temp-mail.io'),('tempmail.com'),('tempmail.net'),('tempmailo.com'),('tempr.email'),
  ('tmpmail.org'),('tmpmail.net'),('tmail.com'),('throwawaymail.com'),('throwam.com'),
  ('yopmail.com'),('yopmail.net'),('yopmail.fr'),('cool.fr.nf'),('jetable.fr.nf'),
  ('nospam.ze.tc'),('nomail.xl.cx'),('mega.zik.dj'),('speed.1s.fr'),('moncourrier.fr.nf'),
  ('monemail.fr.nf'),('monmail.fr.nf'),('mailnesia.com'),('maildrop.cc'),('mailcatch.com'),
  ('mailnull.com'),('getnada.com'),('nada.email'),('dispostable.com'),('trashmail.com'),
  ('trashmail.net'),('trashmail.de'),('trash-mail.com'),('wegwerfmail.de'),('wegwerfmail.net'),
  ('mytemp.email'),('tempinbox.com'),('emailondeck.com'),('fakeinbox.com'),('fakemail.net'),
  ('fakemailgenerator.com'),('mohmal.com'),('emailfake.com'),('email-fake.com'),
  ('luxusmail.org'),('mailpoof.com'),('mail-temp.com'),('inboxkitten.com'),('33mail.com'),
  ('anonbox.net'),('discard.email'),('discardmail.com'),('spamgourmet.com'),('maileater.com'),
  ('mintemail.com'),('mailexpire.com'),('spambox.us'),('spambog.com'),('spamfree24.org'),
  ('incognitomail.org'),('deadaddress.com'),('e4ward.com'),('jetable.org'),('mailtemp.net'),
  ('1secmail.com'),('1secmail.org'),('1secmail.net'),('kzccv.com'),('qiott.com'),('wuuvo.com'),
  ('vjuum.com'),('laafd.com'),('oosln.com'),('byom.de'),('mailto.plus'),('fexpost.com'),
  ('fexbox.org'),('rover.info'),('chitthi.in'),('tafmail.com'),('vddaz.com'),('aaathats3as.com'),
  ('5ymail.com'),('burnermail.io'),('temp-mail.ru'),('mailtothis.com'),('tempemail.co'),
  ('tempemails.io'),('cs.email'),('crazymailing.com'),('mailsac.com'),('inboxbear.com'),
  ('disposablemail.com'),('throwawayemail.com'),('tempmailaddress.com'),('mailforspam.com')
ON CONFLICT (domain) DO NOTHING;

-- Trigger: reject inserts whose email domain is blocklisted.
CREATE OR REPLACE FUNCTION public.block_disposable_emails()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.disposable_email_domains
    WHERE domain = lower(split_part(NEW.email, '@', 2))
  ) THEN
    RAISE EXCEPTION 'Email address not allowed: disposable/temporary email providers are blocked.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_disposable_emails ON auth.users;
CREATE TRIGGER trg_block_disposable_emails
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.block_disposable_emails();
