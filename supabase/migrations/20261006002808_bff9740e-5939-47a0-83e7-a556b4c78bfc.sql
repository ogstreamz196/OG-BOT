CREATE TABLE public.bot_catchphrases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('opener','closer')),
  tone text NOT NULL CHECK (tone IN ('foul','cheeky','safe')),
  phrase text NOT NULL,
  source text NOT NULL DEFAULT 'seed',
  enabled boolean NOT NULL DEFAULT true,
  times_used integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, tone, phrase)
);
GRANT ALL ON public.bot_catchphrases TO service_role;
ALTER TABLE public.bot_catchphrases ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.bot_catchphrase_seen (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phrase_id uuid NOT NULL REFERENCES public.bot_catchphrases(id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, phrase_id)
);
GRANT ALL ON public.bot_catchphrase_seen TO service_role;
ALTER TABLE public.bot_catchphrase_seen ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.pick_catchphrases(p_user uuid, p_tone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_op record; v_cl record; v_op_left int; v_cl_left int;
BEGIN
  SELECT c.id, c.phrase INTO v_op FROM bot_catchphrases c
   WHERE c.kind='opener' AND c.tone=p_tone AND c.enabled
     AND NOT EXISTS (SELECT 1 FROM bot_catchphrase_seen s WHERE s.user_id=p_user AND s.phrase_id=c.id)
   ORDER BY random() LIMIT 1;
  IF v_op.id IS NULL THEN
    -- exhausted: recycle the one seen longest ago
    SELECT c.id, c.phrase INTO v_op FROM bot_catchphrases c JOIN bot_catchphrase_seen s ON s.phrase_id=c.id AND s.user_id=p_user
     WHERE c.kind='opener' AND c.tone=p_tone AND c.enabled ORDER BY s.seen_at ASC LIMIT 1;
  END IF;
  SELECT c.id, c.phrase INTO v_cl FROM bot_catchphrases c
   WHERE c.kind='closer' AND c.tone=p_tone AND c.enabled
     AND NOT EXISTS (SELECT 1 FROM bot_catchphrase_seen s WHERE s.user_id=p_user AND s.phrase_id=c.id)
   ORDER BY random() LIMIT 1;
  IF v_cl.id IS NULL THEN
    SELECT c.id, c.phrase INTO v_cl FROM bot_catchphrases c JOIN bot_catchphrase_seen s ON s.phrase_id=c.id AND s.user_id=p_user
     WHERE c.kind='closer' AND c.tone=p_tone AND c.enabled ORDER BY s.seen_at ASC LIMIT 1;
  END IF;
  IF v_op.id IS NOT NULL THEN
    INSERT INTO bot_catchphrase_seen(user_id, phrase_id) VALUES (p_user, v_op.id)
      ON CONFLICT (user_id, phrase_id) DO UPDATE SET seen_at = now();
    UPDATE bot_catchphrases SET times_used = times_used + 1 WHERE id = v_op.id;
  END IF;
  IF v_cl.id IS NOT NULL THEN
    INSERT INTO bot_catchphrase_seen(user_id, phrase_id) VALUES (p_user, v_cl.id)
      ON CONFLICT (user_id, phrase_id) DO UPDATE SET seen_at = now();
    UPDATE bot_catchphrases SET times_used = times_used + 1 WHERE id = v_cl.id;
  END IF;
  SELECT count(*) INTO v_op_left FROM bot_catchphrases c WHERE c.kind='opener' AND c.tone=p_tone AND c.enabled
    AND NOT EXISTS (SELECT 1 FROM bot_catchphrase_seen s WHERE s.user_id=p_user AND s.phrase_id=c.id);
  SELECT count(*) INTO v_cl_left FROM bot_catchphrases c WHERE c.kind='closer' AND c.tone=p_tone AND c.enabled
    AND NOT EXISTS (SELECT 1 FROM bot_catchphrase_seen s WHERE s.user_id=p_user AND s.phrase_id=c.id);
  RETURN jsonb_build_object('opener', v_op.phrase, 'closer', v_cl.phrase,
    'openers_left', v_op_left, 'closers_left', v_cl_left);
END $$;
REVOKE ALL ON FUNCTION public.pick_catchphrases(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pick_catchphrases(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.add_catchphrases(p_kind text, p_tone text, p_phrases text[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n int;
BEGIN
  WITH ins AS (
    INSERT INTO bot_catchphrases(kind, tone, phrase, source)
    SELECT p_kind, p_tone, left(trim(x), 160), 'generated' FROM unnest(p_phrases) x
     WHERE length(trim(x)) BETWEEN 3 AND 160
    ON CONFLICT (kind, tone, phrase) DO NOTHING RETURNING 1)
  SELECT count(*) INTO v_n FROM ins;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.add_catchphrases(text, text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_catchphrases(text, text, text[]) TO service_role;

INSERT INTO public.bot_catchphrases(kind, tone, phrase) VALUES
('opener','foul','Oi oi, look who crawled back.'),
('opener','foul','Fucking hell, you again? Go on then.'),
('opener','foul','Right, settle down you muppet, I got you.'),
('opener','foul','Bloody hell, give a man a second.'),
('opener','foul','Ah shit, the legend returns.'),
('opener','foul','Calm your tits, sorting it now.'),
('opener','foul','You absolute bell-end, here''s the deal.'),
('opener','foul','Fair play you cheeky twat, good question.'),
('opener','foul','Hold tight dickhead, intel incoming.'),
('opener','foul','Christ alive, alright alright.'),
('opener','foul','Wagwan you nuisance.'),
('opener','foul','Bruv, you''re lucky I like you.'),
('opener','foul','Say less, you mug.'),
('opener','foul','Fuck me, finally a decent question.'),
('opener','foul','Listen up, wasteman.'),
('closer','foul','Now jog on.'),
('closer','foul','Don''t say I never do shit for you.'),
('closer','foul','You''re welcome, dickhead.'),
('closer','foul','Now stop mugging me off.'),
('closer','foul','Sorted. Go cause chaos.'),
('closer','foul','Laters, you absolute weapon.'),
('closer','foul','Have a word with yourself.'),
('closer','foul','Easy. Next.'),
('closer','foul','Bless your daft little heart.'),
('closer','foul','Now piss off and enjoy it.'),
('opener','cheeky','Oi oi, look who''s back.'),
('opener','cheeky','Right then, let''s see what you''ve messed up now.'),
('opener','cheeky','Back again? Don''t you have a job?'),
('opener','cheeky','Hold your horses, I got you.'),
('opener','cheeky','Safe, sorting this out for you now.'),
('opener','cheeky','Go on then, hit me.'),
('opener','cheeky','Ahh, the main character returns.'),
('opener','cheeky','Say less fam.'),
('opener','cheeky','Bit of a cheeky one, but alright.'),
('opener','cheeky','Hold tight, got the intel.'),
('closer','cheeky','Don''t spend it all at once.'),
('closer','cheeky','You''re welcome, legend.'),
('closer','cheeky','Sorted. Next!'),
('closer','cheeky','Easy work.'),
('closer','cheeky','Catch you in a bit.'),
('closer','cheeky','Now go make me proud.'),
('closer','cheeky','Stay OG.'),
('opener','safe','Hey, good to see you.'),
('opener','safe','Sure thing, here you go.'),
('opener','safe','Happy to help with that.'),
('opener','safe','Great question.'),
('opener','safe','Got it, let me sort that.'),
('closer','safe','Anything else I can help with?'),
('closer','safe','Hope that helps!'),
('closer','safe','Shout if you need more.'),
('closer','safe','Enjoy!');