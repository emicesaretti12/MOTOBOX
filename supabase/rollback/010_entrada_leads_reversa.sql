-- ============================================
-- REVERSA de 010_entrada_leads.sql
--
-- ⚠ DESTRUCTIVO. NO CORRER SIN OK EXPLÍCITO.
-- Antes, lo normal es apagar el reingreso (instantáneo, no toca datos):
--   UPDATE public.crm_config SET valor = 'false', updated_at = now() WHERE clave = 'reingreso_perdidos_activo';
-- y volver a desplegar la versión anterior de la función de Instagram (v7).
--
-- Se pierden: las marcas de duplicados (exportarlas antes) y la columna leads.reingreso_at.
-- Los leads que pasaron de perdido a nuevo NO se revierten (el cambio queda en el historial).
-- dni_buscar_lead y dni_webhook_recibido vuelven a la versión de 008 (copiadas abajo).
-- ============================================

BEGIN;

-- Versiones de 008 (no usan leads_duplicados ni el reingreso)
CREATE OR REPLACE FUNCTION public.dni_buscar_lead(p_contact_id TEXT, p_telefono TEXT)
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_clave TEXT := public.crm_clave_telefono(p_telefono);
BEGIN
  IF COALESCE(p_contact_id, '') <> '' THEN
    SELECT id INTO v_id FROM public.leads
     WHERE sendpulse_contact_id = p_contact_id
     ORDER BY created_at DESC LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;
  IF length(v_clave) >= 8 THEN
    SELECT id INTO v_id FROM public.leads
     WHERE telefono IS NOT NULL AND public.crm_clave_telefono(telefono) = v_clave
     ORDER BY created_at DESC LIMIT 1;
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.dni_webhook_recibido(p_contact_id TEXT, p_telefono TEXT, p_nombre TEXT, p_dni TEXT, p_relacion TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_dni TEXT := regexp_replace(COALESCE(p_dni, ''), '\D', '', 'g');
  v_rel TEXT := left(COALESCE(NULLIF(btrim(p_relacion), ''), 'titular'), 40);
  v_contact TEXT := NULLIF(btrim(COALESCE(p_contact_id, '')), '');
  v_tel TEXT := NULLIF(btrim(COALESCE(p_telefono, '')), '');
  v_id UUID;
  v_nota TEXT;
  l public.leads;
BEGIN
  IF v_dni !~ '^\d{7,8}$' THEN RAISE EXCEPTION 'DNI_INVALIDO'; END IF;
  IF v_contact IS NULL AND v_tel IS NULL THEN RAISE EXCEPTION 'FALTA_CONTACTO'; END IF;

  -- Una llamada a la vez por contacto: si SendPulse repite la llamada no se crean dos leads ni dos intentos.
  PERFORM pg_advisory_xact_lock(hashtext('dni_webhook:' || COALESCE(v_contact, public.crm_clave_telefono(v_tel))));

  v_id := public.dni_buscar_lead(v_contact, v_tel);
  v_nota := format('[%s] WhatsApp: DNI %s (%s) enviado para verificar',
                   public.crm_ahora_texto(), public.dni_enmascarar(v_dni), v_rel);

  IF v_id IS NULL THEN
    INSERT INTO public.leads (nombre, telefono, origen, estado, dni, estado_dni, dni_titular_relacion, dni_intentos,
                              sendpulse_contact_id, dni_actualizado_at, notas)
    VALUES (COALESCE(NULLIF(btrim(p_nombre), ''), 'Sin nombre (WhatsApp)'), v_tel, 'whatsapp', 'nuevo', v_dni, 'pendiente',
            v_rel, 1, v_contact, now(), 'Nuevo contacto vía WhatsApp (bot SendPulse)' || E'\n' || v_nota)
    RETURNING id INTO v_id;
    INSERT INTO public.historial_cambios (lead_id, usuario_id, campo, valor_anterior, valor_nuevo)
    VALUES (v_id, NULL, 'DNI recibido', NULL, format('Intento 1 (%s)', v_rel));
    RETURN jsonb_build_object('lead_id', v_id, 'is_new', true, 'estado', 'creado');
  END IF;

  SELECT * INTO l FROM public.leads WHERE id = v_id FOR UPDATE;

  -- Mismo DNI que ya está esperando: no suma otro intento.
  IF l.estado_dni = 'pendiente' AND l.dni = v_dni THEN
    IF v_contact IS NOT NULL AND l.sendpulse_contact_id IS DISTINCT FROM v_contact THEN
      UPDATE public.leads SET sendpulse_contact_id = v_contact WHERE id = v_id;
    END IF;
    RETURN jsonb_build_object('lead_id', v_id, 'is_new', false, 'estado', 'ya_pendiente');
  END IF;

  -- Ya tiene un DNI aprobado: no se pierde la aprobación, solo queda anotado.
  IF l.estado_dni = 'aprobado' THEN
    UPDATE public.leads
       SET notas = concat_ws(E'\n', NULLIF(notas, ''),
                     format('[%s] WhatsApp: llegó otro DNI (%s, %s) pero el lead ya tiene un DNI aprobado. No se cambió el estado.',
                            public.crm_ahora_texto(), public.dni_enmascarar(v_dni), v_rel)),
           sendpulse_contact_id = COALESCE(v_contact, sendpulse_contact_id)
     WHERE id = v_id;
    RETURN jsonb_build_object('lead_id', v_id, 'is_new', false, 'estado', 'ya_aprobado');
  END IF;

  UPDATE public.leads
     SET dni = v_dni,
         estado_dni = 'pendiente',
         dni_titular_relacion = v_rel,
         dni_intentos = COALESCE(dni_intentos, 0) + 1,
         sendpulse_contact_id = COALESCE(v_contact, sendpulse_contact_id),
         dni_actualizado_at = now(),
         notas = concat_ws(E'\n', NULLIF(notas, ''), v_nota)
   WHERE id = v_id;
  INSERT INTO public.historial_cambios (lead_id, usuario_id, campo, valor_anterior, valor_nuevo)
  VALUES (v_id, NULL, 'DNI recibido', l.estado_dni, format('Intento %s (%s)', COALESCE(l.dni_intentos, 0) + 1, v_rel));

  RETURN jsonb_build_object('lead_id', v_id, 'is_new', false, 'estado', 'actualizado');
END;
$$;

DROP FUNCTION IF EXISTS public.leads_duplicados_propuesta();
DROP FUNCTION IF EXISTS public.lead_buscar_existente(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.lead_registrar_reingreso(UUID, TEXT);
DROP FUNCTION IF EXISTS public.crm_email_util(TEXT);
DROP TABLE IF EXISTS public.leads_duplicados;
DROP INDEX IF EXISTS public.leads_telefono_clave_idx;
DELETE FROM public.crm_config WHERE clave IN ('emails_relleno', 'reingreso_perdidos_activo');
ALTER TABLE public.leads DROP COLUMN IF EXISTS reingreso_at;

REVOKE ALL ON FUNCTION public.dni_buscar_lead(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dni_webhook_recibido(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dni_webhook_recibido(TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

COMMIT;
