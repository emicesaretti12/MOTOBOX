-- ============================================
-- MOTOBOX CRM - Supabase Database Setup
-- Run this in the Supabase SQL Editor
-- ============================================

-- 1. Create custom types (enums)
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

-- 2. Create profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  dni TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'empleado',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Create leads table
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

-- 4. Create interacciones table
CREATE TABLE IF NOT EXISTS interacciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES profiles(id),
  tipo interaccion_tipo DEFAULT 'llamada',
  detalle TEXT,
  fecha TIMESTAMPTZ DEFAULT now()
);

-- 5. Create indexes
CREATE INDEX IF NOT EXISTS idx_leads_vendedor ON leads(vendedor_asignado);
CREATE INDEX IF NOT EXISTS idx_leads_estado ON leads(estado);
CREATE INDEX IF NOT EXISTS idx_leads_origen ON leads(origen);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interacciones_lead ON interacciones(lead_id);
CREATE INDEX IF NOT EXISTS idx_interacciones_usuario ON interacciones(usuario_id);
CREATE INDEX IF NOT EXISTS idx_interacciones_fecha ON interacciones(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_dni ON profiles(dni);

-- 6. Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE interacciones ENABLE ROW LEVEL SECURITY;

-- 7. RLS Policies for profiles
-- Admin can see all profiles
CREATE POLICY "Admin can view all profiles"
  ON profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- Users can see their own profile
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (id = auth.uid());

-- Admin can insert profiles
CREATE POLICY "Admin can insert profiles"
  ON profiles FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- Admin can update profiles
CREATE POLICY "Admin can update profiles"
  ON profiles FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- 8. RLS Policies for leads
-- Admin can do everything with leads
CREATE POLICY "Admin full access to leads"
  ON leads FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- Empleado can view their assigned leads
CREATE POLICY "Empleado can view assigned leads"
  ON leads FOR SELECT
  USING (vendedor_asignado = auth.uid());

-- Empleado can update their assigned leads
CREATE POLICY "Empleado can update assigned leads"
  ON leads FOR UPDATE
  USING (vendedor_asignado = auth.uid());

-- Empleado can insert leads (auto-assigned to them)
CREATE POLICY "Empleado can insert leads"
  ON leads FOR INSERT
  WITH CHECK (vendedor_asignado = auth.uid());

-- 9. RLS Policies for interacciones
-- Admin can do everything with interacciones
CREATE POLICY "Admin full access to interacciones"
  ON interacciones FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- Empleado can view interacciones for their leads
CREATE POLICY "Empleado can view interacciones for assigned leads"
  ON interacciones FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM leads l
      WHERE l.id = interacciones.lead_id AND l.vendedor_asignado = auth.uid()
    )
  );

-- Empleado can insert interacciones for their leads
CREATE POLICY "Empleado can insert interacciones for assigned leads"
  ON interacciones FOR INSERT
  WITH CHECK (
    usuario_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM leads l
      WHERE l.id = lead_id AND l.vendedor_asignado = auth.uid()
    )
  );

-- 10. Function to auto-create profile on user signup (for edge function usage)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, dni, full_name, role)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'dni',
    NEW.raw_user_meta_data->>'full_name',
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'empleado')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 11. Grant necessary permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
