-- Historial del día para la pantalla "Verificación DNI": lo que ya se aprobó o rechazó desde
-- las 00:00 de Córdoba, con quién lo resolvió, el canal y si el aviso al cliente salió.
-- Solo lectura; mismos permisos que la cola (admin o usuario con verifica_dni).
CREATE OR REPLACE FUNCTION public.dni_resueltos_hoy()
RETURNS TABLE (
  resolucion_id uuid, lead_id uuid, nombre text, origen text, intento integer, resultado text,
  monto_aprobado numeric, aviso_estado text, operador_nombre text, resuelto_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.puede_verificar_dni() THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  RETURN QUERY
    SELECT d.id, d.lead_id, l.nombre::text, l.origen::text, d.intento, d.resultado::text, d.monto_aprobado,
           d.aviso_estado::text, p.full_name::text, d.created_at
      FROM public.dni_resoluciones d
      JOIN public.leads l ON l.id = d.lead_id
      LEFT JOIN public.profiles p ON p.id = d.operador_id
     WHERE d.created_at >= (date_trunc('day', now() AT TIME ZONE 'America/Argentina/Cordoba') AT TIME ZONE 'America/Argentina/Cordoba')
     ORDER BY d.created_at DESC
     LIMIT 100;
END;
$$;
REVOKE ALL ON FUNCTION public.dni_resueltos_hoy() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.dni_resueltos_hoy() TO authenticated;
