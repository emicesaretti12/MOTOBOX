-- ============================================
-- MOTOBOX — Sorteo: cuenta del participante ("Mis números")
--
-- Requiere 004_sorteo.sql aplicado antes.
--   * Cada inscripción guarda una clave (cifrada con bcrypt) que la persona crea en el formulario.
--   * La web puede consultar la participación con DNI + clave, o desde el mismo teléfono
--     con el token que recibió al inscribirse.
--   * La consulta devuelve solo número, nombre, DNI, código y estado del pago: nunca domicilio,
--     correo ni teléfono.
--   * Desde el CRM (solo admin) se puede crear una clave nueva para quien la olvidó.
--
-- Cómo aplicarlo: Supabase > SQL Editor > pegar todo este archivo > Run.
-- Se puede correr más de una vez sin romper nada.
-- ============================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER TABLE public.sorteo_participantes ADD COLUMN IF NOT EXISTS clave_hash TEXT;

-- --------------------------------------------
-- Inscripción (reemplaza la de 004): ahora pide clave y siempre devuelve el token de la cuenta
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.sorteo_inscribir(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_sorteo TEXT := COALESCE(NULLIF(trim(p->>'sorteo_id'), ''), '01');
  v_dni TEXT := regexp_replace(COALESCE(p->>'dni', ''), '\D', '', 'g');
  v_nombre TEXT := trim(COALESCE(p->>'nombre_completo', ''));
  v_nac DATE;
  v_tel TEXT := regexp_replace(COALESCE(p->>'telefono', ''), '\D', '', 'g');
  v_email TEXT := lower(trim(COALESCE(p->>'email', '')));
  v_loc TEXT := trim(COALESCE(p->>'localidad', ''));
  v_dir TEXT := trim(COALESCE(p->>'direccion', ''));
  v_prov TEXT := trim(COALESCE(p->>'provincia', ''));
  v_cp TEXT := trim(COALESCE(p->>'codigo_postal', ''));
  v_clave TEXT := COALESCE(p->>'clave', '');
  v_compra BOOLEAN := COALESCE((p->>'compra_manual')::BOOLEAN, false);
  v_monto INTEGER := NULLIF(p->>'monto', '')::INTEGER;
  v_num INTEGER;
  v_codigo TEXT := lpad((floor(random() * 10000))::INT::TEXT, 4, '0');
  v_row public.sorteo_participantes;
BEGIN
  BEGIN
    v_nac := (p->>'fecha_nacimiento')::DATE;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'FECHA_INVALIDA';
  END;

  IF v_dni !~ '^\d{7,8}$' THEN RAISE EXCEPTION 'DNI_INVALIDO'; END IF;
  IF length(v_nombre) < 5 OR v_nombre !~ '\s' THEN RAISE EXCEPTION 'NOMBRE_INVALIDO'; END IF;
  IF v_nac IS NULL OR v_nac > (current_date - INTERVAL '18 years')::DATE OR v_nac < DATE '1900-01-01' THEN
    RAISE EXCEPTION 'MENOR_DE_EDAD';
  END IF;
  IF length(v_tel) < 10 OR length(v_tel) > 13 THEN RAISE EXCEPTION 'TELEFONO_INVALIDO'; END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'EMAIL_INVALIDO'; END IF;
  IF length(v_loc) < 2 OR length(v_dir) < 3 OR length(v_prov) < 2 OR v_cp !~ '^[A-Za-z0-9]{4,8}$' THEN
    RAISE EXCEPTION 'DIRECCION_INVALIDA';
  END IF;
  IF length(v_clave) < 6 OR length(v_clave) > 72 THEN RAISE EXCEPTION 'CLAVE_INVALIDA'; END IF;
  IF length(v_nombre) > 120 OR length(v_dir) > 160 OR length(v_loc) > 80 OR length(v_prov) > 60 OR length(v_email) > 120 THEN
    RAISE EXCEPTION 'DATOS_DEMASIADO_LARGOS';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('sorteo_' || v_sorteo));

  IF EXISTS (SELECT 1 FROM public.sorteo_participantes WHERE sorteo_id = v_sorteo AND dni = v_dni) THEN
    RAISE EXCEPTION 'DNI_YA_INSCRIPTO';
  END IF;

  SELECT COALESCE(max(numero), 0) + 1 INTO v_num
    FROM public.sorteo_participantes WHERE sorteo_id = v_sorteo;

  INSERT INTO public.sorteo_participantes (
    sorteo_id, numero, dni, nombre_completo, fecha_nacimiento, telefono, codigo_verificacion, email,
    localidad, direccion, provincia, codigo_postal, compra_manual, monto, estado_pago, clave_hash
  ) VALUES (
    v_sorteo, v_num, v_dni, v_nombre, v_nac, v_tel, v_codigo, v_email,
    v_loc, v_dir, v_prov, upper(v_cp), v_compra,
    CASE WHEN v_compra THEN v_monto END,
    CASE WHEN v_compra THEN 'pendiente' ELSE 'gratis' END,
    extensions.crypt(v_clave, extensions.gen_salt('bf', 8))
  ) RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'numero', v_row.numero,
    'codigo', v_row.codigo_verificacion,
    'token', v_row.upload_token
  );
