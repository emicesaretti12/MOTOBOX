-- ============================================
-- MOTOBOX — Refuerzo de seguridad
--
-- Requiere 004_sorteo.sql y 005_sorteo_cuentas.sql aplicados antes.
-- Cómo aplicarlo: Supabase > SQL Editor > pegar todo este archivo > Run.
-- Se puede correr más de una vez sin romper nada.
--
-- Qué corrige:
--   1. Nadie puede darse rol de administrador al registrarse (el rol ya no sale de los datos del usuario).
--   2. Las fotos de la web (bucket motobox-public) solo las sube, cambia o borra un admin.
--      Antes cualquiera con la clave pública podía borrar o reemplazar todas las imágenes.
--   3. Las funciones de estadísticas y roles ya no se pueden llamar sin iniciar sesión.
--   4. El visitante anónimo de la web solo puede LEER el catálogo y la configuración pública.
--   5. Sorteo: límite de intentos (contra adivinar claves y contra inscripciones masivas),
--      trampa para bots y se elimina la carga de comprobantes desde la web, que ya no se usa.
--   6. Todas las funciones con search_path fijo.
-- ============================================

-- --------------------------------------------
-- 1. Rol de los usuarios nuevos
-- --------------------------------------------
-- El rol se toma de app_metadata, que solo puede escribir el servidor (clave de servicio).
-- user_metadata lo puede mandar cualquiera al registrarse, así que se ignora.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, dni, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'dni', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Sin nombre'),
    CASE WHEN NEW.raw_app_meta_data->>'role' = 'admin' THEN 'admin'::user_role ELSE 'empleado'::user_role END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

-- --------------------------------------------
-- 2. Fotos de la web: escritura solo para admin
-- --------------------------------------------
DROP POLICY IF EXISTS "Allow All Uploads motobox" ON storage.objects;
DROP POLICY IF EXISTS "Allow All Updates motobox" ON storage.objects;
DROP POLICY IF EXISTS "Allow All Deletes motobox" ON storage.objects;
DROP POLICY IF EXISTS motobox_public_admin_subir ON storage.objects;
DROP POLICY IF EXISTS motobox_public_admin_cambiar ON storage.objects;
DROP POLICY IF EXISTS motobox_public_admin_borrar ON storage.objects;

CREATE POLICY motobox_public_admin_subir ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'motobox-public' AND public.is_admin());
CREATE POLICY motobox_public_admin_cambiar ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'motobox-public' AND public.is_admin())
  WITH CHECK (bucket_id = 'motobox-public' AND public.is_admin());
CREATE POLICY motobox_public_admin_borrar ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'motobox-public' AND public.is_admin());

-- Solo imágenes (sin SVG, que puede llevar código) y hasta 10 MB.
UPDATE storage.buckets
   SET file_size_limit = 10485760,
       allowed_mime_types = ARRAY['image/webp', 'image/jpeg', 'image/png', 'image/avif', 'image/gif']
 WHERE id = 'motobox-public';

