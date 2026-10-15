-- ============================================
-- REVERSA de 011_metricas_dni.sql
--
-- ⚠ DESTRUCTIVO. NO CORRER SIN OK EXPLÍCITO.
-- No toca leads. Se pierde el registro de eventos de DNI (exportarlo antes si se quiere conservar).
-- La pantalla /metricas deja de tener datos (el resto del CRM no la usa).
-- ============================================

BEGIN;
DROP TRIGGER IF EXISTS trg_leads_eventos_dni ON public.leads;
DROP FUNCTION IF EXISTS public.metricas_dni(DATE, DATE);
DROP FUNCTION IF EXISTS public.leads_registrar_evento_dni();
DROP TABLE IF EXISTS public.dni_eventos;
COMMIT;
