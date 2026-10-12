CREATE TABLE public.boss_presence_alerts (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('app','battle')),
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind)
);
GRANT ALL ON public.boss_presence_alerts TO service_role;
ALTER TABLE public.boss_presence_alerts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.claim_presence_alert(p_user uuid, p_kind text, p_cooldown_minutes integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  INSERT INTO public.boss_presence_alerts(user_id, kind, last_sent_at)
  VALUES (p_user, p_kind, now())
  ON CONFLICT (user_id, kind) DO UPDATE SET last_sent_at = now()
  WHERE boss_presence_alerts.last_sent_at < now() - make_interval(mins => p_cooldown_minutes);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END $$;
REVOKE ALL ON FUNCTION public.claim_presence_alert(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_presence_alert(uuid, text, integer) TO service_role;