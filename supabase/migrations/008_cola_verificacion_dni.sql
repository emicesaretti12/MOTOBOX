-- ============================================
-- MOTOBOX — Cola de verificación de DNI (Etapa 1)
--
-- SOLO ADITIVA: crea tablas nuevas, una columna nueva con valor por defecto y funciones
-- nuevas. No modifica ni borra datos existentes. Todo arranca APAGADO (tabla crm_config).
-- Requiere 007 (columnas de DNI en leads), que ya está aplicada en producción.
-- Se puede correr más de una vez.
-- Reversa: supabase/rollback/008_cola_verificacion_dni_reversa.sql (solo con OK explícito).
-- ============================================

-- --------------------------------------------
-- 1. Quién puede verificar DNIs (además de los admin)
-- --------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS verifica_dni BOOLEAN NOT NULL DEFAULT false;

-- --------------------------------------------
-- 2. Interruptores y parámetros (se cambian con un UPDATE, sin redesplegar)
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_config (
  clave TEXT PRIMARY KEY,
  valor JSONB NOT NULL,
  descripcion TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.crm_config (clave, valor, descripcion) VALUES
  ('cola_dni_activa', 'false', 'Muestra la cola de verificación y permite resolver DNIs desde el CRM'),
  ('aviso_sendpulse_activo', 'false', 'Al resolver, ejecuta el flujo "DNI aprobado" o "DNI rechazado" en SendPulse'),
  ('alerta_espera_minutos', '15', 'Minutos de espera a partir de los cuales una consulta se resalta en la cola'),
  ('toma_expira_minutos', '5', 'Minutos que una consulta queda reservada para el operador que la abrió')
ON CONFLICT (clave) DO NOTHING;

-- --------------------------------------------
-- 3. Resoluciones: una fila por intento resuelto (auditoría y estado del aviso al cliente)
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS public.dni_resoluciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  intento INTEGER NOT NULL,
  dni TEXT,
  relacion TEXT,
  resultado TEXT NOT NULL CHECK (resultado IN ('aprobado', 'rechazado')),
  monto_aprobado NUMERIC CHECK (monto_aprobado IS NULL OR monto_aprobado >= 0),
  operador_id UUID REFERENCES public.profiles(id),
  origen TEXT NOT NULL DEFAULT 'crm' CHECK (origen IN ('crm', 'sendpulse')),
  -- pendiente: falta avisar | enviado: SendPulse confirmó | fallido: no se pudo avisar
  -- sin_contacto: el lead no tiene contacto de SendPulse | desactivado: aviso automático apagado
  -- externo: el resultado vino del propio flujo de SendPulse | manual: un operador avisó a mano
  aviso_estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (aviso_estado IN ('pendiente', 'enviado', 'fallido', 'sin_contacto', 'desactivado', 'externo', 'manual')),
  aviso_intentos INTEGER NOT NULL DEFAULT 0,
  aviso_error TEXT,
  aviso_actualizado_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lead_id, intento)
);

CREATE INDEX IF NOT EXISTS dni_resoluciones_aviso_idx
  ON public.dni_resoluciones (created_at DESC)
  WHERE aviso_estado IN ('pendiente', 'fallido', 'sin_contacto', 'desactivado');

