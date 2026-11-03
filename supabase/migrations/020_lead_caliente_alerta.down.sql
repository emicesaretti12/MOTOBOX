DROP TRIGGER IF EXISTS trg_leads_registrar_asignacion_caliente ON public.leads;
DROP TRIGGER IF EXISTS trg_leads_marcar_caliente ON public.leads;
DROP FUNCTION IF EXISTS public.leads_registrar_asignacion_caliente();
DROP FUNCTION IF EXISTS public.leads_marcar_caliente();
ALTER TABLE public.leads DROP COLUMN IF EXISTS caliente_at;
