-- Promo / invite codes: sign up via a link → time-limited Pro, capped redemptions.
-- Run this in Supabase before deploying the promo endpoints.

-- 1. Time-limited Pro expiry on profiles (NULL = no promo/trial).
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pro_expires_at timestamptz;

-- 2. The codes themselves.
CREATE TABLE IF NOT EXISTS public.promo_codes (
  code             text PRIMARY KEY,
  pro_days         int  NOT NULL DEFAULT 10,
  max_redemptions  int  NOT NULL DEFAULT 50,
  redemptions_used int  NOT NULL DEFAULT 0,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- 3. One redemption per user per code.
CREATE TABLE IF NOT EXISTS public.promo_redemptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL REFERENCES public.promo_codes(code),
  user_id     uuid NOT NULL,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, user_id)
);

-- 4. Atomic redemption: locks the code row so the cap can't be exceeded under
--    concurrent sign-ups. Grants Pro for pro_days from now.
CREATE OR REPLACE FUNCTION public.redeem_promo(p_code text, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_code    public.promo_codes%ROWTYPE;
  v_expires timestamptz;
BEGIN
  SELECT * INTO v_code FROM public.promo_codes
    WHERE lower(code) = lower(p_code) AND active
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;

  IF EXISTS (SELECT 1 FROM public.promo_redemptions
             WHERE lower(code) = lower(p_code) AND user_id = p_user_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_redeemed');
  END IF;

  IF v_code.redemptions_used >= v_code.max_redemptions THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'full');
  END IF;

  v_expires := now() + make_interval(days => v_code.pro_days);

  UPDATE public.promo_codes
    SET redemptions_used = redemptions_used + 1
    WHERE code = v_code.code;

  INSERT INTO public.promo_redemptions(code, user_id)
    VALUES (v_code.code, p_user_id);

  -- Never shorten existing Pro: a permanent-Pro account (pro_expires_at IS
  -- NULL while already 'pro') keeps NULL; a promo-Pro account keeps whichever
  -- expiry is LATER. Only free accounts get the fresh expiry stamped.
  UPDATE public.profiles
    SET pro_expires_at = CASE
          WHEN plan = 'pro' AND pro_expires_at IS NULL THEN NULL
          WHEN plan = 'pro' THEN GREATEST(pro_expires_at, v_expires)
          ELSE v_expires
        END,
        plan = 'pro'
    WHERE id = p_user_id;

  RETURN jsonb_build_object('ok', true, 'pro_days', v_code.pro_days, 'expires_at', v_expires);
END;
$$;

-- 5. Create the launch invite: 50 people, 10 days of Pro each.
--    Change the code string / limits here as you like.
INSERT INTO public.promo_codes (code, pro_days, max_redemptions)
VALUES ('FOUNDERS50', 10, 50)
ON CONFLICT (code) DO NOTHING;
