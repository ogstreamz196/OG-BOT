CREATE OR REPLACE FUNCTION public.set_telegram_worker(p_chat bigint, p_worker text, p_on boolean) RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
 UPDATE public.telegram_managed_groups SET active_workers = CASE WHEN p_on THEN CASE WHEN active_workers ? p_worker THEN active_workers ELSE active_workers || jsonb_build_array(p_worker) END ELSE active_workers - p_worker END, updated_at=now() WHERE chat_id=p_chat RETURNING active_workers INTO result;
 IF result IS NULL THEN RAISE EXCEPTION 'Group not found'; END IF;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.set_telegram_worker(bigint,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_telegram_worker(bigint,text,boolean) TO service_role;