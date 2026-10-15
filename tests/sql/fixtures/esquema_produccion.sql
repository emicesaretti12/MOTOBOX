-- Esquema de producción (proyecto szgencxcwhhjwonubika) de las tablas que toca la verificación de DNI,
-- tomado del catálogo real el 16/10/2026: columnas, restricciones, triggers, funciones y políticas RLS.
-- Solo para tests locales.

CREATE TYPE user_role AS ENUM ('admin', 'empleado');
CREATE TYPE lead_origen AS ENUM ('whatsapp', 'facebook', 'instagram', 'presencial', 'referido', 'otro');
CREATE TYPE lead_estado AS ENUM ('nuevo', 'contactado', 'en_negociacion', 'venta_cerrada', 'perdido');
CREATE TYPE interaccion_tipo AS ENUM ('llamada', 'whatsapp', 'email', 'visita', 'otro');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  dni TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'empleado',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  telefono TEXT,
  email TEXT,
  modelo_interes TEXT,
  origen lead_origen DEFAULT 'presencial',
  estado lead_estado DEFAULT 'nuevo',
  vendedor_asignado UUID REFERENCES public.profiles(id),
  notas TEXT,
  presupuesto_estimado NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  fecha_agenda TIMESTAMPTZ,
  manychat_subscriber_id TEXT,
  dni TEXT,
  estado_dni TEXT,
  dni_titular_relacion TEXT,
  dni_intentos INTEGER NOT NULL DEFAULT 0,
  monto_aprobado NUMERIC,
  sendpulse_contact_id TEXT,
  dni_actualizado_at TIMESTAMPTZ,
  CONSTRAINT chk_leads_presupuesto_positivo CHECK (presupuesto_estimado IS NULL OR presupuesto_estimado >= 0),
  CONSTRAINT chk_leads_telefono_format CHECK (telefono IS NULL OR length(regexp_replace(telefono, '\D', '', 'g')) >= 7),
  CONSTRAINT leads_estado_dni_check CHECK (estado_dni IS NULL OR estado_dni = ANY (ARRAY['pendiente', 'aprobado', 'rechazado']))
);
CREATE INDEX leads_estado_dni_idx ON public.leads (estado_dni) WHERE estado_dni IS NOT NULL;
CREATE INDEX leads_sendpulse_contact_idx ON public.leads (sendpulse_contact_id) WHERE sendpulse_contact_id IS NOT NULL;

CREATE TABLE public.interacciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES public.profiles(id),
  tipo interaccion_tipo DEFAULT 'llamada',
  detalle TEXT,
  fecha TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.historial_cambios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  usuario_id UUID REFERENCES public.profiles(id),
  campo TEXT NOT NULL,
  valor_anterior TEXT,
  valor_nuevo TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE FUNCTION public.is_admin() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT role = 'admin' FROM profiles WHERE id = auth.uid()), false);
$$;

CREATE FUNCTION public.is_owner_or_admin(lead_vendedor UUID) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin() OR lead_vendedor = auth.uid();
$$;

CREATE FUNCTION public.update_leads_updated_at() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Copia del código de producción (función audit_leads_changes).
CREATE FUNCTION public.audit_leads_changes() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  old_value TEXT;
  new_value TEXT;
  current_user_id UUID;
