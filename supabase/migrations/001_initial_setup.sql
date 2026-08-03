-- ============================================
-- MOTOBOX CRM - Setup Completo y Profesional
-- Supabase SQL Editor - Copiar y pegar TODO
-- ============================================
-- Este script es IDEMPOTENTE: se puede ejecutar
-- múltiples veces sin romper nada.
-- ============================================

-- =============================================
-- PASO 1: TIPOS ENUMERADOS
-- =============================================
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'empleado');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE lead_origen AS ENUM ('whatsapp', 'facebook', 'instagram', 'presencial', 'referido', 'otro');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE lead_estado AS ENUM ('nuevo', 'contactado', 'en_negociacion', 'venta_cerrada', 'perdido');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE interaccion_tipo AS ENUM ('llamada', 'whatsapp', 'email', 'visita', 'otro');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- =============================================
-- PASO 2: TABLAS
-- =============================================

-- Perfiles de usuario (vinculados a auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  dni TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'empleado',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Leads (prospectos/clientes potenciales)
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
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Interacciones (historial de contacto con cada lead)
CREATE TABLE IF NOT EXISTS interacciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES profiles(id),
  tipo interaccion_tipo DEFAULT 'llamada',
  detalle TEXT,
  fecha TIMESTAMPTZ DEFAULT now()
);

-- =============================================
-- PASO 3: ÍNDICES DE RENDIMIENTO
-- =============================================
CREATE INDEX IF NOT EXISTS idx_profiles_dni ON profiles(dni);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_leads_vendedor ON leads(vendedor_asignado);
CREATE INDEX IF NOT EXISTS idx_leads_estado ON leads(estado);
CREATE INDEX IF NOT EXISTS idx_leads_origen ON leads(origen);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_updated ON leads(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_nombre ON leads USING gin(to_tsvector('spanish', nombre));
CREATE INDEX IF NOT EXISTS idx_interacciones_lead ON interacciones(lead_id);
CREATE INDEX IF NOT EXISTS idx_interacciones_usuario ON interacciones(usuario_id);
CREATE INDEX IF NOT EXISTS idx_interacciones_fecha ON interacciones(fecha DESC);

-- =============================================
-- PASO 4: FUNCIONES AUXILIARES
-- =============================================

-- Función para verificar rol SIN recursión en RLS
-- (SECURITY DEFINER = se ejecuta con permisos del owner, no del usuario)
CREATE OR REPLACE FUNCTION public.get_user_role(user_id UUID)
RETURNS user_role AS $$
  SELECT role FROM profiles WHERE id = user_id;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Función para verificar si el usuario es admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Auto-actualizar updated_at en leads al modificar
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

-- Auto-crear perfil cuando se crea un usuario en auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, dni, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'dni', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Sin nombre'),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'empleado')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================
-- PASO 5: HABILITAR ROW LEVEL SECURITY
-- =============================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE interacciones ENABLE ROW LEVEL SECURITY;

-- =============================================
-- PASO 6: LIMPIAR POLÍTICAS EXISTENTES
-- (evitar duplicados al re-ejecutar)
-- =============================================
DROP POLICY IF EXISTS "Admin can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Admin can insert profiles" ON profiles;
DROP POLICY IF EXISTS "Admin can update profiles" ON profiles;
DROP POLICY IF EXISTS "Service role full access profiles" ON profiles;

DROP POLICY IF EXISTS "Admin full access to leads" ON leads;
DROP POLICY IF EXISTS "Empleado can view assigned leads" ON leads;
DROP POLICY IF EXISTS "Empleado can update assigned leads" ON leads;
DROP POLICY IF EXISTS "Empleado can insert leads" ON leads;

DROP POLICY IF EXISTS "Admin full access to interacciones" ON interacciones;
DROP POLICY IF EXISTS "Empleado can view interacciones for assigned leads" ON interacciones;
DROP POLICY IF EXISTS "Empleado can insert interacciones for assigned leads" ON interacciones;

-- =============================================
-- PASO 7: POLÍTICAS RLS - PROFILES
-- =============================================

-- Admin ve todos los perfiles
CREATE POLICY "Admin can view all profiles"
  ON profiles FOR SELECT
  USING (public.is_admin());

-- Cada usuario ve su propio perfil
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (id = auth.uid());

-- Admin puede crear perfiles
CREATE POLICY "Admin can insert profiles"
  ON profiles FOR INSERT
  WITH CHECK (public.is_admin());

-- Admin puede actualizar perfiles
CREATE POLICY "Admin can update profiles"
  ON profiles FOR UPDATE
  USING (public.is_admin());

-- =============================================
-- PASO 8: POLÍTICAS RLS - LEADS
-- =============================================

-- Admin tiene acceso total a leads
CREATE POLICY "Admin full access to leads"
  ON leads FOR ALL
  USING (public.is_admin());

-- Empleado ve solo sus leads asignados
CREATE POLICY "Empleado can view assigned leads"
  ON leads FOR SELECT
  USING (vendedor_asignado = auth.uid());

-- Empleado puede editar sus leads asignados
CREATE POLICY "Empleado can update assigned leads"
  ON leads FOR UPDATE
  USING (vendedor_asignado = auth.uid());

-- Empleado puede crear leads (se auto-asigna)
CREATE POLICY "Empleado can insert leads"
  ON leads FOR INSERT
  WITH CHECK (vendedor_asignado = auth.uid());

-- =============================================
-- PASO 9: POLÍTICAS RLS - INTERACCIONES
-- =============================================

-- Admin tiene acceso total a interacciones
CREATE POLICY "Admin full access to interacciones"
  ON interacciones FOR ALL
  USING (public.is_admin());

-- Empleado ve interacciones de sus leads
CREATE POLICY "Empleado can view interacciones for assigned leads"
  ON interacciones FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM leads l
      WHERE l.id = interacciones.lead_id
      AND l.vendedor_asignado = auth.uid()
    )
  );

-- Empleado puede crear interacciones en sus leads
CREATE POLICY "Empleado can insert interacciones for assigned leads"
  ON interacciones FOR INSERT
  WITH CHECK (
    usuario_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM leads l
      WHERE l.id = lead_id
      AND l.vendedor_asignado = auth.uid()
    )
  );

-- =============================================
-- PASO 10: PERMISOS
-- =============================================
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;

-- =============================================
-- ✅ SETUP COMPLETO
-- =============================================
-- Tablas: profiles, leads, interacciones
-- Enums: user_role, lead_origen, lead_estado, interaccion_tipo
-- Funciones: get_user_role, is_admin, handle_new_user, update_leads_updated_at
-- Triggers: auto-crear perfil al signup, auto-actualizar updated_at
-- RLS: admin acceso total, empleado solo sus leads
-- Índices: optimizados para búsquedas frecuentes
-- =============================================
