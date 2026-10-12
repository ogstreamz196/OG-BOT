CREATE TABLE public.vip_acknowledgements (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  og_vip_id text,
  plan text NOT NULL DEFAULT 'yearly',
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.vip_acknowledgements TO authenticated;
GRANT ALL ON public.vip_acknowledgements TO service_role;
ALTER TABLE public.vip_acknowledgements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Bosses view VIP acknowledgements" ON public.vip_acknowledgements
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'boss'));
CREATE POLICY "Bosses acknowledge VIPs" ON public.vip_acknowledgements
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'boss'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'boss'));
CREATE TRIGGER vip_ack_updated_at BEFORE UPDATE ON public.vip_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();