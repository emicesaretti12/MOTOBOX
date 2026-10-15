-- ============================================
-- MOTOBOX — Entrada de leads: búsqueda segura, emails de relleno, duplicados y reingresos (Etapa 4)
--
-- SOLO ADITIVA: un índice, una columna nueva (nullable), una tabla nueva y funciones.
-- No modifica ni borra leads existentes. El reingreso de perdidos arranca APAGADO.
-- Requiere 008. Se puede correr más de una vez.
-- Reversa: supabase/rollback/010_entrada_leads_reversa.sql (solo con OK).
-- ============================================

-- --------------------------------------------
-- 1. Búsqueda por teléfono normalizado (últimos 10 dígitos)
-- Índice por expresión: no agrega columnas ni reescribe la tabla.
-- Si alguna vez se cambia crm_clave_telefono(), hay que hacer REINDEX de este índice.
-- --------------------------------------------
CREATE INDEX IF NOT EXISTS leads_telefono_clave_idx
  ON public.leads (public.crm_clave_telefono(telefono))
  WHERE telefono IS NOT NULL;

-- --------------------------------------------
-- 2. Emails de relleno: nunca se usan para buscar duplicados
-- --------------------------------------------
INSERT INTO public.crm_config (clave, valor, descripcion) VALUES
  ('emails_relleno', '["x@gmail.com"]', 'Emails de relleno que no se usan para buscar leads existentes'),
  ('reingreso_perdidos_activo', 'false', 'Si un lead perdido vuelve a escribir, pasa a nuevo (mantiene su vendedor)')
ON CONFLICT (clave) DO NOTHING;

-- Devuelve el email normalizado si sirve para buscar, o NULL si está vacío, es inválido o es de relleno.
CREATE OR REPLACE FUNCTION public.crm_email_util(p TEXT)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN e IS NULL THEN NULL
    WHEN e !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN NULL
    WHEN EXISTS (
      SELECT 1 FROM public.crm_config c
       WHERE c.clave = 'emails_relleno' AND jsonb_typeof(c.valor) = 'array'
         AND e IN (SELECT lower(btrim(x)) FROM jsonb_array_elements_text(c.valor) AS x)
    ) THEN NULL
    ELSE e
  END
  FROM (SELECT NULLIF(lower(btrim(COALESCE(p, ''))), '') AS e) s;
$$;

-- --------------------------------------------
-- 3. Duplicados: se marcan en una tabla aparte (la tabla leads no se toca)
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS public.leads_duplicados (
  lead_id UUID PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  principal_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  clave_telefono TEXT,
  marcado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (lead_id <> principal_id)
);
CREATE INDEX IF NOT EXISTS leads_duplicados_principal_idx ON public.leads_duplicados (principal_id);

