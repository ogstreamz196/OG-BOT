CREATE OR REPLACE FUNCTION public.list_community_songs(p_offset integer DEFAULT 0, p_limit integer DEFAULT 12)
 RETURNS TABLE(id uuid, user_id uuid, title text, style text, cover_url text, audio_path text, sample_path text, stream_audio_url text, duration_seconds numeric, created_at timestamp with time zone, completed_at timestamp with time zone, status text, unlocked boolean, revealed boolean, is_variation boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT s.id, s.user_id, s.title, s.style, s.cover_url, s.audio_path, s.sample_path,
         s.stream_audio_url, s.duration_seconds, s.created_at, s.completed_at, s.status,
         s.unlocked, s.revealed, s.is_variation
  FROM public.songs s
  WHERE s.status = 'completed'
    AND s.is_public = true
    AND COALESCE(s.revealed, true) = true
    AND auth.uid() IS NOT NULL
  ORDER BY s.created_at DESC
  OFFSET GREATEST(0, COALESCE(p_offset, 0))
  LIMIT LEAST(50, GREATEST(1, COALESCE(p_limit, 12)));
$function$;