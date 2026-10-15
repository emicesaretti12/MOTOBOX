-- ============================================
-- MOTOBOX — Forma de pago, anticipo, usada y prioridad en leads
--
-- YA APLICADA EN PRODUCCIÓN (15/10/2026, migración "leads_forma_pago_anticipo_usada", hecha en paralelo
-- junto con la v4 de sendpulse-whatsapp-webhook). Este archivo documenta el resultado en el repo
-- (reconstruido desde el catálogo de la base). Es idempotente: correrlo de nuevo no cambia nada.
-- ============================================

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS forma_pago TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS anticipo TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS usada_detalle TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS prioridad TEXT;

DO $$ BEGIN
  ALTER TABLE public.leads ADD CONSTRAINT leads_forma_pago_check
    CHECK (forma_pago IS NULL OR forma_pago = ANY (ARRAY['cuotas', 'anticipo_cuotas', 'contado']));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.leads ADD CONSTRAINT leads_prioridad_check
    CHECK (prioridad IS NULL OR prioridad = ANY (ARRAY['alta', 'media', 'baja']));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