END;
$$;

-- --------------------------------------------
-- Lo que ve la persona en "Mis números" (sin datos sensibles)
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.sorteo_ficha(r public.sorteo_participantes)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'sorteo_id', r.sorteo_id,
    'numeros', jsonb_build_array(r.numero),
    'nombre', r.nombre_completo,
    'dni', r.dni,
    'codigo', r.codigo_verificacion,
    'compra_manual', r.compra_manual,
    'estado_pago', r.estado_pago,
    'pagado', r.estado_pago = 'verificado',
    'telefono_verificado', r.telefono_verificado,
    'inscripto', r.created_at,
    'token', r.upload_token
  );
$$;

-- Ingreso con DNI + clave
CREATE OR REPLACE FUNCTION public.sorteo_consultar(p_dni TEXT, p_clave TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  r public.sorteo_participantes;
BEGIN
  SELECT * INTO r
    FROM public.sorteo_participantes
   WHERE dni = regexp_replace(COALESCE(p_dni, ''), '\D', '', 'g')
     AND clave_hash IS NOT NULL
     AND clave_hash = extensions.crypt(COALESCE(p_clave, ''), clave_hash)
   ORDER BY created_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    PERFORM pg_sleep(0.8);   -- frena los intentos al azar
    RAISE EXCEPTION 'DATOS_INCORRECTOS';
  END IF;
  RETURN public.sorteo_ficha(r);
END;
$$;

-- Ingreso automático desde el teléfono con el que se inscribió
CREATE OR REPLACE FUNCTION public.sorteo_mi_participacion(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.sorteo_participantes;
BEGIN
  SELECT * INTO r FROM public.sorteo_participantes WHERE upload_token = p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_ENCONTRADO'; END IF;
  RETURN public.sorteo_ficha(r);
END;
$$;

-- Clave nueva desde el CRM (solo admin): para quien se olvidó la clave o se inscribió antes de que existiera
CREATE OR REPLACE FUNCTION public.sorteo_admin_nueva_clave(p_id UUID, p_clave TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'SOLO_ADMIN'; END IF;
  IF length(COALESCE(p_clave, '')) < 6 OR length(p_clave) > 72 THEN RAISE EXCEPTION 'CLAVE_INVALIDA'; END IF;
  UPDATE public.sorteo_participantes
     SET clave_hash = extensions.crypt(p_clave, extensions.gen_salt('bf', 8))
   WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_ENCONTRADO'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.sorteo_ficha(public.sorteo_participantes) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.sorteo_admin_nueva_clave(UUID, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.sorteo_admin_nueva_clave(UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.sorteo_inscribir(JSONB) FROM public;
REVOKE ALL ON FUNCTION public.sorteo_consultar(TEXT, TEXT) FROM public;
REVOKE ALL ON FUNCTION public.sorteo_mi_participacion(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.sorteo_inscribir(JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sorteo_consultar(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sorteo_mi_participacion(UUID) TO anon, authenticated;