-- Propuesta de unificación (solo lectura): agrupa por los últimos 10 dígitos del teléfono y elige
-- un principal por grupo. Regla: estado más avanzado (venta > negociación > contactado > nuevo > perdido),
-- después el que tiene interacciones, después el que tiene vendedor, después el más antiguo.
-- revisar_a_mano = el grupo tiene vendedores distintos, más de una venta, o un secundario con venta o interacciones.
CREATE OR REPLACE FUNCTION public.leads_duplicados_propuesta()
RETURNS TABLE (
  clave_telefono TEXT,
  lead_id UUID,
  principal_id UUID,
  es_principal BOOLEAN,
  estado TEXT,
  vendedor_id UUID,
  interacciones BIGINT,
  creado_at TIMESTAMPTZ,
  revisar_a_mano BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH base AS (
    SELECT l.id, l.estado::text AS estado, l.vendedor_asignado, l.created_at,
           public.crm_clave_telefono(l.telefono) AS clave,
           (SELECT count(*) FROM public.interacciones i WHERE i.lead_id = l.id) AS interacciones,
           CASE l.estado WHEN 'venta_cerrada' THEN 5 WHEN 'en_negociacion' THEN 4 WHEN 'contactado' THEN 3
                         WHEN 'nuevo' THEN 2 ELSE 1 END AS peso
      FROM public.leads l
     WHERE l.telefono IS NOT NULL
       AND length(public.crm_clave_telefono(l.telefono)) >= 8
       AND NOT EXISTS (SELECT 1 FROM public.leads_duplicados d WHERE d.lead_id = l.id)
  ),
  grupos AS (
    SELECT clave,
           count(DISTINCT vendedor_asignado) AS vendedores,
           count(*) FILTER (WHERE estado = 'venta_cerrada') AS ventas
      FROM base GROUP BY clave HAVING count(*) > 1
  ),
  orden AS (
    SELECT b.*, g.vendedores, g.ventas,
           row_number() OVER (PARTITION BY b.clave
                              ORDER BY b.peso DESC, b.interacciones DESC, (b.vendedor_asignado IS NOT NULL) DESC, b.created_at ASC, b.id) AS puesto
      FROM base b JOIN grupos g USING (clave)
  ),
  marcado AS (
    SELECT o.*,
           first_value(o.id) OVER (PARTITION BY o.clave ORDER BY o.puesto) AS principal,
           (o.puesto > 1 AND (o.estado = 'venta_cerrada' OR o.interacciones > 0)) AS secundario_delicado
      FROM orden o
  )
  SELECT m.clave, m.id, m.principal, (m.puesto = 1), m.estado, m.vendedor_asignado, m.interacciones, m.created_at,
         (m.vendedores > 1 OR m.ventas > 1 OR bool_or(m.secundario_delicado) OVER (PARTITION BY m.clave))
    FROM marcado m
   ORDER BY m.clave, m.puesto;
$$;

-- --------------------------------------------
-- 4. Reingresos: lead perdido que vuelve a escribir
-- --------------------------------------------
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS reingreso_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.lead_registrar_reingreso(p_lead_id UUID, p_canal TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.crm_flag('reingreso_perdidos_activo') THEN RETURN false; END IF;

  -- Mantiene el vendedor. El trigger de auditoría registra el cambio de estado.
  UPDATE public.leads
     SET estado = 'nuevo',
         reingreso_at = now(),
         notas = concat_ws(E'\n', NULLIF(notas, ''),
                   format('[%s] Volvió a escribir por %s (estaba perdido)', public.crm_ahora_texto(), COALESCE(p_canal, 'WhatsApp')))
   WHERE id = p_lead_id AND estado = 'perdido';
  IF NOT FOUND THEN RETURN false; END IF;

  INSERT INTO public.historial_cambios (lead_id, usuario_id, campo, valor_anterior, valor_nuevo)
  VALUES (p_lead_id, NULL, 'Volvió a escribir', 'perdido', format('nuevo (por %s)', COALESCE(p_canal, 'WhatsApp')));
  RETURN true;
END;
$$;

-- --------------------------------------------
-- 5. Búsqueda segura del lead existente
-- --------------------------------------------
-- Igual que en 008, pero si hay duplicados marcados prefiere el principal.
CREATE OR REPLACE FUNCTION public.dni_buscar_lead(p_contact_id TEXT, p_telefono TEXT)
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_clave TEXT := public.crm_clave_telefono(p_telefono);
BEGIN
  IF COALESCE(p_contact_id, '') <> '' THEN
    SELECT l.id INTO v_id FROM public.leads l
     WHERE l.sendpulse_contact_id = p_contact_id
     ORDER BY EXISTS (SELECT 1 FROM public.leads_duplicados d WHERE d.lead_id = l.id), l.created_at DESC
     LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;
  IF length(v_clave) >= 8 THEN
    SELECT l.id INTO v_id FROM public.leads l
     WHERE l.telefono IS NOT NULL AND public.crm_clave_telefono(l.telefono) = v_clave
     ORDER BY EXISTS (SELECT 1 FROM public.leads_duplicados d WHERE d.lead_id = l.id), l.created_at DESC
     LIMIT 1;
  END IF;
  RETURN v_id;
END;
$$;

-- Para la función de Instagram: por teléfono normalizado y, si no aparece, por email (solo si sirve).
-- Nunca falla con duplicados: devuelve uno solo (el principal o el más reciente).
CREATE OR REPLACE FUNCTION public.lead_buscar_existente(p_telefono TEXT, p_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id UUID := public.dni_buscar_lead(NULL, p_telefono);
  v_email TEXT := public.crm_email_util(p_email);
BEGIN
  IF v_id IS NULL AND v_email IS NOT NULL THEN
    SELECT l.id INTO v_id FROM public.leads l
     WHERE lower(btrim(l.email)) = v_email
     ORDER BY EXISTS (SELECT 1 FROM public.leads_duplicados d WHERE d.lead_id = l.id), l.created_at DESC
     LIMIT 1;
  END IF;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  RETURN (SELECT jsonb_build_object('id', l.id, 'notas', l.notas, 'estado', l.estado) FROM public.leads l WHERE l.id = v_id);
END;
$$;

-- --------------------------------------------
-- 6. Webhook de WhatsApp: igual que en 008 + reingreso de perdidos
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
  v_reingreso BOOLEAN := false;
  l public.leads;
BEGIN
  IF v_dni !~ '^\d{7,8}$' THEN RAISE EXCEPTION 'DNI_INVALIDO'; END IF;
  IF v_contact IS NULL AND v_tel IS NULL THEN RAISE EXCEPTION 'FALTA_CONTACTO'; END IF;

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

  IF l.estado = 'perdido' THEN
    v_reingreso := public.lead_registrar_reingreso(v_id, 'WhatsApp');
  END IF;

  IF l.estado_dni = 'pendiente' AND l.dni = v_dni THEN
    IF v_contact IS NOT NULL AND l.sendpulse_contact_id IS DISTINCT FROM v_contact THEN
      UPDATE public.leads SET sendpulse_contact_id = v_contact WHERE id = v_id;
    END IF;
    RETURN jsonb_build_object('lead_id', v_id, 'is_new', false, 'estado', 'ya_pendiente', 'reingreso', v_reingreso);
  END IF;

  IF l.estado_dni = 'aprobado' THEN
    UPDATE public.leads
       SET notas = concat_ws(E'\n', NULLIF(notas, ''),
                     format('[%s] WhatsApp: llegó otro DNI (%s, %s) pero el lead ya tiene un DNI aprobado. No se cambió el estado.',
                            public.crm_ahora_texto(), public.dni_enmascarar(v_dni), v_rel)),
           sendpulse_contact_id = COALESCE(v_contact, sendpulse_contact_id)
     WHERE id = v_id;
    RETURN jsonb_build_object('lead_id', v_id, 'is_new', false, 'estado', 'ya_aprobado', 'reingreso', v_reingreso);
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

  RETURN jsonb_build_object('lead_id', v_id, 'is_new', false, 'estado', 'actualizado', 'reingreso', v_reingreso);
END;
$$;

-- --------------------------------------------
-- 7. Seguridad
-- --------------------------------------------
ALTER TABLE public.leads_duplicados ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leads_duplicados_admin_leer ON public.leads_duplicados;
CREATE POLICY leads_duplicados_admin_leer ON public.leads_duplicados FOR SELECT TO authenticated USING (public.is_admin());
REVOKE ALL ON public.leads_duplicados FROM anon;
REVOKE ALL ON public.leads_duplicados FROM authenticated;
GRANT SELECT ON public.leads_duplicados TO authenticated;

REVOKE ALL ON FUNCTION public.crm_email_util(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.leads_duplicados_propuesta() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_registrar_reingreso(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dni_buscar_lead(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_buscar_existente(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dni_webhook_recibido(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_registrar_reingreso(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_buscar_existente(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.dni_webhook_recibido(TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