-- --------------------------------------------
-- 3. Funciones internas: fuera del alcance público
-- --------------------------------------------
-- Funciones de trigger: nunca se llaman directamente.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_leads_changes() FROM public, anon, authenticated;
-- Estadísticas globales y por vendedor: el CRM no las usa y mostraban ventas y facturación a cualquiera.
REVOKE EXECUTE ON FUNCTION public.get_global_stats() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_vendor_stats(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_vendor_activity(uuid, timestamptz) FROM public, anon, authenticated;
-- Rol de un usuario: solo para quien inició sesión.
REVOKE EXECUTE ON FUNCTION public.get_user_role(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_user_role(uuid) TO authenticated;
-- is_admin / is_owner_or_admin se usan dentro de las reglas de acceso: siguen disponibles
-- (solo responden sobre quien hace la consulta).

-- --------------------------------------------
-- 4. Visitante anónimo: solo lectura de lo público
-- --------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated;
REVOKE SELECT ON public.clientes, public.leads, public.ventas, public.interacciones,
  public.historial_cambios, public.profiles, public.sorteo_participantes FROM anon;
GRANT SELECT ON public.inventario_motos, public.configuracion_web TO anon;
-- Tablas que se creen más adelante: el visitante anónimo no recibe permisos de escritura automáticamente.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon;

-- --------------------------------------------
-- 5. Sorteo
-- --------------------------------------------
-- La carga de comprobantes desde la web ya no existe (ahora va por WhatsApp con el vendedor).
DROP POLICY IF EXISTS sorteo_comprobante_subir ON storage.objects;
DROP FUNCTION IF EXISTS public.sorteo_registrar_comprobante(uuid, text);
DROP FUNCTION IF EXISTS public.sorteo_token_ok(text);

-- Registro de intentos para frenar ataques (nadie lo puede leer ni escribir desde la API).
CREATE TABLE IF NOT EXISTS public.sorteo_intentos (
  id BIGSERIAL PRIMARY KEY,
  clave TEXT NOT NULL,
  creado TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sorteo_intentos_clave_idx ON public.sorteo_intentos (clave, creado);
ALTER TABLE public.sorteo_intentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sorteo_intentos FROM public, anon, authenticated;

-- IP de quien llama (la pone Supabase en los encabezados de la consulta). NULL si no viene:
-- en ese caso no se aplican los límites por IP (sí los demás).
CREATE OR REPLACE FUNCTION public.sorteo_ip()
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.headers', true)::json->>'cf-connecting-ip', ''),
    NULLIF(trim(split_part(current_setting('request.headers', true)::json->>'x-forwarded-for', ',', 1)), '')
  );
$$;

-- ¿Se pasó del límite? (cuenta intentos de esa clave en la ventana de tiempo)
CREATE OR REPLACE FUNCTION public.sorteo_excedido(p_clave TEXT, p_max INTEGER, p_ventana INTERVAL)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT count(*) >= p_max FROM public.sorteo_intentos WHERE clave = p_clave AND creado > now() - p_ventana;
$$;

CREATE OR REPLACE FUNCTION public.sorteo_anotar(p_clave TEXT)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.sorteo_intentos (clave) VALUES (p_clave);
  -- Limpieza ocasional de registros viejos
  IF random() < 0.02 THEN
    DELETE FROM public.sorteo_intentos WHERE creado < now() - INTERVAL '2 days';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.sorteo_ip() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.sorteo_excedido(TEXT, INTEGER, INTERVAL) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.sorteo_anotar(TEXT) FROM public, anon, authenticated;

-- Inscripción: máximo 6 por IP por hora y 300 en total por hora; los bots que llenan el campo
-- oculto "sitio" se rechazan.
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
  v_compra BOOLEAN;
  v_num INTEGER;
  v_rnd BYTEA := extensions.gen_random_bytes(2);
  v_codigo TEXT := lpad(((get_byte(v_rnd, 0) * 256 + get_byte(v_rnd, 1)) % 10000)::TEXT, 4, '0');
  v_ip TEXT := public.sorteo_ip();
  v_row public.sorteo_participantes;
BEGIN
  IF v_sorteo <> '01' THEN RAISE EXCEPTION 'DATOS_INVALIDOS'; END IF;
  IF COALESCE(p->>'sitio', '') <> '' THEN RAISE EXCEPTION 'DATOS_INVALIDOS'; END IF;   -- trampa para bots
  IF (v_ip IS NOT NULL AND public.sorteo_excedido('inscribir:' || v_ip, 6, INTERVAL '1 hour'))
     OR public.sorteo_excedido('inscribir:total', 300, INTERVAL '1 hour') THEN
    RAISE EXCEPTION 'DEMASIADOS_INTENTOS';
  END IF;

  BEGIN
    v_compra := COALESCE((p->>'compra_manual')::BOOLEAN, false);
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
  -- Sin caracteres de control en los textos que después se muestran en el CRM
  IF (v_nombre || v_dir || v_loc || v_prov || v_email) ~ '[[:cntrl:]<>]' THEN RAISE EXCEPTION 'DATOS_INVALIDOS'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('sorteo_' || v_sorteo));

  IF EXISTS (SELECT 1 FROM public.sorteo_participantes WHERE sorteo_id = v_sorteo AND dni = v_dni) THEN
    RAISE EXCEPTION 'DNI_YA_INSCRIPTO';
  END IF;

  SELECT COALESCE(max(numero), 0) + 1 INTO v_num
    FROM public.sorteo_participantes WHERE sorteo_id = v_sorteo;

  -- El monto no lo decide el navegador: es el precio del manual.
  INSERT INTO public.sorteo_participantes (
    sorteo_id, numero, dni, nombre_completo, fecha_nacimiento, telefono, codigo_verificacion, email,
    localidad, direccion, provincia, codigo_postal, compra_manual, monto, estado_pago, clave_hash
  ) VALUES (
    v_sorteo, v_num, v_dni, v_nombre, v_nac, v_tel, v_codigo, v_email,
    v_loc, v_dir, v_prov, upper(v_cp), v_compra,
    CASE WHEN v_compra THEN 10000 END,
    CASE WHEN v_compra THEN 'pendiente' ELSE 'gratis' END,
    extensions.crypt(v_clave, extensions.gen_salt('bf', 8))
  ) RETURNING * INTO v_row;

  IF v_ip IS NOT NULL THEN PERFORM public.sorteo_anotar('inscribir:' || v_ip); END IF;
  PERFORM public.sorteo_anotar('inscribir:total');

  RETURN jsonb_build_object(
    'numero', v_row.numero,
    'codigo', v_row.codigo_verificacion,
    'token', v_row.upload_token
  );
END;
$$;

-- Ingreso con DNI + clave: 5 intentos fallidos por DNI y 20 por IP cada 15 minutos.
-- Los errores se devuelven como respuesta (no como excepción) para que el intento fallido quede anotado.
CREATE OR REPLACE FUNCTION public.sorteo_consultar(p_dni TEXT, p_clave TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  r public.sorteo_participantes;
  v_dni TEXT := left(regexp_replace(COALESCE(p_dni, ''), '\D', '', 'g'), 12);
  v_ip TEXT := public.sorteo_ip();
BEGIN
  IF public.sorteo_excedido('consultar-dni:' || v_dni, 5, INTERVAL '15 minutes')
     OR (v_ip IS NOT NULL AND public.sorteo_excedido('consultar-ip:' || v_ip, 20, INTERVAL '15 minutes')) THEN
    RETURN jsonb_build_object('error', 'DEMASIADOS_INTENTOS');
  END IF;

  SELECT * INTO r
    FROM public.sorteo_participantes
   WHERE dni = v_dni
     AND clave_hash IS NOT NULL
     AND length(COALESCE(p_clave, '')) BETWEEN 6 AND 72
     AND clave_hash = extensions.crypt(p_clave, clave_hash)
   ORDER BY created_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    PERFORM public.sorteo_anotar('consultar-dni:' || v_dni);
    IF v_ip IS NOT NULL THEN PERFORM public.sorteo_anotar('consultar-ip:' || v_ip); END IF;
    RETURN jsonb_build_object('error', 'DATOS_INCORRECTOS');
  END IF;
  RETURN public.sorteo_ficha(r);
END;
$$;

-- Ingreso con el token del teléfono: 30 intentos fallidos por IP cada 15 minutos.
CREATE OR REPLACE FUNCTION public.sorteo_mi_participacion(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.sorteo_participantes;
  v_ip TEXT := public.sorteo_ip();
BEGIN
  IF v_ip IS NOT NULL AND public.sorteo_excedido('token-ip:' || v_ip, 30, INTERVAL '15 minutes') THEN
    RETURN jsonb_build_object('error', 'DEMASIADOS_INTENTOS');
  END IF;
  SELECT * INTO r FROM public.sorteo_participantes WHERE upload_token = p_token;
  IF NOT FOUND THEN
    IF v_ip IS NOT NULL THEN PERFORM public.sorteo_anotar('token-ip:' || v_ip); END IF;
    RETURN jsonb_build_object('error', 'NO_ENCONTRADO');
  END IF;
  RETURN public.sorteo_ficha(r);
END;
$$;

ALTER FUNCTION public.sorteo_ficha(public.sorteo_participantes) SET search_path = public;

REVOKE ALL ON FUNCTION public.sorteo_inscribir(JSONB) FROM public;
REVOKE ALL ON FUNCTION public.sorteo_consultar(TEXT, TEXT) FROM public;
REVOKE ALL ON FUNCTION public.sorteo_mi_participacion(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.sorteo_inscribir(JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sorteo_consultar(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sorteo_mi_participacion(UUID) TO anon, authenticated;

-- --------------------------------------------
-- 6. search_path fijo en todas las funciones (evita que se "cuelen" objetos de otro esquema)
-- --------------------------------------------
DO $$
DECLARE f RECORD;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind = 'f'
       AND p.proname IN ('update_inventario_motos_updated_at', 'update_clientes_updated_at', 'update_ventas_updated_at',
                         'update_leads_updated_at', 'is_admin', 'is_owner_or_admin', 'get_user_role', 'audit_leads_changes',
                         'get_vendor_stats', 'get_global_stats', 'get_vendor_activity')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', f.sig);
  END LOOP;
END;
$$;
