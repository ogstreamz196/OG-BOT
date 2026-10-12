CREATE TABLE public.battle_lexicon (
  word text PRIMARY KEY CHECK (char_length(word) BETWEEN 3 AND 24),
  uses integer NOT NULL DEFAULT 0,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.battle_lexicon TO service_role;
ALTER TABLE public.battle_lexicon ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.learn_battle_words(p_words text[])
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.battle_lexicon (word, uses)
  SELECT DISTINCT lower(w), 1 FROM unnest(p_words) w
  WHERE lower(w) ~ '^[a-z][a-z''-]{2,23}$'
  ON CONFLICT (word) DO UPDATE SET uses = battle_lexicon.uses + 1, last_seen = now();
$$;
REVOKE ALL ON FUNCTION public.learn_battle_words(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.learn_battle_words(text[]) TO service_role;