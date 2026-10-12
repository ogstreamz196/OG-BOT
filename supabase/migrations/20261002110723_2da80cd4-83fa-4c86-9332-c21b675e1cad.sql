CREATE TABLE public.chat_image_allowance (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_free_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.chat_image_allowance TO authenticated;
GRANT ALL ON public.chat_image_allowance TO service_role;
ALTER TABLE public.chat_image_allowance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own image allowance" ON public.chat_image_allowance
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.consume_chat_image_edit(p_user uuid, p_reference text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_last timestamptz; v_bal integer;
BEGIN
  INSERT INTO chat_image_allowance(user_id) VALUES (p_user) ON CONFLICT DO NOTHING;
  SELECT last_free_at INTO v_last FROM chat_image_allowance WHERE user_id = p_user FOR UPDATE;
  IF v_last IS NULL OR v_last <= now() - interval '4 hours' THEN
    UPDATE chat_image_allowance SET last_free_at = now(), updated_at = now() WHERE user_id = p_user;
    RETURN jsonb_build_object('free', true, 'cost', 0, 'prev_free_at', v_last);
  END IF;
  v_bal := public.deduct_coins(p_user, 2, p_reference);
  RETURN jsonb_build_object('free', false, 'cost', 2, 'balance', v_bal,
    'next_free_at', v_last + interval '4 hours');
END $$;
REVOKE ALL ON FUNCTION public.consume_chat_image_edit(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_chat_image_edit(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.refund_chat_image_edit(p_user uuid, p_free boolean, p_prev timestamptz, p_reference text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_free THEN
    UPDATE chat_image_allowance SET last_free_at = p_prev, updated_at = now() WHERE user_id = p_user;
  ELSE
    PERFORM public.refund_generation_charge(p_user, 2, p_reference);
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.refund_chat_image_edit(uuid, boolean, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_chat_image_edit(uuid, boolean, timestamptz, text) TO service_role;