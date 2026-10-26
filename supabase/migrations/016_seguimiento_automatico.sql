-- ============================================
-- MOTOBOX — Seguimiento automático por SendPulse
--
-- * leads.bot_ultimo_evento_at: última vez que el bot avisó que el cliente respondió (lo carga el webhook v7).
-- * seguimientos: un registro por paso enviado (único por lead y paso).
-- * Supabase Cron cada 15 minutos llama a la función seguimiento-auto, SOLO si seguimiento_activo = 'true'.
-- * El secreto del cron vive en el Vault; la función lo valida con seguimiento_token_valido (solo service_role).
--
-- Arranca APAGADO. Se puede correr más de una vez. Para deshacer: 016_seguimiento_automatico.down.sql
-- ============================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS bot_ultimo_evento_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS leads_bot_ultimo_evento_idx
  ON public.leads (bot_ultimo_evento_at) WHERE bot_ultimo_evento_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.seguimientos (
  id BIGSERIAL PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  paso TEXT NOT NULL CHECK (length(paso) <= 40),
  canal TEXT NOT NULL CHECK (canal IN ('instagram', 'whatsapp')),
  estado TEXT NOT NULL DEFAULT 'enviando' CHECK (estado IN ('enviando', 'enviado', 'fallido')),
  texto TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lead_id, paso)
);
CREATE INDEX IF NOT EXISTS seguimientos_created_idx ON public.seguimientos (created_at DESC);

ALTER TABLE public.seguimientos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS seguimientos_leer ON public.seguimientos;
CREATE POLICY seguimientos_leer ON public.seguimientos FOR SELECT TO authenticated
  USING (public.is_admin() OR EXISTS (
    SELECT 1 FROM public.leads l WHERE l.id = seguimientos.lead_id AND l.vendedor_asignado = auth.uid()));
-- Solo la función (service_role) escribe.

INSERT INTO public.crm_config (clave, valor, descripcion) VALUES
  ('seguimiento_activo', 'false', 'Manda los seguimientos automáticos por SendPulse (cron cada 15 min)'),
  ('seguimiento_hora_desde', '9', 'Hora de Córdoba desde la que se mandan seguimientos'),
  ('seguimiento_hora_hasta', '21', 'Hora de Córdoba hasta la que se mandan seguimientos'),
  ('seguimiento_separacion_horas', '6', 'Horas mínimas entre dos seguimientos al mismo cliente'),
  ('seguimiento_texto_p1', '', 'Texto del recordatorio a la 1 h (vacío = texto por defecto). Admite {nombre} y {moto}'),
  ('seguimiento_texto_p2', '', 'Texto del recordatorio antes de las 24 h (vacío = texto por defecto). Admite {nombre} y {moto}'),
  ('seguimiento_flujo_p3', '', 'ID del flujo de WhatsApp (empieza con plantilla aprobada) para el día 2'),
  ('seguimiento_flujo_p4', '', 'ID del flujo de WhatsApp (empieza con plantilla aprobada) para el día 5'),
  ('seguimiento_url', 'https://szgencxcwhhjwonubika.supabase.co/functions/v1/seguimiento-auto', 'URL de la función que llama el cron')
ON CONFLICT (clave) DO NOTHING;

-- Secreto del cron (se genera una sola vez).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'seguimiento_cron_token') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'seguimiento_cron_token',
                                'Header x-cron-secret del cron de seguimiento-auto');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.seguimiento_token_valido(p_token TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(p_token, '') <> '' AND EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'seguimiento_cron_token' AND decrypted_secret = p_token);
$$;
REVOKE ALL ON FUNCTION public.seguimiento_token_valido(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seguimiento_token_valido(TEXT) TO service_role;

-- Cron: cada 15 minutos, solo si está prendido.
SELECT cron.unschedule('seguimiento-auto') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'seguimiento-auto');
SELECT cron.schedule('seguimiento-auto', '*/15 * * * *', $cron$
  SELECT net.http_post(
    url := (SELECT valor FROM public.crm_config WHERE clave = 'seguimiento_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'seguimiento_cron_token')),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000)
  WHERE EXISTS (SELECT 1 FROM public.crm_config WHERE clave = 'seguimiento_activo' AND valor = 'true');
$cron$);
