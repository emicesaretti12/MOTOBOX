-- ============================================
-- REVERSA de 009_asignacion_round_robin.sql
--
-- ⚠ DESTRUCTIVO. NO CORRER SIN OK EXPLÍCITO.
-- Antes, lo normal es apagar el interruptor (instantáneo, no toca datos):
--   UPDATE public.crm_config SET valor = 'false', updated_at = now() WHERE clave = 'asignacion_automatica_activa';
-- Los vendedores ya asignados a leads NO se desasignan: quedan como están.
-- Se pierde el registro de asignaciones automáticas (exportarlo antes si se quiere conservar).
-- ============================================

BEGIN;
DROP TRIGGER IF EXISTS trg_leads_asignar_al_aprobar ON public.leads;
DROP FUNCTION IF EXISTS public.leads_asignar_al_aprobar();
DROP FUNCTION IF EXISTS public.asignacion_siguiente_vendedor();
DROP TABLE IF EXISTS public.asignaciones_lead;
DELETE FROM public.crm_config WHERE clave = 'asignacion_automatica_activa';
ALTER TABLE public.profiles DROP COLUMN IF EXISTS recibe_leads;
COMMIT;
