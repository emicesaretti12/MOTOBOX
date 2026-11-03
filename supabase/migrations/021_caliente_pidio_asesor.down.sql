-- Vuelve a la versión de 020 (correr 020_lead_caliente_alerta.sql de nuevo) y borra las columnas nuevas.
ALTER TABLE public.leads DROP COLUMN IF EXISTS caliente_atendido_at;
ALTER TABLE public.leads DROP COLUMN IF EXISTS caliente_motivo;
