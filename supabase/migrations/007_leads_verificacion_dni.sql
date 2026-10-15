-- ============================================
-- MOTOBOX — Columnas de verificación de DNI en leads
--
-- YA APLICADA EN PRODUCCIÓN (15/10/2026, migración "leads_campos_verificacion_dni").
-- Este archivo deja el esquema real documentado en el repo para poder reproducirlo
-- en otro entorno. Es idempotente: correrlo de nuevo no cambia nada.
--
-- También documenta dos diferencias que producción ya tenía respecto de 001/002:
--   * leads.manychat_subscriber_id (integración ManyChat, hoy en desuso).
--   * historial_cambios.usuario_id acepta NULL (los webhooks escriben sin usuario logueado).
-- ============================================

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS manychat_subscriber_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS leads_manychat_subscriber_id_idx
  ON public.leads (manychat_subscriber_id) WHERE manychat_subscriber_id IS NOT NULL;

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS dni TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS estado_dni TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS dni_titular_relacion TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS dni_intentos INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS monto_aprobado NUMERIC;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS sendpulse_contact_id TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS dni_actualizado_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE public.leads ADD CONSTRAINT leads_estado_dni_check
    CHECK (estado_dni IS NULL OR estado_dni = ANY (ARRAY['pendiente', 'aprobado', 'rechazado']));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS leads_estado_dni_idx
  ON public.leads (estado_dni) WHERE estado_dni IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_sendpulse_contact_idx
  ON public.leads (sendpulse_contact_id) WHERE sendpulse_contact_id IS NOT NULL;

ALTER TABLE public.historial_cambios ALTER COLUMN usuario_id DROP NOT NULL;
