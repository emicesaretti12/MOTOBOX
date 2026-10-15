-- ============================================
-- MOTOBOX — Asignación automática por turnos al aprobarse un DNI (Etapa 3)
--
-- SOLO ADITIVA: una columna nueva con default, una tabla nueva, funciones nuevas y un trigger nuevo.
-- No modifica datos existentes. Arranca APAGADA (crm_config.asignacion_automatica_activa).
-- Requiere 008. Se puede correr más de una vez.
-- Reversa: supabase/rollback/009_asignacion_round_robin_reversa.sql (solo con OK).
--
-- Regla: cuando un lead pasa a estado_dni = 'aprobado' y no tiene vendedor, se le asigna el
-- vendedor activo (rol empleado + recibe_leads) que hace más tiempo no recibe uno por turno.
-- Si ya tiene vendedor, no se toca. Queda registrado en historial_cambios y en asignaciones_lead.
-- ============================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS recibe_leads BOOLEAN NOT NULL DEFAULT false;

INSERT INTO public.crm_config (clave, valor, descripcion) VALUES
  ('asignacion_automatica_activa', 'false', 'Al aprobarse un DNI, asigna el lead por turnos a un vendedor activo (recibe_leads)')
ON CONFLICT (clave) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.asignaciones_lead (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  vendedor_id UUID NOT NULL REFERENCES public.profiles(id),
  motivo TEXT NOT NULL DEFAULT 'dni_aprobado',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS asignaciones_lead_vendedor_idx ON public.asignaciones_lead (vendedor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS asignaciones_lead_lead_idx ON public.asignaciones_lead (lead_id);

-- El vendedor activo que hace más tiempo no recibe un lead por turno (los nuevos primero).
-- VOLATILE a propósito: lee lo último confirmado aunque otra aprobación haya terminado recién.
CREATE OR REPLACE FUNCTION public.asignacion_siguiente_vendedor()
RETURNS UUID
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT p.id
    FROM public.profiles p
    LEFT JOIN LATERAL (
      SELECT max(a.created_at) AS ultima FROM public.asignaciones_lead a WHERE a.vendedor_id = p.id
    ) u ON true
   WHERE p.role = 'empleado' AND p.recibe_leads
   ORDER BY u.ultima ASC NULLS FIRST, p.created_at ASC, p.id
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.leads_asignar_al_aprobar()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_vendedor UUID;
  v_nombre TEXT;
BEGIN
  IF NOT public.crm_flag('asignacion_automatica_activa') THEN
    RETURN NEW;
  END IF;

  BEGIN
    -- Una asignación a la vez: dos aprobaciones simultáneas no le tocan al mismo vendedor.
    PERFORM pg_advisory_xact_lock(hashtext('motobox_asignacion_round_robin'));
    v_vendedor := public.asignacion_siguiente_vendedor();
    IF v_vendedor IS NULL THEN
      RETURN NEW;  -- no hay vendedores activos: queda sin asignar
    END IF;

    NEW.vendedor_asignado := v_vendedor;
    INSERT INTO public.asignaciones_lead (lead_id, vendedor_id, motivo) VALUES (NEW.id, v_vendedor, 'dni_aprobado');
    SELECT full_name INTO v_nombre FROM public.profiles WHERE id = v_vendedor;
    INSERT INTO public.historial_cambios (lead_id, usuario_id, campo, valor_anterior, valor_nuevo)
    VALUES (NEW.id, NULL, 'Asignación automática', NULL, format('%s (por turno, DNI aprobado)', v_nombre));
  EXCEPTION WHEN OTHERS THEN
    -- Nunca bloquear la aprobación: si algo falla, el lead queda sin vendedor para asignarlo a mano.
    NEW.vendedor_asignado := OLD.vendedor_asignado;
    RAISE WARNING 'asignacion automatica no aplicada (%)', SQLSTATE;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_asignar_al_aprobar ON public.leads;
CREATE TRIGGER trg_leads_asignar_al_aprobar
  BEFORE UPDATE OF estado_dni ON public.leads
  FOR EACH ROW
  WHEN (NEW.estado_dni = 'aprobado' AND OLD.estado_dni IS DISTINCT FROM 'aprobado' AND NEW.vendedor_asignado IS NULL)
  EXECUTE FUNCTION public.leads_asignar_al_aprobar();

-- Seguridad
ALTER TABLE public.asignaciones_lead ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS asignaciones_lead_leer ON public.asignaciones_lead;
CREATE POLICY asignaciones_lead_leer ON public.asignaciones_lead FOR SELECT TO authenticated
  USING (public.is_admin() OR vendedor_id = auth.uid());

REVOKE ALL ON public.asignaciones_lead FROM anon;
REVOKE ALL ON public.asignaciones_lead FROM authenticated;
GRANT SELECT ON public.asignaciones_lead TO authenticated;

REVOKE ALL ON FUNCTION public.asignacion_siguiente_vendedor() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.leads_asignar_al_aprobar() FROM PUBLIC, anon, authenticated;
