-- MOTOBOX — Cola de verificación de DNI, parte 3 (lo que falta de la migración 008 en producción).
-- Para correr en Supabase > SQL Editor: pegar todo y tocar "Run".
-- Crea 3 funciones. Los DELETE de adentro SOLO liberan la reserva "lo está viendo X" de la tabla
-- nueva dni_tomas cuando alguien resuelve o suelta un DNI; al correr este archivo no se borra nada.
-- Se puede correr más de una vez. Texto idéntico a supabase/migrations/008_cola_verificacion_dni.sql.

CREATE OR REPLACE FUNCTION public.dni_soltar(p_lead_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.puede_verificar_dni() THEN RAISE EXCEPTION 'SIN_PERMISO' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.dni_tomas WHERE lead_id = p_lead_id AND tomado_por = auth.uid();
  RETURN FOUND;
END;
$$;

-- Registra el resultado. Atómica: bloquea el lead, exige que siga pendiente y que sea el mismo
-- intento que vio el operador. Si dos operadores resuelven a la vez, el segundo recibe YA_RESUELTO.
CREATE OR REPLACE FUNCTION public.dni_resolver(p_lead_id UUID, p_intento INTEGER, p_resultado TEXT, p_monto NUMERIC DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_res TEXT := lower(btrim(COALESCE(p_resultado, '')));
  v_expira INTERVAL := make_interval(mins => public.crm_numero('toma_expira_minutos', 5)::int);
  v_monto NUMERIC;
  v_operador TEXT;
  v_aviso TEXT;
  v_id UUID;
  v_nota TEXT;
  l public.leads;
  r RECORD;
BEGIN
  IF v_uid IS NULL OR NOT public.puede_verificar_dni() THEN RAISE EXCEPTION 'SIN_PERMISO' USING ERRCODE = '42501'; END IF;
  IF NOT public.crm_flag('cola_dni_activa') THEN RAISE EXCEPTION 'COLA_DESACTIVADA'; END IF;
  IF v_res NOT IN ('aprobado', 'rechazado') THEN RAISE EXCEPTION 'RESULTADO_INVALIDO'; END IF;
  IF p_monto IS NOT NULL AND (p_monto < 0 OR p_monto > 999999999) THEN RAISE EXCEPTION 'MONTO_INVALIDO'; END IF;

  SELECT * INTO l FROM public.leads WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEAD_NO_ENCONTRADO'; END IF;

  IF l.estado_dni IS DISTINCT FROM 'pendiente' THEN
    SELECT d.resultado, d.origen, d.created_at, p.full_name AS por INTO r
      FROM public.dni_resoluciones d LEFT JOIN public.profiles p ON p.id = d.operador_id
     WHERE d.lead_id = p_lead_id AND d.intento = p_intento;
    RETURN jsonb_build_object('ok', false, 'motivo', 'YA_RESUELTO',
      'resultado', COALESCE(r.resultado, l.estado_dni), 'por', r.por, 'origen', r.origen, 'at', r.created_at);
  END IF;

  IF l.dni_intentos IS DISTINCT FROM p_intento THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'INTENTO_CAMBIO', 'intento_actual', l.dni_intentos);
  END IF;

  SELECT p.full_name AS por, t.tomado_at INTO r
    FROM public.dni_tomas t JOIN public.profiles p ON p.id = t.tomado_por
   WHERE t.lead_id = p_lead_id AND t.intento = p_intento
     AND t.tomado_por <> v_uid AND t.tomado_at > now() - v_expira;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'TOMADO_POR_OTRO', 'por', r.por, 'at', r.tomado_at);
  END IF;

  v_monto := CASE WHEN v_res = 'aprobado' THEN p_monto END;
  SELECT full_name INTO v_operador FROM public.profiles WHERE id = v_uid;
  v_nota := format('[%s] CRM: DNI %s por %s%s (intento %s, %s %s)',
    public.crm_ahora_texto(), v_res, COALESCE(v_operador, 'operador'),
    CASE WHEN v_monto IS NOT NULL THEN ', monto ' || public.crm_formato_monto(v_monto) ELSE '' END,
    l.dni_intentos, COALESCE(l.dni_titular_relacion, 'titular'), COALESCE(public.dni_enmascarar(l.dni), 'sin DNI'));

  UPDATE public.leads
     SET estado_dni = v_res,
         monto_aprobado = v_monto,
         dni_actualizado_at = now(),
         notas = concat_ws(E'\n', NULLIF(notas, ''), v_nota)
   WHERE id = p_lead_id;

  v_aviso := CASE
    WHEN l.sendpulse_contact_id IS NULL THEN 'sin_contacto'
    WHEN NOT public.crm_flag('aviso_sendpulse_activo') THEN 'desactivado'
    ELSE 'pendiente'
  END;

  INSERT INTO public.dni_resoluciones (lead_id, intento, dni, relacion, resultado, monto_aprobado, operador_id, origen, aviso_estado)
  VALUES (p_lead_id, l.dni_intentos, l.dni, l.dni_titular_relacion, v_res, v_monto, v_uid, 'crm', v_aviso)
  ON CONFLICT (lead_id, intento) DO UPDATE
    SET dni = EXCLUDED.dni, relacion = EXCLUDED.relacion, resultado = EXCLUDED.resultado,
        monto_aprobado = EXCLUDED.monto_aprobado, operador_id = EXCLUDED.operador_id, origen = EXCLUDED.origen,
        aviso_estado = EXCLUDED.aviso_estado, aviso_intentos = 0, aviso_error = NULL,
        aviso_actualizado_at = NULL, created_at = now()
  RETURNING id INTO v_id;

  INSERT INTO public.historial_cambios (lead_id, usuario_id, campo, valor_anterior, valor_nuevo)
  VALUES (p_lead_id, v_uid, 'Verificación DNI', 'pendiente',
          v_res || COALESCE(' (' || public.crm_formato_monto(v_monto) || ')', ''));

  DELETE FROM public.dni_tomas WHERE lead_id = p_lead_id;

  RETURN jsonb_build_object(
    'ok', true,
    'resolucion_id', v_id,
    'lead_id', p_lead_id,
    'resultado', v_res,
    'monto_aprobado', v_monto,
    'aviso_estado', v_aviso,
    'sendpulse_contact_id', CASE WHEN v_aviso = 'pendiente' THEN l.sendpulse_contact_id END
  );
