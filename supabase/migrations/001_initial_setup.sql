-- ============================================
-- MOTOBOX CRM — Setup Completo v3.0
-- Copiar TODO y pegar en SQL Editor de Supabase
-- 100% idempotente y anti-errores
-- ============================================

-- ============================================
-- TIPOS ENUMERADOS
-- ============================================
DO $$ BEGIN CREATE TYPE user_role AS ENUM ('admin', 'empleado'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE lead_origen AS ENUM ('whatsapp', 'facebook', 'instagram', 'presencial', 'referido', 'otro'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE lead_estado AS ENUM ('nuevo', 'contactado', 'en_negociacion', 'venta_cerrada', 'perdido'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE interaccion_tipo AS ENUM ('llamada', 'whatsapp', 'email', 'visita', 'otro'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============================================
-- TABLAS PRINCIPALES
-- ============================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  dni TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'empleado',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  telefono TEXT,
  email TEXT,
  modelo_interes TEXT,
  origen lead_origen DEFAULT 'presencial',
  estado lead_estado DEFAULT 'nuevo',
  vendedor_asignado UUID REFERENCES profiles(id),
  notas TEXT,
  presupuesto_estimado NUMERIC,
  fecha_agenda TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS interacciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES profiles(id),
  tipo interaccion_tipo DEFAULT 'llamada',
  detalle TEXT,
  fecha TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS historial_cambios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES profiles(id),
  campo TEXT NOT NULL,
  valor_anterior TEXT,
  valor_nuevo TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Agregar columna si la tabla ya existia sin ella
ALTER TABLE leads ADD COLUMN IF NOT EXISTS fecha_agenda TIMESTAMPTZ;

-- ============================================
-- INDICES DE RENDIMIENTO
-- ============================================
CREATE INDEX IF NOT EXISTS idx_profiles_dni ON profiles(dni);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_leads_vendedor ON leads(vendedor_asignado);
CREATE INDEX IF NOT EXISTS idx_leads_estado ON leads(estado);
CREATE INDEX IF NOT EXISTS idx_leads_origen ON leads(origen);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_updated ON leads(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_fecha_agenda ON leads(fecha_agenda);
CREATE INDEX IF NOT EXISTS idx_interacciones_lead ON interacciones(lead_id);
CREATE INDEX IF NOT EXISTS idx_interacciones_usuario ON interacciones(usuario_id);
CREATE INDEX IF NOT EXISTS idx_interacciones_fecha ON interacciones(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_historial_lead ON historial_cambios(lead_id);
CREATE INDEX IF NOT EXISTS idx_historial_usuario ON historial_cambios(usuario_id);
CREATE INDEX IF NOT EXISTS idx_historial_created ON historial_cambios(created_at DESC);

-- ============================================
-- FUNCIONES AUXILIARES (SECURITY DEFINER = anti-recursion)
-- ============================================
CREATE OR REPLACE FUNCTION public.get_user_role(user_id UUID)
RETURNS user_role AS $$
  SELECT role FROM profiles WHERE id = user_id;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT role = 'admin' FROM profiles WHERE id = auth.uid()),
    false
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.is_owner_or_admin(lead_vendedor UUID)
RETURNS BOOLEAN AS $$
  SELECT public.is_admin() OR lead_vendedor = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Auto updated_at en leads
CREATE OR REPLACE FUNCTION public.update_leads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_leads_updated_at ON leads;
CREATE TRIGGER trigger_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION public.update_leads_updated_at();

-- Auto crear perfil al registrar usuario
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, dni, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'dni', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Sin nombre'),
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'role', '')::user_role,
      'empleado'
    )
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
    role = COALESCE(EXCLUDED.role, profiles.role);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Funcion para stats de vendedor (usable desde frontend)
CREATE OR REPLACE FUNCTION public.get_vendor_stats(vendor_id UUID)
RETURNS JSON AS $$
  SELECT json_build_object(
    'total_leads', COUNT(*),
    'ventas', COUNT(*) FILTER (WHERE estado = 'venta_cerrada'),
    'en_negociacion', COUNT(*) FILTER (WHERE estado = 'en_negociacion'),
    'contactados', COUNT(*) FILTER (WHERE estado = 'contactado'),
    'nuevos', COUNT(*) FILTER (WHERE estado = 'nuevo'),
    'perdidos', COUNT(*) FILTER (WHERE estado = 'perdido'),
    'revenue', COALESCE(SUM(presupuesto_estimado) FILTER (WHERE estado = 'venta_cerrada'), 0),
    'pipeline_value', COALESCE(SUM(presupuesto_estimado) FILTER (WHERE estado = 'en_negociacion'), 0),
    'conversion_rate', CASE
      WHEN COUNT(*) > 0 THEN ROUND((COUNT(*) FILTER (WHERE estado = 'venta_cerrada')::NUMERIC / COUNT(*)) * 100, 1)
      ELSE 0
    END
  )
  FROM leads WHERE vendedor_asignado = vendor_id;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Funcion para stats globales (admin)
CREATE OR REPLACE FUNCTION public.get_global_stats()
RETURNS JSON AS $$
  SELECT json_build_object(
    'total_leads', COUNT(*),
    'ventas', COUNT(*) FILTER (WHERE estado = 'venta_cerrada'),
    'en_negociacion', COUNT(*) FILTER (WHERE estado = 'en_negociacion'),
    'nuevos', COUNT(*) FILTER (WHERE estado = 'nuevo'),
    'revenue', COALESCE(SUM(presupuesto_estimado) FILTER (WHERE estado = 'venta_cerrada'), 0),
    'pipeline_value', COALESCE(SUM(presupuesto_estimado) FILTER (WHERE estado = 'en_negociacion'), 0),
    'conversion_rate', CASE
      WHEN COUNT(*) > 0 THEN ROUND((COUNT(*) FILTER (WHERE estado = 'venta_cerrada')::NUMERIC / COUNT(*)) * 100, 1)
      ELSE 0
    END,
    'leads_esta_semana', COUNT(*) FILTER (WHERE created_at >= date_trunc('week', now())),
    'leads_este_mes', COUNT(*) FILTER (WHERE created_at >= date_trunc('month', now())),
    'agendados_hoy', COUNT(*) FILTER (WHERE fecha_agenda::date = CURRENT_DATE),
    'sin_agendar', COUNT(*) FILTER (WHERE fecha_agenda IS NULL AND estado NOT IN ('venta_cerrada', 'perdido'))
  )
  FROM leads;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Funcion para contar interacciones de un vendedor en un periodo
CREATE OR REPLACE FUNCTION public.get_vendor_activity(vendor_id UUID, desde TIMESTAMPTZ DEFAULT now() - interval '30 days')
RETURNS JSON AS $$
  SELECT json_build_object(
    'total', COUNT(*),
    'llamadas', COUNT(*) FILTER (WHERE tipo = 'llamada'),
    'whatsapp', COUNT(*) FILTER (WHERE tipo = 'whatsapp'),
    'emails', COUNT(*) FILTER (WHERE tipo = 'email'),
    'visitas', COUNT(*) FILTER (WHERE tipo = 'visita'),
    'otros', COUNT(*) FILTER (WHERE tipo = 'otro')
  )
  FROM interacciones
  WHERE usuario_id = vendor_id AND fecha >= desde;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================
-- RLS — HABILITAR
-- ============================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE interacciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE historial_cambios ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS — LIMPIAR POLITICAS EXISTENTES
-- ============================================
DO $$ 
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('profiles','leads','interacciones','historial_cambios')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

-- ============================================
-- RLS — PROFILES
-- ============================================
CREATE POLICY "profiles_admin_select" ON profiles FOR SELECT USING (public.is_admin());
CREATE POLICY "profiles_self_select" ON profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "profiles_admin_insert" ON profiles FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "profiles_admin_update" ON profiles FOR UPDATE USING (public.is_admin());
CREATE POLICY "profiles_admin_delete" ON profiles FOR DELETE USING (public.is_admin());

-- ============================================
-- RLS — LEADS
-- ============================================
CREATE POLICY "leads_admin_all" ON leads FOR ALL USING (public.is_admin());
CREATE POLICY "leads_vendor_select" ON leads FOR SELECT USING (vendedor_asignado = auth.uid());
CREATE POLICY "leads_vendor_insert" ON leads FOR INSERT WITH CHECK (vendedor_asignado = auth.uid());
CREATE POLICY "leads_vendor_update" ON leads FOR UPDATE USING (vendedor_asignado = auth.uid());

-- ============================================
-- RLS — INTERACCIONES
-- ============================================
CREATE POLICY "interacciones_admin_all" ON interacciones FOR ALL USING (public.is_admin());
CREATE POLICY "interacciones_vendor_select" ON interacciones FOR SELECT
  USING (EXISTS (SELECT 1 FROM leads WHERE leads.id = interacciones.lead_id AND leads.vendedor_asignado = auth.uid()));
CREATE POLICY "interacciones_vendor_insert" ON interacciones FOR INSERT
  WITH CHECK (usuario_id = auth.uid() AND EXISTS (SELECT 1 FROM leads WHERE leads.id = lead_id AND leads.vendedor_asignado = auth.uid()));

-- ============================================
-- RLS — HISTORIAL DE CAMBIOS
-- ============================================
CREATE POLICY "historial_admin_all" ON historial_cambios FOR ALL USING (public.is_admin());
CREATE POLICY "historial_vendor_select" ON historial_cambios FOR SELECT USING (usuario_id = auth.uid());
CREATE POLICY "historial_vendor_insert" ON historial_cambios FOR INSERT WITH CHECK (usuario_id = auth.uid());

-- ============================================
-- PERMISOS
-- ============================================
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_owner_or_admin(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_vendor_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_global_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_vendor_activity(UUID, TIMESTAMPTZ) TO authenticated;

-- ============================================
-- DONE
-- ============================================
