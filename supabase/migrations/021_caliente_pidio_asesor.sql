-- ============================================
-- MOTOBOX — El que pidió hablar con un asesor también es "caliente": se asigna y se alerta al vendedor
-- (el bot ya no le contesta: si nadie lo toma, queda colgado). La alerta se apaga con "Listo"
-- (caliente_atendido_at) o cuando el lead avanza a negociación / venta / perdido.
-- Reversa: 021_caliente_pidio_asesor.down.sql
-- ============================================

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS caliente_atendido_at TIMESTAMPTZ;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS caliente_motivo TEXT;

CREATE OR REPLACE FUNCTION public.leads_marcar_caliente()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_vendedor UUID;
  v_nombre TEXT;
  v_asesor BOOLEAN;
  v_pago BOOLEAN;
BEGIN
  IF NEW.estado IN ('venta_cerrada', 'perdido') THEN RETURN NEW; END IF;
  v_pago := NEW.forma_pago IN ('contado', 'tarjeta', 'anticipo_cuotas') OR NEW.bcra_resultado = 'apto';
  -- Pidió asesor recién ahora (la frase aparece en esta actualización de notas).
  v_asesor := coalesce(NEW.notas, '') ~* 'pidió hablar con un asesor'
    AND (TG_OP = 'INSERT' OR coalesce(OLD.notas, '') !~* 'pidió hablar con un asesor');

  IF NEW.caliente_at IS NULL AND v_pago THEN
    NEW.caliente_at := now();
    NEW.caliente_motivo := 'pago';
  ELSIF v_asesor THEN
    -- Vuelve a alertar aunque ya haya sido caliente antes.
    NEW.caliente_at := now();
    NEW.caliente_atendido_at := NULL;
    NEW.caliente_motivo := 'asesor';
  ELSE
    RETURN NEW;
  END IF;

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
          VALUES (NEW.id, NULL, 'Asignación automática', NULL, format('%s (por turno, %s)', v_nombre,
            CASE WHEN NEW.caliente_motivo = 'asesor' THEN 'pidió asesor' ELSE 'lead caliente' END));
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

DROP TRIGGER IF EXISTS trg_leads_marcar_caliente ON public.leads;
CREATE TRIGGER trg_leads_marcar_caliente
  BEFORE INSERT OR UPDATE OF forma_pago, bcra_resultado, notas ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.leads_marcar_caliente();

REVOKE ALL ON FUNCTION public.leads_marcar_caliente() FROM PUBLIC, anon, authenticated;
