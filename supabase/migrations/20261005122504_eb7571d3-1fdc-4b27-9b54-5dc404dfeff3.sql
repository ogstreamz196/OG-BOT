CREATE TABLE public.vip_promo_codes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  environment text NOT NULL,
  code text NOT NULL UNIQUE,
  stripe_promotion_code_id text NOT NULL,
  redeemed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, environment)
);
GRANT SELECT ON public.vip_promo_codes TO authenticated;
GRANT ALL ON public.vip_promo_codes TO service_role;
ALTER TABLE public.vip_promo_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own promo code" ON public.vip_promo_codes FOR SELECT TO authenticated USING (auth.uid() = user_id);