BEGIN
  SELECT auth.uid() INTO current_user_id;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.nombre IS DISTINCT FROM NEW.nombre THEN
      INSERT INTO public.historial_cambios (lead_id, usuario_id, campo, valor_anterior, valor_nuevo)
      VALUES (NEW.id, current_user_id, 'Nombre', OLD.nombre::TEXT, NEW.nombre::TEXT);
    END IF;
    IF OLD.telefono IS DISTINCT FROM NEW.telefono THEN
      INSERT INTO public.historial_cambios (lead_id, usuario_id, campo, valor_anterior, valor_nuevo)
      VALUES (NEW.id, current_user_id, 'Teléfono', OLD.telefono::TEXT, NEW.telefono::TEXT);
    END IF;
    IF OLD.email IS DISTINCT FROM NEW.email THEN
      INSERT INTO public.historial_cambios (lead_id, usuario_id, campo, valor_anterior, valor_nuevo)
      VALUES (NEW.id, current_user_id, 'Email', OLD.email::TEXT, NEW.email::TEXT);
    END IF;
    IF OLD.modelo_interes IS DISTINCT FROM NEW.modelo_interes THEN
      INSERT INTO public.historial_cambios (lead_id, usuario_id, campo, valor_anterior, valor_nuevo)
      VALUES (NEW.id, current_user_id, 'Modelo de Interés', OLD.modelo_interes::TEXT, NEW.modelo_interes::TEXT);
    END IF;
    IF OLD.origen IS DISTINCT FROM NEW.origen THEN
      INSERT INTO public.historial_cambios (lead_id, usuario_id, campo, valor_anterior, valor_nuevo)
      VALUES (NEW.id, current_user_id, 'Origen', OLD.origen::TEXT, NEW.origen::TEXT);
    END IF;
    IF OLD.estado IS DISTINCT FROM NEW.estado THEN
      INSERT INTO public.historial_cambios (lead_id, usuario_id, campo, valor_anterior, valor_nuevo)
      VALUES (NEW.id, current_user_id, 'Estado', OLD.estado::TEXT, NEW.estado::TEXT);
    END IF;
    IF OLD.vendedor_asignado IS DISTINCT FROM NEW.vendedor_asignado THEN
      SELECT full_name INTO old_value FROM public.profiles WHERE id = OLD.vendedor_asignado;
      SELECT full_name INTO new_value FROM public.profiles WHERE id = NEW.vendedor_asignado;
      INSERT INTO public.historial_cambios (lead_id, usuario_id, campo, valor_anterior, valor_nuevo)
      VALUES (NEW.id, current_user_id, 'Vendedor Asignado', COALESCE(old_value, OLD.vendedor_asignado::TEXT), COALESCE(new_value, NEW.vendedor_asignado::TEXT));
    END IF;
    IF OLD.notas IS DISTINCT FROM NEW.notas THEN
      INSERT INTO public.historial_cambios (lead_id, usuario_id, campo, valor_anterior, valor_nuevo)
      VALUES (NEW.id, current_user_id, 'Notas', OLD.notas::TEXT, NEW.notas::TEXT);
    END IF;
    IF OLD.presupuesto_estimado IS DISTINCT FROM NEW.presupuesto_estimado THEN
      INSERT INTO public.historial_cambios (lead_id, usuario_id, campo, valor_anterior, valor_nuevo)
      VALUES (NEW.id, current_user_id, 'Presupuesto Estimado', OLD.presupuesto_estimado::TEXT, NEW.presupuesto_estimado::TEXT);
    END IF;
    IF OLD.fecha_agenda IS DISTINCT FROM NEW.fecha_agenda THEN
      INSERT INTO public.historial_cambios (lead_id, usuario_id, campo, valor_anterior, valor_nuevo)
      VALUES (NEW.id, current_user_id, 'Fecha de Agenda', OLD.fecha_agenda::TEXT, NEW.fecha_agenda::TEXT);
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.historial_cambios (lead_id, usuario_id, campo, valor_nuevo)
    VALUES (NEW.id, current_user_id, 'Creación de Lead', 'Lead Creado');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_leads_updated_at BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.update_leads_updated_at();
CREATE TRIGGER trg_audit_leads_changes AFTER INSERT OR UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.audit_leads_changes();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interacciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historial_cambios ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_admin_select ON public.profiles FOR SELECT USING (is_admin());
CREATE POLICY profiles_self_select ON public.profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY profiles_all_select_basic ON public.profiles FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY profiles_admin_insert ON public.profiles FOR INSERT WITH CHECK (is_admin());
CREATE POLICY profiles_admin_update ON public.profiles FOR UPDATE USING (is_admin());
CREATE POLICY profiles_admin_delete ON public.profiles FOR DELETE USING (is_admin());

CREATE POLICY leads_admin_all ON public.leads FOR ALL USING (is_admin());
CREATE POLICY leads_vendor_select ON public.leads FOR SELECT USING (vendedor_asignado = auth.uid());
CREATE POLICY leads_vendor_insert ON public.leads FOR INSERT WITH CHECK (vendedor_asignado = auth.uid());
CREATE POLICY leads_vendor_update ON public.leads FOR UPDATE USING (vendedor_asignado = auth.uid());

CREATE POLICY interacciones_admin_all ON public.interacciones FOR ALL USING (is_admin());
CREATE POLICY interacciones_vendor_select ON public.interacciones FOR SELECT
  USING (EXISTS (SELECT 1 FROM leads WHERE leads.id = interacciones.lead_id AND leads.vendedor_asignado = auth.uid()));
CREATE POLICY interacciones_vendor_insert ON public.interacciones FOR INSERT
  WITH CHECK (usuario_id = auth.uid() AND EXISTS (SELECT 1 FROM leads WHERE leads.id = interacciones.lead_id AND leads.vendedor_asignado = auth.uid()));

CREATE POLICY historial_admin_all ON public.historial_cambios FOR ALL USING (is_admin());
CREATE POLICY historial_vendor_insert ON public.historial_cambios FOR INSERT WITH CHECK (usuario_id = auth.uid());
CREATE POLICY historial_vendor_select ON public.historial_cambios FOR SELECT USING (usuario_id = auth.uid());

-- Permisos como quedaron después de 006_seguridad.sql.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated;
REVOKE SELECT ON public.leads, public.interacciones, public.historial_cambios, public.profiles FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon;
