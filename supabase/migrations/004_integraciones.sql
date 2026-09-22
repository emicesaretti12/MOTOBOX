-- ============================================================================
-- MOTOBOX CRM — Migración 004: Centro de Integraciones  (OPCIONAL)
-- ----------------------------------------------------------------------------
-- QUÉ HACE:  crea UNA tabla nueva (crm_integraciones) para que la configuración
--            de webhooks, Telegram, Slack, plantillas de WhatsApp, etc. se
--            comparta entre todos los usuarios del CRM.
--
-- QUÉ **NO** HACE:  no modifica, no borra ni migra ninguna tabla existente.
--            No toca leads, profiles, interacciones, historial_cambios,
--            ventas, clientes, inventario_motos ni configuracion_web.
--            Tus leads cargados quedan exactamente como están.
--
-- SI NO EJECUTÁS ESTA MIGRACIÓN el CRM funciona igual: la configuración de
-- integraciones se guarda en el navegador de cada usuario (localStorage).
--
-- Es 100% idempotente: se puede correr varias veces sin efectos secundarios.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.crm_integraciones (
  id          INT PRIMARY KEY DEFAULT 1,
  config      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT crm_integraciones_fila_unica CHECK (id = 1)
);

COMMENT ON TABLE public.crm_integraciones IS
  'Configuración del Centro de Integraciones del CRM (una sola fila, id = 1).';

-- ----------------------------------------------------------------------------
-- Row Level Security
--   · Cualquier usuario autenticado puede LEER la configuración
--     (los vendedores necesitan las plantillas de WhatsApp y la duración de citas).
--   · Sólo el admin puede escribirla.
-- ----------------------------------------------------------------------------
ALTER TABLE public.crm_integraciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "crm_integraciones_select" ON public.crm_integraciones;
CREATE POLICY "crm_integraciones_select"
  ON public.crm_integraciones
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "crm_integraciones_admin_write" ON public.crm_integraciones;
CREATE POLICY "crm_integraciones_admin_write"
  ON public.crm_integraciones
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ----------------------------------------------------------------------------
-- Trigger de updated_at
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_crm_integraciones_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_crm_integraciones_updated_at ON public.crm_integraciones;
CREATE TRIGGER trigger_crm_integraciones_updated_at
  BEFORE UPDATE ON public.crm_integraciones
  FOR EACH ROW EXECUTE FUNCTION public.update_crm_integraciones_updated_at();

-- ----------------------------------------------------------------------------
-- Permisos
-- ----------------------------------------------------------------------------
GRANT SELECT ON TABLE public.crm_integraciones TO authenticated;
GRANT INSERT, UPDATE ON TABLE public.crm_integraciones TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_crm_integraciones_updated_at() TO authenticated;

-- Fila inicial vacía (no pisa la configuración si ya existe).
INSERT INTO public.crm_integraciones (id, config)
VALUES (1, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- CÓMO REVERTIR (si algún día querés sacarla):
--   DROP TABLE IF EXISTS public.crm_integraciones;
--   DROP FUNCTION IF EXISTS public.update_crm_integraciones_updated_at();
-- El CRM vuelve solo a guardar la configuración en el navegador.
-- ============================================================================
