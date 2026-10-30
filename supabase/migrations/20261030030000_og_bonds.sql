-- OG B0T's friendships: how much OG B0T likes (or can't stand) each member.
-- Compliments and good chat raise it, insults lower it, and it drifts back
-- toward neutral over time (grudges and friendships both fade if you vanish).
-- Server-only: never shown to anyone, members included.
CREATE TABLE IF NOT EXISTS public.og_bonds (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- -100 (can't stand you) to 100 (ride or die).
  score numeric NOT NULL DEFAULT 0 CHECK (score BETWEEN -100 AND 100),
  compliments integer NOT NULL DEFAULT 0,
  insults integer NOT NULL DEFAULT 0,
  -- Plain chat only counts a few times a day, so spam doesn't buy a friend.
  chat_day date,
  chat_today integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.og_bonds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.og_bonds FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.og_bonds TO service_role;

-- Moves a member's score by p_delta after fading the old score toward 0
-- (half-life 45 days, the same as og-bond.ts). p_kind: 'compliment',
-- 'insult', 'chat' (at most 3 a day count) or anything else. Returns the
-- score before and after.
CREATE OR REPLACE FUNCTION public.og_bond_nudge(p_user_id uuid, p_delta numeric, p_kind text)
RETURNS TABLE (before_score numeric, after_score numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.og_bonds%ROWTYPE;
  faded numeric;
  today date := (now() AT TIME ZONE 'utc')::date;
BEGIN
  INSERT INTO public.og_bonds (user_id) VALUES (p_user_id) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO r FROM public.og_bonds WHERE user_id = p_user_id FOR UPDATE;
  faded := r.score * power(0.5, extract(epoch FROM (now() - r.updated_at)) / (45 * 86400));

  IF p_kind = 'chat' THEN
    IF r.chat_day IS DISTINCT FROM today THEN
      r.chat_day := today;
      r.chat_today := 0;
    END IF;
    IF r.chat_today >= 3 THEN
      RETURN QUERY SELECT faded, faded;
      RETURN;
    END IF;
    r.chat_today := r.chat_today + 1;
  END IF;

  UPDATE public.og_bonds SET
    score = greatest(-100, least(100, faded + p_delta)),
    compliments = compliments + CASE WHEN p_kind = 'compliment' THEN 1 ELSE 0 END,
    insults = insults + CASE WHEN p_kind = 'insult' THEN 1 ELSE 0 END,
    chat_day = r.chat_day,
    chat_today = r.chat_today,
    updated_at = now()
  WHERE user_id = p_user_id;

  RETURN QUERY SELECT faded, greatest(-100, least(100, faded + p_delta));
END;
$$;

REVOKE ALL ON FUNCTION public.og_bond_nudge(uuid, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.og_bond_nudge(uuid, numeric, text) TO service_role;