END;
$$;

-- Resultado informado por los flujos "DNI aprobado" / "DNI rechazado".
--   pendiente (o sin DNI)   -> lo registra (resultado disparado a mano desde Chats de SendPulse)
--   mismo resultado         -> no hace nada (ya lo registró el CRM)
--   rechazado -> aprobado   -> corrección: lo registra
--   aprobado -> rechazado   -> no pisa nada y deja una nota para revisar
CREATE OR REPLACE FUNCTION public.dni_webhook_resultado(p_contact_id TEXT, p_telefono TEXT, p_resultado TEXT, p_monto NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_res TEXT := lower(btrim(COALESCE(p_resultado, '')));
  v_contact TEXT := NULLIF(btrim(COALESCE(p_contact_id, '')), '');
  v_tel TEXT := NULLIF(btrim(COALESCE(p_telefono, '')), '');
  v_monto NUMERIC;
  v_id UUID;
  l public.leads;
BEGIN
  IF v_res NOT IN ('aprobado', 'rechazado') THEN RAISE EXCEPTION 'RESULTADO_INVALIDO'; END IF;
  IF v_contact IS NULL AND v_tel IS NULL THEN
    RETURN jsonb_build_object('estado', 'no_encontrado');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('dni_webhook:' || COALESCE(v_contact, public.crm_clave_telefono(v_tel))));

  v_id := public.dni_buscar_lead(v_contact, v_tel);
  IF v_id IS NULL THEN RETURN jsonb_build_object('estado', 'no_encontrado'); END IF;

  SELECT * INTO l FROM public.leads WHERE id = v_id FOR UPDATE;

  IF l.estado_dni IS NULL OR l.estado_dni = 'pendiente' THEN
    v_monto := CASE WHEN v_res = 'aprobado' AND p_monto IS NOT NULL AND p_monto >= 0 THEN p_monto END;
    UPDATE public.leads
       SET estado_dni = v_res,
           monto_aprobado = v_monto,
           dni_actualizado_at = now(),
           notas = concat_ws(E'\n', NULLIF(notas, ''),
                     format('[%s] WhatsApp: DNI %s%s', public.crm_ahora_texto(), v_res,
                            CASE WHEN v_monto IS NOT NULL THEN ' (monto ' || public.crm_formato_monto(v_monto) || ')' ELSE '' END))
     WHERE id = v_id;
    INSERT INTO public.dni_resoluciones (lead_id, intento, dni, relacion, resultado, monto_aprobado, operador_id, origen,
                                         aviso_estado, aviso_actualizado_at)
    VALUES (v_id, l.dni_intentos, l.dni, l.dni_titular_relacion, v_res, v_monto, NULL, 'sendpulse', 'externo', now())
    ON CONFLICT (lead_id, intento) DO NOTHING;
    INSERT INTO public.historial_cambios (lead_id, usuario_id, campo, valor_anterior, valor_nuevo)
    VALUES (v_id, NULL, 'Verificación DNI', COALESCE(l.estado_dni, 'sin DNI'),
            v_res || COALESCE(' (' || public.crm_formato_monto(v_monto) || ')', '') || ' — desde SendPulse');
    DELETE FROM public.dni_tomas WHERE lead_id = v_id;
    RETURN jsonb_build_object('lead_id', v_id, 'estado', 'registrado', 'estado_dni', v_res);
  END IF;

  IF l.estado_dni = v_res THEN
    RETURN jsonb_build_object('lead_id', v_id, 'estado', 'ya_registrado', 'estado_dni', v_res);
  END IF;

  -- Corrección: un DNI que figuraba rechazado y alguien aprueba a mano desde SendPulse.
  IF l.estado_dni = 'rechazado' AND v_res = 'aprobado' THEN
    v_monto := CASE WHEN p_monto IS NOT NULL AND p_monto >= 0 THEN p_monto END;
    UPDATE public.leads
       SET estado_dni = 'aprobado',
           monto_aprobado = v_monto,
           dni_actualizado_at = now(),
           notas = concat_ws(E'\n', NULLIF(notas, ''),
                     format('[%s] SendPulse: DNI corregido de rechazado a aprobado%s', public.crm_ahora_texto(),
                            CASE WHEN v_monto IS NOT NULL THEN ' (monto ' || public.crm_formato_monto(v_monto) || ')' ELSE '' END))
     WHERE id = v_id;
    INSERT INTO public.dni_resoluciones (lead_id, intento, dni, relacion, resultado, monto_aprobado, operador_id, origen,
                                         aviso_estado, aviso_actualizado_at)
    VALUES (v_id, l.dni_intentos, l.dni, l.dni_titular_relacion, 'aprobado', v_monto, NULL, 'sendpulse', 'externo', now())
    ON CONFLICT (lead_id, intento) DO UPDATE
      SET resultado = 'aprobado', monto_aprobado = EXCLUDED.monto_aprobado, operador_id = NULL, origen = 'sendpulse',
          aviso_estado = 'externo', aviso_error = NULL, aviso_actualizado_at = now();
    INSERT INTO public.historial_cambios (lead_id, usuario_id, campo, valor_anterior, valor_nuevo)
    VALUES (v_id, NULL, 'Verificación DNI', 'rechazado',
            'aprobado' || COALESCE(' (' || public.crm_formato_monto(v_monto) || ')', '') || ' — corregido desde SendPulse');
    RETURN jsonb_build_object('lead_id', v_id, 'estado', 'corregido', 'estado_dni', 'aprobado');
  END IF;

  UPDATE public.leads
     SET notas = concat_ws(E'\n', NULLIF(notas, ''),
                   format('[%s] ⚠ SendPulse informó DNI %s, pero el CRM ya tenía %s. No se cambió nada: revisar.',
                          public.crm_ahora_texto(), v_res, l.estado_dni))
   WHERE id = v_id;
  RETURN jsonb_build_object('lead_id', v_id, 'estado', 'conflicto', 'estado_dni', l.estado_dni);
END;
$$;

REVOKE ALL ON FUNCTION public.dni_soltar(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dni_resolver(UUID, INTEGER, TEXT, NUMERIC) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dni_webhook_resultado(TEXT, TEXT, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dni_soltar(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dni_resolver(UUID, INTEGER, TEXT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dni_webhook_resultado(TEXT, TEXT, TEXT, NUMERIC) TO service_role;

-- Comprobación: tiene que devolver las 3 funciones.
SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace
   AND proname IN ('dni_soltar', 'dni_resolver', 'dni_webhook_resultado') ORDER BY 1;
