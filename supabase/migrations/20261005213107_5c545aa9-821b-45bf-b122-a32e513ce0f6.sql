REVOKE EXECUTE ON FUNCTION public.has_sports_guide_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_sports_guide_access(uuid) TO authenticated, service_role;