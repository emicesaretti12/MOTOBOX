-- ============================================
-- MOTOBOX — Métricas de verificación de DNI (Etapa 5)
--
-- SOLO ADITIVA: una tabla de eventos, un trigger que solo escribe en esa tabla y una función de lectura.
-- No modifica datos existentes. Requiere 008 y 009. Se puede correr más de una vez.
-- Reversa: supabase/rollback/011_metricas_dni_reversa.sql (solo con OK).
--
-- Los eventos de DNI se registran desde que se aplica esta migración (antes no había historial de DNIs).
-- Leads nuevos y ventas cerradas salen de datos que ya existen, así que tienen historia completa.
-- ============================================

CREATE TABLE IF NOT EXISTS public.dni_eventos (
  id BIGSERIAL PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('enviado', 'aprobado', 'rechazado')),
  intento INTEGER,
  relacion TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dni_eventos_fecha_idx ON public.dni_eventos (created_at);
CREATE INDEX IF NOT EXISTS dni_eventos_lead_idx ON public.dni_eventos (lead_id, intento, created_at);

-- Anota cada DNI recibido y cada resultado, venga del webhook, del CRM o de un cambio manual.
-- Si algo falla acá, el cambio del lead se guarda igual (las métricas nunca bloquean la operación).
CREATE OR REPLACE FUNCTION public.leads_registrar_evento_dni()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NEW.estado_dni = 'pendiente' THEN
        INSERT INTO public.dni_eventos (lead_id, tipo, intento, relacion)
        VALUES (NEW.id, 'enviado', NEW.dni_intentos, NEW.dni_titular_relacion);
      END IF;
    ELSIF NEW.estado_dni = 'pendiente'
          AND (OLD.estado_dni IS DISTINCT FROM 'pendiente' OR NEW.dni_intentos IS DISTINCT FROM OLD.dni_intentos) THEN
      INSERT INTO public.dni_eventos (lead_id, tipo, intento, relacion)
      VALUES (NEW.id, 'enviado', NEW.dni_intentos, NEW.dni_titular_relacion);
    ELSIF NEW.estado_dni IN ('aprobado', 'rechazado') AND OLD.estado_dni IS DISTINCT FROM NEW.estado_dni THEN
      INSERT INTO public.dni_eventos (lead_id, tipo, intento, relacion)
      VALUES (NEW.id, NEW.estado_dni, NEW.dni_intentos, NEW.dni_titular_relacion);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'evento de DNI no registrado (%)', SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_eventos_dni ON public.leads;
CREATE TRIGGER trg_leads_eventos_dni
  AFTER INSERT OR UPDATE OF estado_dni, dni_intentos ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.leads_registrar_evento_dni();

