-- ============================================
-- REVERSA de 008_cola_verificacion_dni.sql
--
-- ⚠ DESTRUCTIVO. NO CORRER SIN OK EXPLÍCITO DEL RESPONSABLE DEL CRM.
-- Borra solo los objetos que creó la 008. No toca leads, profiles (salvo la columna nueva
-- verifica_dni) ni ninguna otra tabla existente.
-- Se pierde el registro de resoluciones (quién aprobó/rechazó y el estado del aviso):
-- exportalo antes si lo querés conservar:
--   CREATE TABLE backup_YYYYMMDD.dni_resoluciones AS SELECT * FROM public.dni_resoluciones;
--
-- Antes de esto, el paso normal para volver atrás es apagar los interruptores:
--   UPDATE public.crm_config SET valor = 'false', updated_at = now()
--    WHERE clave IN ('cola_dni_activa', 'aviso_sendpulse_activo');
-- y volver a desplegar sendpulse-whatsapp-webhook v2 (commit de la Etapa 0).
-- ============================================

BEGIN;

DROP FUNCTION IF EXISTS public.dni_webhook_resultado(TEXT, TEXT, TEXT, NUMERIC);
DROP FUNCTION IF EXISTS public.dni_webhook_recibido(TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.dni_registrar_aviso(UUID, BOOLEAN, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.dni_marcar_avisado_manual(UUID);
DROP FUNCTION IF EXISTS public.dni_preparar_reintento(UUID);
DROP FUNCTION IF EXISTS public.dni_avisos_pendientes();
DROP FUNCTION IF EXISTS public.dni_resolver(UUID, INTEGER, TEXT, NUMERIC);
DROP FUNCTION IF EXISTS public.dni_soltar(UUID);
DROP FUNCTION IF EXISTS public.dni_tomar(UUID, INTEGER);
DROP FUNCTION IF EXISTS public.dni_cola_listar();
DROP FUNCTION IF EXISTS public.dni_buscar_lead(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.puede_verificar_dni();
DROP FUNCTION IF EXISTS public.crm_clave_telefono(TEXT);
DROP FUNCTION IF EXISTS public.dni_enmascarar(TEXT);
DROP FUNCTION IF EXISTS public.crm_formato_monto(NUMERIC);
DROP FUNCTION IF EXISTS public.crm_ahora_texto();
DROP FUNCTION IF EXISTS public.crm_numero(TEXT, NUMERIC);
DROP FUNCTION IF EXISTS public.crm_flag(TEXT);

DROP TABLE IF EXISTS public.dni_tomas;
DROP TABLE IF EXISTS public.dni_resoluciones;
DROP TABLE IF EXISTS public.crm_config;

ALTER TABLE public.profiles DROP COLUMN IF EXISTS verifica_dni;

COMMIT;
