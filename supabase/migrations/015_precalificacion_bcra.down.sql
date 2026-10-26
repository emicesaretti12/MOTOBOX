-- Deshace 015_precalificacion_bcra.sql. Borra las columnas bcra_* (se pierde el historial de precalificación).
-- Antes, apagar: UPDATE public.crm_config SET valor = 'false' WHERE clave = 'precalif_bcra_activa';
DELETE FROM public.crm_config WHERE clave IN ('precalif_bcra_activa', 'precalif_situacion_maxima', 'precalif_intentos_max');
DROP INDEX IF EXISTS public.leads_bcra_resultado_idx;
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_bcra_situacion_check;
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_bcra_resultado_check;
ALTER TABLE public.leads DROP COLUMN IF EXISTS bcra_consultado_at;
ALTER TABLE public.leads DROP COLUMN IF EXISTS bcra_situacion;
ALTER TABLE public.leads DROP COLUMN IF EXISTS bcra_resultado;