-- Métricas por día (hora de Córdoba) y origen, entre dos fechas inclusive. Solo admin.
-- El tiempo de verificación se devuelve como suma + cantidad para poder promediar bien al agrupar.
CREATE OR REPLACE FUNCTION public.metricas_dni(p_desde DATE, p_hasta DATE)
RETURNS TABLE (
  dia DATE,
  origen TEXT,
  leads_nuevos INTEGER,
  dnis_enviados INTEGER,
  aprobados INTEGER,
  rechazados INTEGER,
  aprobados_primer_intento INTEGER,
  aprobados_con_familiar INTEGER,
  verificacion_segundos NUMERIC,
  verificaciones_medidas INTEGER,
  asignados INTEGER,
  ventas_cerradas INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_tz CONSTANT TEXT := 'America/Argentina/Cordoba';
  v_desde TIMESTAMPTZ;
  v_hasta TIMESTAMPTZ;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'SIN_PERMISO' USING ERRCODE = '42501'; END IF;
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde OR p_hasta - p_desde > 366 THEN
    RAISE EXCEPTION 'RANGO_INVALIDO';
  END IF;
  v_desde := p_desde::timestamp AT TIME ZONE v_tz;
  v_hasta := (p_hasta + 1)::timestamp AT TIME ZONE v_tz;

  RETURN QUERY
  WITH
  nuevos AS (
    SELECT (l.created_at AT TIME ZONE v_tz)::date AS dia, COALESCE(l.origen::text, 'otro') AS origen, count(*) AS n
      FROM public.leads l
     WHERE l.created_at >= v_desde AND l.created_at < v_hasta
     GROUP BY 1, 2
  ),
  ev AS (
    SELECT e.lead_id, e.tipo, e.intento, e.relacion, e.created_at,
           (e.created_at AT TIME ZONE v_tz)::date AS dia, COALESCE(l.origen::text, 'otro') AS origen
      FROM public.dni_eventos e JOIN public.leads l ON l.id = e.lead_id
     WHERE e.created_at >= v_desde AND e.created_at < v_hasta
  ),
  resueltos AS (
    SELECT ev.*,
           (SELECT extract(epoch FROM ev.created_at - max(s.created_at))
              FROM public.dni_eventos s
             WHERE s.lead_id = ev.lead_id AND s.tipo = 'enviado'
               AND s.intento IS NOT DISTINCT FROM ev.intento AND s.created_at <= ev.created_at) AS segundos
      FROM ev WHERE ev.tipo IN ('aprobado', 'rechazado')
  ),
  enviados AS (
    SELECT dia, origen, count(*) AS n FROM ev WHERE tipo = 'enviado' GROUP BY 1, 2
  ),
  resultados AS (
    SELECT dia, origen,
           count(*) FILTER (WHERE tipo = 'aprobado') AS aprobados,
           count(*) FILTER (WHERE tipo = 'rechazado') AS rechazados,
           count(*) FILTER (WHERE tipo = 'aprobado' AND COALESCE(intento, 1) <= 1) AS primer_intento,
           count(*) FILTER (WHERE tipo = 'aprobado' AND relacion = 'familiar') AS con_familiar,
           COALESCE(sum(segundos), 0) AS segundos,
           count(segundos) AS medidas
      FROM resueltos GROUP BY 1, 2
  ),
  asig AS (
    SELECT (a.created_at AT TIME ZONE v_tz)::date AS dia, COALESCE(l.origen::text, 'otro') AS origen, count(*) AS n
      FROM public.asignaciones_lead a JOIN public.leads l ON l.id = a.lead_id
     WHERE a.created_at >= v_desde AND a.created_at < v_hasta
     GROUP BY 1, 2
  ),
  ventas AS (
    -- El trigger de auditoría guarda el valor interno 'venta_cerrada'; las filas que escribe la pantalla
    -- usan la etiqueta "Venta Cerrada" y se ignoran para no contar dos veces.
    SELECT (h.created_at AT TIME ZONE v_tz)::date AS dia, COALESCE(l.origen::text, 'otro') AS origen, count(DISTINCT h.lead_id) AS n
      FROM public.historial_cambios h JOIN public.leads l ON l.id = h.lead_id
     WHERE h.campo = 'Estado' AND h.valor_nuevo = 'venta_cerrada'
       AND h.created_at >= v_desde AND h.created_at < v_hasta
     GROUP BY 1, 2
  ),
  claves AS (
    SELECT dia, origen FROM nuevos UNION SELECT dia, origen FROM enviados UNION SELECT dia, origen FROM resultados
    UNION SELECT dia, origen FROM asig UNION SELECT dia, origen FROM ventas
  )
  SELECT k.dia, k.origen,
         COALESCE(n.n, 0)::int, COALESCE(e.n, 0)::int,
         COALESCE(r.aprobados, 0)::int, COALESCE(r.rechazados, 0)::int,
         COALESCE(r.primer_intento, 0)::int, COALESCE(r.con_familiar, 0)::int,
         COALESCE(r.segundos, 0)::numeric, COALESCE(r.medidas, 0)::int,
         COALESCE(a.n, 0)::int, COALESCE(v.n, 0)::int
    FROM claves k
    LEFT JOIN nuevos n ON n.dia = k.dia AND n.origen = k.origen
    LEFT JOIN enviados e ON e.dia = k.dia AND e.origen = k.origen
    LEFT JOIN resultados r ON r.dia = k.dia AND r.origen = k.origen
    LEFT JOIN asig a ON a.dia = k.dia AND a.origen = k.origen
    LEFT JOIN ventas v ON v.dia = k.dia AND v.origen = k.origen
   ORDER BY k.dia DESC, k.origen;
END;
$$;

-- Seguridad
ALTER TABLE public.dni_eventos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dni_eventos_admin_leer ON public.dni_eventos;
CREATE POLICY dni_eventos_admin_leer ON public.dni_eventos FOR SELECT TO authenticated USING (public.is_admin());
REVOKE ALL ON public.dni_eventos FROM anon;
REVOKE ALL ON public.dni_eventos FROM authenticated;
GRANT SELECT ON public.dni_eventos TO authenticated;
REVOKE ALL ON SEQUENCE public.dni_eventos_id_seq FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.leads_registrar_evento_dni() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.metricas_dni(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.metricas_dni(DATE, DATE) TO authenticated;
