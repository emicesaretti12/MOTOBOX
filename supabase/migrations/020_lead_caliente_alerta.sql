-- ============================================
-- MOTOBOX — Lead caliente: asignación al instante y alerta al vendedor
--
-- Cuando un lead dice contado, tarjeta o anticipo, o el BCRA da apto, se marca caliente_at y, si no tiene
-- vendedor, se le asigna uno por turnos (misma regla que 009). El CRM muestra una alerta al vendedor hasta que
-- lo pase a contactado. Usa el flag asignacion_automatica_activa. Reversa: 020_lead_caliente_alerta.down.sql
-- ============================================

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS caliente_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.leads_marcar_caliente()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_vendedor UUID;
  v_nombre TEXT;
BEGIN
  IF NEW.caliente_at IS NOT NULL
     OR NOT (NEW.forma_pago IN ('contado', 'tarjeta', 'anticipo_cuotas') OR NEW.bcra_resultado = 'apto')
     OR NEW.estado IN ('venta_cerrada', 'perdido') THEN
    RETURN NEW;
  END IF;
  NEW.caliente_at := now();

  IF NEW.vendedor_asignado IS NULL AND public.crm_flag('asignacion_automatica_activa') THEN
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext('motobox_asignacion_round_robin'));
      v_vendedor := public.asignacion_siguiente_vendedor();
      IF v_vendedor IS NOT NULL THEN
        NEW.vendedor_asignado := v_vendedor;
        IF TG_OP = 'UPDATE' THEN
          INSERT INTO public.asignaciones_lead (lead_id, vendedor_id, motivo) VALUES (NEW.id, v_vendedor, 'lead_caliente');
          SELECT full_name INTO v_nombre FROM public.profiles WHERE id = v_vendedor;
          INSERT INTO public.historial_cambios (lead_id, usuario_id, campo, valor_anterior, valor_nuevo)
          VALUES (NEW.id, NULL, 'Asignación automática', NULL, format('%s (por turno, lead caliente)', v_nombre));
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NEW.vendedor_asignado := NULL;
      RAISE WARNING 'asignacion lead caliente no aplicada (%)', SQLSTATE;
    END;
  END IF;
  RETURN NEW;
END;
$$;

-- En el INSERT el lead todavía no existe para la FK de asignaciones_lead: se registra después.
CREATE OR REPLACE FUNCTION public.leads_registrar_asignacion_caliente()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.asignaciones_lead (lead_id, vendedor_id, motivo) VALUES (NEW.id, NEW.vendedor_asignado, 'lead_caliente');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_marcar_caliente ON public.leads;
CREATE TRIGGER trg_leads_marcar_caliente
  BEFORE INSERT OR UPDATE OF forma_pago, bcra_resultado ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.leads_marcar_caliente();

DROP TRIGGER IF EXISTS trg_leads_registrar_asignacion_caliente ON public.leads;
CREATE TRIGGER trg_leads_registrar_asignacion_caliente
  AFTER INSERT ON public.leads
  FOR EACH ROW WHEN (NEW.caliente_at IS NOT NULL AND NEW.vendedor_asignado IS NOT NULL)
  EXECUTE FUNCTION public.leads_registrar_asignacion_caliente();

REVOKE ALL ON FUNCTION public.leads_marcar_caliente() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.leads_registrar_asignacion_caliente() FROM PUBLIC, anon, authenticated;
