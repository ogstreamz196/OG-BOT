-- Cancelling an in-flight song as one atomic step.
--
-- suno-cancel used to (a) refund app_settings.coins_per_generation or the
-- portal's coin_cost_per_generation, although creation is free, so a portal
-- song could be started and cancelled repeatedly for free coins, while a paid
-- edit (2 coins) got no refund at all because the setting is 0 and the refund
-- RPC rejects 0; (b) check status and then update, so two quick cancel taps
-- could both refund; and (c) leave next_retry_at/failure_class set, so the
-- auto-retry worker could resubmit a song the user had cancelled.
--
-- Now: the status flip is the claim (only one cancel wins), the song is marked
-- terminal so it is never auto-retried, and the refund is exactly the edit
-- charge taken for this run, if any, at most once.

CREATE OR REPLACE FUNCTION public.cancel_song_generation(p_user uuid, p_song uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  started timestamptz;
  owner_id uuid;
  charge record;
  refund_ref text;
  new_balance integer;
BEGIN
  IF p_user IS NULL OR p_song IS NULL THEN
    RAISE EXCEPTION 'user_and_song_required';
  END IF;

  SELECT user_id INTO owner_id FROM public.songs WHERE id = p_song;
  IF owner_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF owner_id <> p_user THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  UPDATE public.songs
     SET status = 'failed',
         error_message = 'Cancelled by user',
         suno_task_id = NULL,
         failure_class = 'terminal',
         next_retry_at = NULL
   WHERE id = p_song
     AND user_id = p_user
     AND status IN ('pending', 'processing')
  RETURNING generation_started_at INTO started;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'refunded', 0);
  END IF;

  -- The only charge a generation run can carry is the edit fee suno-generate
  -- takes with reference 'edit:<song id>:<run start>'.
  SELECT amount, reference INTO charge
    FROM public.coin_transactions
   WHERE user_id = p_user
     AND type = 'generation'
     AND amount < 0
     AND reference LIKE 'edit:' || p_song::text || ':%'
     AND (started IS NULL OR created_at >= started - interval '2 minutes')
   ORDER BY created_at DESC
   LIMIT 1;

  IF charge.reference IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'already', false, 'refunded', 0);
  END IF;

  refund_ref := 'cancel:' || charge.reference;
  IF EXISTS (
    SELECT 1 FROM public.coin_transactions
     WHERE user_id = p_user AND type = 'refund' AND reference = refund_ref
  ) THEN
    RETURN jsonb_build_object('ok', true, 'already', false, 'refunded', 0);
  END IF;

  UPDATE public.profiles
     SET coin_balance = coin_balance + (-charge.amount)
   WHERE id = p_user
  RETURNING coin_balance INTO new_balance;

  INSERT INTO public.coin_transactions(user_id, amount, type, reference)
  VALUES (p_user, -charge.amount, 'refund', refund_ref);

  RETURN jsonb_build_object(
    'ok', true,
    'already', false,
    'refunded', -charge.amount,
    'coin_balance', new_balance
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_song_generation(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_song_generation(uuid, uuid) TO service_role;
