-- Trade-signal "hold on" lines live in the shared catchphrase bank as kind
-- 'trade_hold'. {m} is replaced with the market name when sent. Every user is
-- only ever given lines they haven't seen; the app adds new lines (AI-written
-- or built from fragments) when a user's unseen supply runs low, and those
-- join the bank for everyone.

ALTER TABLE public.bot_catchphrases DROP CONSTRAINT IF EXISTS bot_catchphrases_kind_check;
ALTER TABLE public.bot_catchphrases ADD CONSTRAINT bot_catchphrases_kind_check
  CHECK (kind IN ('opener','closer','roast','trade_hold'));

-- Picks one line this user has never had and records it as seen in the same
-- step. If two requests race for the same line, the loser tries another.
-- Returns {"phrase": text|null, "left": int}; phrase is null when the user
-- has seen every line for this tone (the app then adds a fresh one).
CREATE OR REPLACE FUNCTION public.pick_trade_hold(p_user uuid, p_tone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_phrase text;
  v_rows int;
  v_left int;
  v_try int := 0;
BEGIN
  LOOP
    v_try := v_try + 1;
    SELECT c.id, c.phrase INTO v_id, v_phrase FROM bot_catchphrases c
     WHERE c.kind = 'trade_hold' AND c.tone = p_tone AND c.enabled
       AND NOT EXISTS (
         SELECT 1 FROM bot_catchphrase_seen s WHERE s.user_id = p_user AND s.phrase_id = c.id)
     ORDER BY random() LIMIT 1;
    EXIT WHEN v_id IS NULL;
    INSERT INTO bot_catchphrase_seen(user_id, phrase_id) VALUES (p_user, v_id)
      ON CONFLICT (user_id, phrase_id) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 1 THEN
      UPDATE bot_catchphrases SET times_used = times_used + 1 WHERE id = v_id;
      EXIT;
    END IF;
    v_id := NULL;
    v_phrase := NULL;
    EXIT WHEN v_try >= 5;
  END LOOP;

  SELECT count(*) INTO v_left FROM bot_catchphrases c
   WHERE c.kind = 'trade_hold' AND c.tone = p_tone AND c.enabled
     AND NOT EXISTS (
       SELECT 1 FROM bot_catchphrase_seen s WHERE s.user_id = p_user AND s.phrase_id = c.id);

  RETURN jsonb_build_object('phrase', v_phrase, 'left', v_left);
END $$;
REVOKE ALL ON FUNCTION public.pick_trade_hold(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pick_trade_hold(uuid, text) TO service_role;

INSERT INTO public.bot_catchphrases(kind, tone, phrase) VALUES
('trade_hold','foul','⏳ Hold your horses, you impatient sod. Pulling live {m} charts and grilling every timeframe. Honest signal lands in my next message, no bullshit.'),
('trade_hold','foul','⏳ Chill, for fuck''s sake. I''m ripping through {m} price action right now. Next message is the real signal, straight up.'),
('trade_hold','foul','⏳ Sit tight, bellend. Scanning {m} across every timeframe so I don''t feed you shite. Signal''s coming next.'),
('trade_hold','foul','⏳ Easy, you greedy bastard. Checking live {m} levels and the news. The honest call drops in my next message.'),
('trade_hold','foul','⏳ Oi, patience. Dissecting the {m} chart candle by fucking candle. Real signal in my next message.'),
('trade_hold','foul','⏳ Put the kettle on, you degenerate. Crunching {m} numbers properly. Next message is the honest call.'),
('trade_hold','foul','⏳ Calm your tits. I''m reading {m} like a bloody bible right now. Signal follows in a sec.'),
('trade_hold','foul','⏳ Hang about, you money-hungry muppet. Pulling fresh {m} data, no guesswork. Signal''s next.'),
('trade_hold','foul','⏳ Don''t rush me, you absolute melt. Checking {m} on every timeframe. Honest signal coming up next.'),
('trade_hold','foul','⏳ Bloody hell, give me a second. Scanning live {m} prices and the headlines. Real call in my next message.'),
('trade_hold','foul','⏳ Keep your knickers on. Digging through {m} so I don''t mug you off. Signal lands next.'),
('trade_hold','foul','⏳ Woah there, cowboy. Grilling the {m} chart for the most honest read going. Next message, I promise.'),
('trade_hold','foul','⏳ Shush a sec, you chancer. Running the numbers on {m} right now. Proper signal follows.'),
('trade_hold','foul','⏳ Christ, you''re keen. Checking {m} momentum and levels. The no-bullshit call is my next message.'),
('trade_hold','foul','⏳ Sit down, you degen. Scanning {m} top to bottom. Honest signal in a moment.'),
('trade_hold','cheeky','⏳ Easy tiger. Pulling live {m} charts and checking every timeframe for the most honest read I can give. Signal lands in my next message.'),
('trade_hold','cheeky','⏳ Kettle on, feet up. I''m scanning {m} right now. Next message is your signal, no fluff.'),
('trade_hold','cheeky','⏳ Hold tight, chief. Crunching live {m} price action. The honest call is coming in my next message.'),
('trade_hold','cheeky','⏳ Two secs, I''m not a magician. Reading the {m} charts properly. Signal follows in my next message.'),
('trade_hold','cheeky','⏳ Patience, grasshopper. Checking {m} across every timeframe. Your signal''s up next.'),
('trade_hold','cheeky','⏳ Steady on, money bags. Pulling fresh {m} data now. The honest read comes next.'),
('trade_hold','cheeky','⏳ One sec, boss. I''m giving the {m} chart a proper once-over. Signal in my next message.'),
('trade_hold','cheeky','⏳ Calm down, Wolf of Wall Street. Scanning {m} levels and the news. Next message is the call.'),
('trade_hold','cheeky','⏳ Hang tight, legend. Running the numbers on {m}. Honest signal coming right up.'),
('trade_hold','cheeky','⏳ Don''t blink. I''m reading {m} candle by candle. Your signal''s in the next message.'),
('trade_hold','cheeky','⏳ Brew''s brewing, charts are loading. Checking live {m} for you. Signal follows.'),
('trade_hold','cheeky','⏳ Slow your roll. Grilling the {m} chart so you get the honest version. Next message.'),
('trade_hold','cheeky','⏳ Give us a mo. Pulling {m} prices and momentum. The real call comes next.'),
('trade_hold','cheeky','⏳ Easy does it. Scanning {m} on every timeframe. Signal lands in a sec.'),
('trade_hold','cheeky','⏳ Hold your horses, champ. Checking live {m} levels. Honest signal in my next message.'),
('trade_hold','safe','⏳ On it. I''m pulling live {m} prices and checking each timeframe so the signal is honest. It''ll be in my next message.'),
('trade_hold','safe','⏳ One moment while I scan live {m} data and the latest news. Your signal follows in my next message.'),
('trade_hold','safe','⏳ Checking the {m} charts across timeframes now. The full signal will be my next message.'),
('trade_hold','safe','⏳ Give me a moment to analyse {m} properly. Your signal is coming in my next message.'),
('trade_hold','safe','⏳ Pulling the latest {m} prices now. I''ll send an honest signal in my next message.'),
('trade_hold','safe','⏳ Reviewing {m} trend, momentum and key levels. Signal follows shortly.'),
('trade_hold','safe','⏳ Thanks for waiting. Analysing live {m} data. Your signal is next.'),
('trade_hold','safe','⏳ Looking at {m} on several timeframes now. The signal will follow in my next message.'),
('trade_hold','safe','⏳ Just a moment. Checking {m} prices and today''s headlines. Signal coming next.'),
('trade_hold','safe','⏳ Running the {m} analysis now so the signal is accurate. It''s my next message.'),
('trade_hold','safe','⏳ Fetching live {m} data. I''ll share the most honest read I can in my next message.'),
('trade_hold','safe','⏳ Working on your {m} signal now. It will arrive in my next message.'),
('trade_hold','safe','⏳ Scanning {m} support, resistance and trend. Your signal follows.'),
('trade_hold','safe','⏳ Please hold on while I check {m}. The signal is on its way.'),
('trade_hold','safe','⏳ Analysing {m} across timeframes for an honest signal. Next message.')
ON CONFLICT (kind, tone, phrase) DO NOTHING;
