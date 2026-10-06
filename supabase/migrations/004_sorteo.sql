-- ============================================
-- MOTOBOX — Sorteo promocional (inscripción web + bloque Sorteo del CRM)
--
-- Reglas que garantiza la base de datos:
--   * Una sola participación por DNI. Comprar el manual NO da más chances.
--   * Solo mayores de 18 años.
--   * El público solo puede inscribirse y adjuntar SU comprobante; no puede leer datos.
--   * Ver, verificar y editar inscriptos: solo perfiles admin.
--
-- Cómo aplicarlo: Supabase > SQL Editor > pegar todo este archivo > Run.
-- Se puede correr más de una vez sin romper nada.
-- ============================================

-- --------------------------------------------
-- TABLA: sorteo_participantes
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS public.sorteo_participantes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sorteo_id TEXT NOT NULL DEFAULT '01',
  numero INTEGER NOT NULL,                       -- número de participación (uno por persona)
  dni TEXT NOT NULL,
  nombre_completo TEXT NOT NULL,
  fecha_nacimiento DATE NOT NULL,
  telefono TEXT NOT NULL,                        -- solo dígitos, con código de área
  telefono_verificado BOOLEAN NOT NULL DEFAULT false,
  codigo_verificacion TEXT NOT NULL,             -- la persona lo manda por WhatsApp desde su número
  email TEXT NOT NULL,
  localidad TEXT NOT NULL,
  direccion TEXT NOT NULL,
  provincia TEXT NOT NULL,
  codigo_postal TEXT NOT NULL,
  compra_manual BOOLEAN NOT NULL DEFAULT false,
  monto INTEGER,
  estado_pago TEXT NOT NULL DEFAULT 'gratis'
    CHECK (estado_pago IN ('gratis', 'pendiente', 'comprobante', 'verificado', 'rechazado')),
  comprobante_path TEXT,
  upload_token UUID NOT NULL DEFAULT gen_random_uuid(),
  verificado_at TIMESTAMPTZ,
  verificado_por UUID REFERENCES auth.users(id),
  whatsapp_enviado_at TIMESTAMPTZ,
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sorteo_id, dni),
  UNIQUE (sorteo_id, numero),
  UNIQUE (upload_token)
);

CREATE INDEX IF NOT EXISTS sorteo_participantes_estado_idx
  ON public.sorteo_participantes (sorteo_id, estado_pago, created_at DESC);

ALTER TABLE public.sorteo_participantes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sorteo_admin_all ON public.sorteo_participantes;
CREATE POLICY sorteo_admin_all ON public.sorteo_participantes
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- --------------------------------------------
-- FUNCIÓN PÚBLICA: inscribirse
-- Valida todo del lado del servidor y asigna el número correlativo.
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.sorteo_inscribir(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  IF length(v_nombre) > 120 OR length(v_dir) > 160 OR length(v_loc) > 80 OR length(v_prov) > 60 OR length(v_email) > 120 THEN
    RAISE EXCEPTION 'DATOS_DEMASIADO_LARGOS';
  END IF;

  -- Un candado por sorteo evita números repetidos si dos personas se inscriben a la vez.
  PERFORM pg_advisory_xact_lock(hashtext('sorteo_' || v_sorteo));

  IF EXISTS (SELECT 1 FROM public.sorteo_participantes WHERE sorteo_id = v_sorteo AND dni = v_dni) THEN
    RAISE EXCEPTION 'DNI_YA_INSCRIPTO';
  END IF;

  SELECT COALESCE(max(numero), 0) + 1 INTO v_num
    FROM public.sorteo_participantes WHERE sorteo_id = v_sorteo;

  INSERT INTO public.sorteo_participantes (
    sorteo_id, numero, dni, nombre_completo, fecha_nacimiento, telefono, codigo_verificacion, email,
    localidad, direccion, provincia, codigo_postal, compra_manual, monto, estado_pago
  ) VALUES (
    v_sorteo, v_num, v_dni, v_nombre, v_nac, v_tel, v_codigo, v_email,
    v_loc, v_dir, v_prov, upper(v_cp), v_compra,
    CASE WHEN v_compra THEN v_monto END,
    CASE WHEN v_compra THEN 'pendiente' ELSE 'gratis' END
  ) RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'numero', v_row.numero,
    'codigo', v_row.codigo_verificacion,
    'upload_token', CASE WHEN v_compra THEN v_row.upload_token END
  );
END;
$$;

-- El token de carga solo sirve para quien compró y todavía no tiene el pago verificado.
CREATE OR REPLACE FUNCTION public.sorteo_token_ok(p_token TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sorteo_participantes
    WHERE upload_token::TEXT = p_token
      AND compra_manual
      AND estado_pago IN ('pendiente', 'comprobante', 'rechazado')
  );
$$;

-- Guarda la ruta del comprobante subido y deja el pago "a verificar".
CREATE OR REPLACE FUNCTION public.sorteo_registrar_comprobante(p_token UUID, p_path TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_path IS NULL OR p_path NOT LIKE p_token::TEXT || '/%' THEN
    RETURN false;
  END IF;
  UPDATE public.sorteo_participantes
     SET comprobante_path = p_path, estado_pago = 'comprobante'
   WHERE upload_token = p_token
     AND compra_manual
     AND estado_pago IN ('pendiente', 'comprobante', 'rechazado');
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.sorteo_inscribir(JSONB) FROM public;
REVOKE ALL ON FUNCTION public.sorteo_token_ok(TEXT) FROM public;
REVOKE ALL ON FUNCTION public.sorteo_registrar_comprobante(UUID, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.sorteo_inscribir(JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sorteo_token_ok(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sorteo_registrar_comprobante(UUID, TEXT) TO anon, authenticated;

-- --------------------------------------------
-- ALMACENAMIENTO
-- --------------------------------------------
-- Comprobantes: privados. Se suben con el token de la inscripción; solo el admin los ve.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('sorteo-comprobantes', 'sorteo-comprobantes', false, 8388608,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- Manual en PDF: lectura pública (va en el link de WhatsApp), escritura solo admin.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('sorteo-manual', 'sorteo-manual', true, 26214400, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS sorteo_comprobante_subir ON storage.objects;
CREATE POLICY sorteo_comprobante_subir ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'sorteo-comprobantes' AND public.sorteo_token_ok((storage.foldername(name))[1]));

DROP POLICY IF EXISTS sorteo_comprobante_admin_leer ON storage.objects;
CREATE POLICY sorteo_comprobante_admin_leer ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'sorteo-comprobantes' AND public.is_admin());

DROP POLICY IF EXISTS sorteo_comprobante_admin_borrar ON storage.objects;
CREATE POLICY sorteo_comprobante_admin_borrar ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'sorteo-comprobantes' AND public.is_admin());

DROP POLICY IF EXISTS sorteo_manual_leer ON storage.objects;
CREATE POLICY sorteo_manual_leer ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'sorteo-manual');

DROP POLICY IF EXISTS sorteo_manual_admin_subir ON storage.objects;
CREATE POLICY sorteo_manual_admin_subir ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'sorteo-manual' AND public.is_admin());

DROP POLICY IF EXISTS sorteo_manual_admin_cambiar ON storage.objects;
CREATE POLICY sorteo_manual_admin_cambiar ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'sorteo-manual' AND public.is_admin());

DROP POLICY IF EXISTS sorteo_manual_admin_borrar ON storage.objects;
CREATE POLICY sorteo_manual_admin_borrar ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'sorteo-manual' AND public.is_admin());