-- --------------------------------------------
-- 4. Reservas: "lo está viendo X" (evita que dos operadores consulten el mismo DNI)
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS public.dni_tomas (
  lead_id UUID PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  intento INTEGER NOT NULL,
  tomado_por UUID NOT NULL REFERENCES public.profiles(id),
  tomado_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --------------------------------------------
-- 5. Funciones auxiliares (internas)
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_flag(p_clave TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((SELECT valor = 'true'::jsonb FROM public.crm_config WHERE clave = p_clave), false);
$$;

CREATE OR REPLACE FUNCTION public.crm_numero(p_clave TEXT, p_defecto NUMERIC)
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT CASE WHEN jsonb_typeof(valor) = 'number' THEN (valor #>> '{}')::numeric END
       FROM public.crm_config WHERE clave = p_clave),
    p_defecto);
$$;

CREATE OR REPLACE FUNCTION public.crm_ahora_texto()
RETURNS TEXT
LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT to_char(now() AT TIME ZONE 'America/Argentina/Cordoba', 'DD/MM/YYYY, HH24:MI:SS');
$$;

CREATE OR REPLACE FUNCTION public.crm_formato_monto(p NUMERIC)
RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT CASE WHEN p IS NULL THEN NULL
              ELSE '$' || replace(to_char(round(p), 'FM999,999,999,990'), ',', '.') END;
$$;

-- Nunca escribir el DNI completo en notas o historial: solo los últimos 3 dígitos.
CREATE OR REPLACE FUNCTION public.dni_enmascarar(p_dni TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT CASE WHEN COALESCE(p_dni, '') = '' THEN NULL ELSE '***' || right(p_dni, 3) END;
$$;

-- Últimos 10 dígitos: característica + número, sin 54, 9, 0 ni 15.
CREATE OR REPLACE FUNCTION public.crm_clave_telefono(p TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT right(regexp_replace(COALESCE(p, ''), '\D', '', 'g'), 10);
$$;

CREATE OR REPLACE FUNCTION public.puede_verificar_dni()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_admin()
      OR COALESCE((SELECT verifica_dni FROM public.profiles WHERE id = auth.uid()), false);
$$;

-- Lead más reciente por contacto de SendPulse o, si no, por teléfono normalizado.
-- Misma regla que usaba el webhook de WhatsApp, pero sin fallar si hay duplicados.
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

-- --------------------------------------------
-- 6. Cola de verificación (las llama el CRM con la sesión del operador)
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.dni_cola_listar()
RETURNS TABLE (
  lead_id UUID,
  nombre TEXT,
  telefono TEXT,
  dni TEXT,
  relacion TEXT,
  intento INTEGER,
  esperando_desde TIMESTAMPTZ,
  origen TEXT,
  tiene_contacto BOOLEAN,
  tomado_por_nombre TEXT,
  tomado_at TIMESTAMPTZ,
  tomado_por_mi BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_expira INTERVAL := make_interval(mins => public.crm_numero('toma_expira_minutos', 5)::int);
BEGIN
  IF NOT public.puede_verificar_dni() THEN RAISE EXCEPTION 'SIN_PERMISO' USING ERRCODE = '42501'; END IF;
  IF NOT public.crm_flag('cola_dni_activa') THEN RAISE EXCEPTION 'COLA_DESACTIVADA'; END IF;

  RETURN QUERY
    SELECT l.id, l.nombre, l.telefono, l.dni, l.dni_titular_relacion, l.dni_intentos,
           COALESCE(l.dni_actualizado_at, l.created_at), l.origen::text, (l.sendpulse_contact_id IS NOT NULL),
           p.full_name, t.tomado_at, COALESCE(t.tomado_por = auth.uid(), false)
      FROM public.leads l
      LEFT JOIN public.dni_tomas t
        ON t.lead_id = l.id AND t.intento = l.dni_intentos AND t.tomado_at > now() - v_expira
      LEFT JOIN public.profiles p ON p.id = t.tomado_por
     WHERE l.estado_dni = 'pendiente'
     ORDER BY COALESCE(l.dni_actualizado_at, l.created_at) ASC, l.id;
END;
$$;

-- Reserva la consulta para el operador mientras la revisa en la app de la financiera.
CREATE OR REPLACE FUNCTION public.dni_tomar(p_lead_id UUID, p_intento INTEGER)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_expira INTERVAL := make_interval(mins => public.crm_numero('toma_expira_minutos', 5)::int);
  l public.leads;
  r RECORD;
BEGIN
  IF v_uid IS NULL OR NOT public.puede_verificar_dni() THEN RAISE EXCEPTION 'SIN_PERMISO' USING ERRCODE = '42501'; END IF;
  IF NOT public.crm_flag('cola_dni_activa') THEN RAISE EXCEPTION 'COLA_DESACTIVADA'; END IF;

  SELECT * INTO l FROM public.leads WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEAD_NO_ENCONTRADO'; END IF;
  IF l.estado_dni IS DISTINCT FROM 'pendiente' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'YA_RESUELTO', 'resultado', l.estado_dni);
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

  INSERT INTO public.dni_tomas (lead_id, intento, tomado_por, tomado_at)
  VALUES (p_lead_id, p_intento, v_uid, now())
  ON CONFLICT (lead_id) DO UPDATE
    SET intento = EXCLUDED.intento, tomado_por = EXCLUDED.tomado_por, tomado_at = EXCLUDED.tomado_at;

  RETURN jsonb_build_object('ok', true);
END;
$$;

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

-- Resoluciones de los últimos 7 días en las que el cliente todavía no fue avisado.
CREATE OR REPLACE FUNCTION public.dni_avisos_pendientes()
RETURNS TABLE (
  resolucion_id UUID,
  lead_id UUID,
  nombre TEXT,
  telefono TEXT,
  resultado TEXT,
  monto_aprobado NUMERIC,
  aviso_estado TEXT,
  aviso_error TEXT,
  aviso_intentos INTEGER,
  resuelto_at TIMESTAMPTZ,
  operador_nombre TEXT,
  tiene_contacto BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.puede_verificar_dni() THEN RAISE EXCEPTION 'SIN_PERMISO' USING ERRCODE = '42501'; END IF;
  IF NOT public.crm_flag('cola_dni_activa') THEN RAISE EXCEPTION 'COLA_DESACTIVADA'; END IF;

  RETURN QUERY
    SELECT d.id, l.id, l.nombre, l.telefono, d.resultado, d.monto_aprobado, d.aviso_estado, d.aviso_error,
           d.aviso_intentos, d.created_at, p.full_name, (l.sendpulse_contact_id IS NOT NULL)
      FROM public.dni_resoluciones d
      JOIN public.leads l ON l.id = d.lead_id
      LEFT JOIN public.profiles p ON p.id = d.operador_id
     WHERE d.created_at > now() - INTERVAL '7 days'
       AND d.intento = l.dni_intentos
       AND l.estado_dni = d.resultado
       AND (d.aviso_estado IN ('fallido', 'sin_contacto', 'desactivado')
            OR (d.aviso_estado = 'pendiente' AND d.created_at < now() - INTERVAL '2 minutes'))
     ORDER BY d.created_at ASC;
END;
$$;

-- Antes de reintentar el aviso: confirma que la resolución sigue vigente y devuelve el contacto.
CREATE OR REPLACE FUNCTION public.dni_preparar_reintento(p_resolucion_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  d public.dni_resoluciones;
  l public.leads;
BEGIN
  IF auth.uid() IS NULL OR NOT public.puede_verificar_dni() THEN RAISE EXCEPTION 'SIN_PERMISO' USING ERRCODE = '42501'; END IF;
  IF NOT public.crm_flag('cola_dni_activa') THEN RAISE EXCEPTION 'COLA_DESACTIVADA'; END IF;
  IF NOT public.crm_flag('aviso_sendpulse_activo') THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'AVISO_DESACTIVADO');
  END IF;

  SELECT * INTO d FROM public.dni_resoluciones WHERE id = p_resolucion_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESOLUCION_NO_ENCONTRADA'; END IF;
  IF d.aviso_estado NOT IN ('pendiente', 'fallido', 'desactivado') THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'NO_REINTENTABLE', 'aviso_estado', d.aviso_estado);
  END IF;

  SELECT * INTO l FROM public.leads WHERE id = d.lead_id;
  IF l.sendpulse_contact_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'SIN_CONTACTO');
  END IF;
  -- Si llegó un DNI nuevo o el resultado cambió, avisar el resultado viejo confundiría al cliente.
  IF l.dni_intentos IS DISTINCT FROM d.intento OR l.estado_dni IS DISTINCT FROM d.resultado THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'DESACTUALIZADO');
  END IF;

  RETURN jsonb_build_object('ok', true, 'resolucion_id', d.id, 'resultado', d.resultado,
                            'sendpulse_contact_id', l.sendpulse_contact_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.dni_marcar_avisado_manual(p_resolucion_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_lead UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.puede_verificar_dni() THEN RAISE EXCEPTION 'SIN_PERMISO' USING ERRCODE = '42501'; END IF;

  UPDATE public.dni_resoluciones
     SET aviso_estado = 'manual', aviso_error = NULL, aviso_actualizado_at = now()
   WHERE id = p_resolucion_id AND aviso_estado IN ('pendiente', 'fallido', 'sin_contacto', 'desactivado')
  RETURNING lead_id INTO v_lead;
  IF v_lead IS NULL THEN RETURN false; END IF;

  INSERT INTO public.historial_cambios (lead_id, usuario_id, campo, valor_anterior, valor_nuevo)
  VALUES (v_lead, auth.uid(), 'Aviso al cliente', NULL, 'Avisado a mano por el operador');
  RETURN true;
END;
$$;

-- Resultado del aviso a SendPulse. Solo la llama la edge function dni-resolver (clave de servicio).
CREATE OR REPLACE FUNCTION public.dni_registrar_aviso(p_resolucion_id UUID, p_enviado BOOLEAN, p_intentos INTEGER, p_error TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_lead UUID;
BEGIN
  UPDATE public.dni_resoluciones
     SET aviso_estado = CASE WHEN p_enviado THEN 'enviado' ELSE 'fallido' END,
         aviso_intentos = aviso_intentos + GREATEST(COALESCE(p_intentos, 1), 0),
         aviso_error = CASE WHEN p_enviado THEN NULL
                            ELSE left(regexp_replace(COALESCE(p_error, 'Error desconocido'), '\d{7,}', '***', 'g'), 300) END,
         aviso_actualizado_at = now()
   WHERE id = p_resolucion_id AND aviso_estado IN ('pendiente', 'fallido', 'desactivado')
  RETURNING lead_id INTO v_lead;
  IF v_lead IS NULL THEN RETURN false; END IF;

  INSERT INTO public.historial_cambios (lead_id, usuario_id, campo, valor_anterior, valor_nuevo)
  VALUES (v_lead, NULL, 'Aviso al cliente', NULL,
          CASE WHEN p_enviado THEN 'Enviado por WhatsApp (SendPulse)' ELSE 'No se pudo avisar por WhatsApp' END);
  RETURN true;
END;
$$;

-- --------------------------------------------
-- 7. Webhook de WhatsApp (solo clave de servicio). Idempotentes y atómicas.
-- --------------------------------------------
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

-- Resultado informado por los flujos "DNI aprobado" / "DNI rechazado".
--   pendiente (o sin DNI) -> lo registra (resultado disparado a mano desde Chats de SendPulse)
--   mismo resultado       -> no hace nada (ya lo registró el CRM)
--   resultado distinto    -> no pisa nada y deja una nota para revisar
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

  UPDATE public.leads
     SET notas = concat_ws(E'\n', NULLIF(notas, ''),
                   format('[%s] ⚠ SendPulse informó DNI %s, pero el CRM ya tenía %s. No se cambió nada: revisar.',
                          public.crm_ahora_texto(), v_res, l.estado_dni))
   WHERE id = v_id;
  RETURN jsonb_build_object('lead_id', v_id, 'estado', 'conflicto', 'estado_dni', l.estado_dni);
END;
$$;

-- --------------------------------------------
-- 8. Seguridad de las tablas nuevas
-- --------------------------------------------
ALTER TABLE public.crm_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dni_resoluciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dni_tomas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_config_leer ON public.crm_config;
DROP POLICY IF EXISTS crm_config_admin_insertar ON public.crm_config;
DROP POLICY IF EXISTS crm_config_admin_cambiar ON public.crm_config;
CREATE POLICY crm_config_leer ON public.crm_config FOR SELECT TO authenticated USING (true);
CREATE POLICY crm_config_admin_insertar ON public.crm_config FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY crm_config_admin_cambiar ON public.crm_config FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Resoluciones: el admin ve todas; cada verificador, las que hizo él; cada vendedor, las de sus leads.
-- Nadie las escribe directo: solo a través de las funciones de arriba.
DROP POLICY IF EXISTS dni_resoluciones_leer ON public.dni_resoluciones;
CREATE POLICY dni_resoluciones_leer ON public.dni_resoluciones FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR operador_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = dni_resoluciones.lead_id AND l.vendedor_asignado = auth.uid())
  );

-- dni_tomas: sin políticas, solo se usa desde las funciones.

REVOKE ALL ON public.crm_config, public.dni_resoluciones, public.dni_tomas FROM anon;
REVOKE ALL ON public.dni_resoluciones, public.dni_tomas FROM authenticated;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.crm_config FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.crm_config TO authenticated;
GRANT SELECT ON public.dni_resoluciones TO authenticated;

-- Funciones: fuera del alcance público por defecto.
REVOKE ALL ON FUNCTION public.crm_flag(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_numero(TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_ahora_texto() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_formato_monto(NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dni_enmascarar(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_clave_telefono(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dni_buscar_lead(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.puede_verificar_dni() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dni_cola_listar() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dni_tomar(UUID, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dni_soltar(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dni_resolver(UUID, INTEGER, TEXT, NUMERIC) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dni_avisos_pendientes() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dni_preparar_reintento(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dni_marcar_avisado_manual(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dni_registrar_aviso(UUID, BOOLEAN, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dni_webhook_recibido(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dni_webhook_resultado(TEXT, TEXT, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.puede_verificar_dni() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dni_cola_listar() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dni_tomar(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dni_soltar(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dni_resolver(UUID, INTEGER, TEXT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dni_avisos_pendientes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dni_preparar_reintento(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dni_marcar_avisado_manual(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dni_registrar_aviso(UUID, BOOLEAN, INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.dni_webhook_recibido(TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.dni_webhook_resultado(TEXT, TEXT, TEXT, NUMERIC) TO service_role;
