-- Deshace 016_seguimiento_automatico.sql. Borra el historial de seguimientos.
SELECT cron.unschedule('seguimiento-auto') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'seguimiento-auto');
DROP FUNCTION IF EXISTS public.seguimiento_token_valido(TEXT);
DELETE FROM vault.secrets WHERE name = 'seguimiento_cron_token';
DELETE FROM public.crm_config WHERE clave LIKE 'seguimiento\_%';
DROP TABLE IF EXISTS public.seguimientos;
DROP INDEX IF EXISTS public.leads_bot_ultimo_evento_idx;
ALTER TABLE public.leads DROP COLUMN IF EXISTS bot_ultimo_evento_at;
-- Las extensiones pg_cron y pg_net quedan instaladas (no molestan).
