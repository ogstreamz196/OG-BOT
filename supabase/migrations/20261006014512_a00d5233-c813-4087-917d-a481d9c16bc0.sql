ALTER TABLE public.bot_catchphrases DROP CONSTRAINT IF EXISTS bot_catchphrases_kind_check;
ALTER TABLE public.bot_catchphrases ADD CONSTRAINT bot_catchphrases_kind_check CHECK (kind IN ('opener','closer','roast'));

CREATE OR REPLACE FUNCTION public.pick_roasts(p_user uuid, p_tone text, p_n int DEFAULT 2)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ids uuid[]; v_phr text[]; v_left int; v_need int;
BEGIN
  SELECT array_agg(id), array_agg(phrase) INTO v_ids, v_phr FROM (
    SELECT c.id, c.phrase FROM bot_catchphrases c
     WHERE c.kind='roast' AND c.tone=p_tone AND c.enabled
       AND NOT EXISTS (SELECT 1 FROM bot_catchphrase_seen s WHERE s.user_id=p_user AND s.phrase_id=c.id)
     ORDER BY random() LIMIT greatest(1, least(p_n, 4))) x;
  v_need := greatest(1, least(p_n,4)) - coalesce(array_length(v_ids,1),0);
  IF v_need > 0 THEN
    SELECT coalesce(v_ids,'{}') || array_agg(id), coalesce(v_phr,'{}') || array_agg(phrase) INTO v_ids, v_phr FROM (
      SELECT c.id, c.phrase FROM bot_catchphrases c JOIN bot_catchphrase_seen s ON s.phrase_id=c.id AND s.user_id=p_user
       WHERE c.kind='roast' AND c.tone=p_tone AND c.enabled AND NOT (c.id = ANY(coalesce(v_ids,'{}')))
       ORDER BY s.seen_at ASC LIMIT v_need) y;
  END IF;
  IF v_ids IS NOT NULL THEN
    INSERT INTO bot_catchphrase_seen(user_id, phrase_id) SELECT p_user, unnest(v_ids)
      ON CONFLICT (user_id, phrase_id) DO UPDATE SET seen_at = now();
    UPDATE bot_catchphrases SET times_used = times_used + 1 WHERE id = ANY(v_ids);
  END IF;
  SELECT count(*) INTO v_left FROM bot_catchphrases c WHERE c.kind='roast' AND c.tone=p_tone AND c.enabled
    AND NOT EXISTS (SELECT 1 FROM bot_catchphrase_seen s WHERE s.user_id=p_user AND s.phrase_id=c.id);
  RETURN jsonb_build_object('roasts', to_jsonb(coalesce(v_phr,'{}')), 'left', v_left);
END $$;
REVOKE ALL ON FUNCTION public.pick_roasts(uuid, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pick_roasts(uuid, text, int) TO service_role;

INSERT INTO public.bot_catchphrases(kind, tone, phrase) VALUES
('roast','foul','You''ve got the attention span of a fucking goldfish on Red Bull.'),
('roast','foul','If brains were petrol you couldn''t fuel a pissing moped.'),
('roast','foul','You ask questions like you''re paying me by the hour, you tight git.'),
('roast','foul','Your search history must be a fucking crime scene.'),
('roast','foul','Mate, Google exists, but fine, I''ll be your unpaid PA.'),
('roast','foul','You type like your thumbs are wearing oven gloves.'),
('roast','foul','You''re the human version of a buffering video.'),
('roast','foul','Honestly, how have you survived this long without me, you plonker?'),
('roast','foul','You''ve got more front than Brighton beach.'),
('roast','foul','You''re about as useful as a chocolate teapot, but I love you.'),
('roast','foul','Your spelling just gave me a fucking migraine.'),
('roast','foul','You walk into rooms and forget why, don''t you, you melt.'),
('roast','foul','If laziness was an Olympic sport you''d still not turn up.'),
('roast','foul','You''ve got the energy of a wet sock on a Monday.'),
('roast','foul','Bless you, you''re trying so hard and still fucking it up.'),
('roast','foul','You''re the reason shampoo has instructions.'),
('roast','foul','Even your Wi-Fi is embarrassed to be connected to you.'),
('roast','foul','You''re not the sharpest tool in the shed, you''re the fucking shed.'),
('roast','foul','Your mum still does your washing, doesn''t she, you big baby.'),
('roast','foul','You''ve got a face for radio and a voice for silent films.'),
('roast','foul','Asking me that is peak bell-end behaviour, but go on.'),
('roast','foul','You couldn''t organise a piss-up in a brewery.'),
('roast','foul','You''ve been on your phone all day and that''s the best you''ve got?'),
('roast','foul','Your brain''s running on Internet Explorer, innit.'),
('roast','foul','You absolute sausage roll of a human.'),
('roast','foul','You''re one bad decision away from a Channel 5 documentary.'),
('roast','foul','You have the strategic mind of a pigeon chasing a chip.'),
('roast','foul','Proper wasteman question, that. Respect the commitment.'),
('roast','foul','You''re lucky you''re funny, because you''re fucking clueless.'),
('roast','foul','I''ve met smarter kebabs at 3am.'),
('roast','foul','You''re the type to clap when the plane lands.'),
('roast','foul','Every time you message me a Wikipedia page cries.'),
('roast','foul','Your vibe is ''forgot to charge phone overnight'' energy.'),
('roast','foul','You''ve got the patience of a toddler in Tesco.'),
('roast','foul','Some people learn from mistakes. You collect them like Pokémon.'),
('roast','cheeky','You''ve got the attention span of a goldfish on Red Bull.'),
('roast','cheeky','You type like your thumbs are wearing oven gloves.'),
('roast','cheeky','You''re the human version of a buffering video.'),
('roast','cheeky','You''ve got more front than Brighton beach.'),
('roast','cheeky','About as useful as a chocolate teapot, but I love you.'),
('roast','cheeky','Your spelling just gave me a headache.'),
('roast','cheeky','You''re the reason shampoo has instructions.'),
('roast','cheeky','Even your Wi-Fi is embarrassed to be connected to you.'),
('roast','cheeky','You couldn''t organise a party in a sweet shop.'),
('roast','cheeky','Your brain''s running on Internet Explorer, innit.'),
('roast','cheeky','You absolute sausage roll of a human.'),
('roast','cheeky','You have the strategic mind of a pigeon chasing a chip.'),
('roast','cheeky','I''ve met smarter kebabs at 3am.'),
('roast','cheeky','You''re the type to clap when the plane lands.'),
('roast','cheeky','You''ve got the patience of a toddler in Tesco.'),
('roast','cheeky','Some people learn from mistakes. You collect them like Pokémon.'),
('roast','cheeky','Google exists, but fine, I''ll be your unpaid PA.'),
('roast','cheeky','You''ve got the energy of a wet sock on a Monday.'),
('roast','cheeky','Your mum still does your washing, doesn''t she?'),
('roast','cheeky','You''re one bad decision from a Channel 5 documentary.'),
('roast','safe','Bold question. Brave, even.'),
('roast','safe','You''ve kept me on my toes today.'),
('roast','safe','I see you like a challenge.'),
('roast','safe','Good thing you''ve got me, eh?'),
('roast','safe','That''s a classic, I''ll allow it.')
ON CONFLICT (kind, tone, phrase) DO NOTHING;