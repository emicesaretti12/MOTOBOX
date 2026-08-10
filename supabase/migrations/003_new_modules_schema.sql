-- ============================================
-- MOTOBOX CRM — Nuevos Módulos: Inventario, Ventas, Clientes
-- ============================================

-- ============================================
-- TIPOS ENUMERADOS ADICIONALES
-- ============================================
DO $$ BEGIN CREATE TYPE inventario_estado AS ENUM (
  'disponible',
  'vendido',
  'reservado',
  'en_reparacion'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============================================
-- TABLA: inventario_motos
-- ============================================
CREATE TABLE IF NOT EXISTS inventario_motos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marca TEXT NOT NULL,
  modelo TEXT NOT NULL,
  anio INT,
  precio NUMERIC,
  estado inventario_estado DEFAULT 'disponible',
  notas TEXT,
  imagen_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Índices para inventario_motos
CREATE INDEX IF NOT EXISTS idx_inventario_marca ON inventario_motos(marca);
CREATE INDEX IF NOT EXISTS idx_inventario_modelo ON inventario_motos(modelo);
CREATE INDEX IF NOT EXISTS idx_inventario_estado ON inventario_motos(estado);
CREATE INDEX IF NOT EXISTS trgm_idx_inventario_marca ON inventario_motos USING GIN (marca public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_idx_inventario_modelo ON inventario_motos USING GIN (modelo public.gin_trgm_ops);

-- Trigger para auto updated_at en inventario_motos
CREATE OR REPLACE FUNCTION public.update_inventario_motos_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_inventario_motos_updated_at ON inventario_motos;
CREATE TRIGGER trigger_inventario_motos_updated_at
  BEFORE UPDATE ON inventario_motos
  FOR EACH ROW EXECUTE FUNCTION public.update_inventario_motos_updated_at();

-- ============================================
-- TABLA: clientes
-- ============================================
CREATE TABLE IF NOT EXISTS clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  telefono TEXT,
  email TEXT,
  dni TEXT UNIQUE,
  direccion TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Índices para clientes
CREATE INDEX IF NOT EXISTS idx_clientes_full_name ON clientes(full_name);
CREATE INDEX IF NOT EXISTS idx_clientes_dni ON clientes(dni);
CREATE INDEX IF NOT EXISTS trgm_idx_clientes_full_name ON clientes USING GIN (full_name public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_idx_clientes_telefono ON clientes USING GIN (telefono public.gin_trgm_ops);

-- Trigger para auto updated_at en clientes
CREATE OR REPLACE FUNCTION public.update_clientes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_clientes_updated_at ON clientes;
CREATE TRIGGER trigger_clientes_updated_at
  BEFORE UPDATE ON clientes
  FOR EACH ROW EXECUTE FUNCTION public.update_clientes_updated_at();

-- ============================================
-- TABLA: ventas
-- ============================================
CREATE TABLE IF NOT EXISTS ventas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  moto_id UUID REFERENCES inventario_motos(id) ON DELETE SET NULL,
  vendedor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  precio_venta NUMERIC NOT NULL,
  fecha_venta TIMESTAMPTZ DEFAULT now(),
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Índices para ventas
CREATE INDEX IF NOT EXISTS idx_ventas_lead_id ON ventas(lead_id);
CREATE INDEX IF NOT EXISTS idx_ventas_cliente_id ON ventas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_ventas_moto_id ON ventas(moto_id);
CREATE INDEX IF NOT EXISTS idx_ventas_vendedor_id ON ventas(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_ventas_fecha_venta ON ventas(fecha_venta DESC);

-- Trigger para auto updated_at en ventas
CREATE OR REPLACE FUNCTION public.update_ventas_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_ventas_updated_at ON ventas;
CREATE TRIGGER trigger_ventas_updated_at
  BEFORE UPDATE ON ventas
  FOR EACH ROW EXECUTE FUNCTION public.update_ventas_updated_at();

-- ============================================
-- RLS — HABILITAR PARA NUEVAS TABLAS
-- ============================================
ALTER TABLE inventario_motos ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ventas ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS — POLÍTICAS PARA inventario_motos
-- ============================================
-- Admin puede ver, insertar, actualizar, eliminar todo
CREATE POLICY "inventario_admin_all" ON inventario_motos FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
-- Empleado puede ver todo el inventario
CREATE POLICY "inventario_empleado_select" ON inventario_motos FOR SELECT USING (true);

-- ============================================
-- RLS — POLÍTICAS PARA clientes
-- ============================================
-- Admin puede ver, insertar, actualizar, eliminar todo
CREATE POLICY "clientes_admin_all" ON clientes FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
-- Empleado puede ver y gestionar sus propios clientes (creados por ellos o asociados a sus leads/ventas)
CREATE POLICY "clientes_empleado_select" ON clientes FOR SELECT USING (
  EXISTS (SELECT 1 FROM ventas WHERE ventas.cliente_id = clientes.id AND ventas.vendedor_id = auth.uid())
  OR EXISTS (SELECT 1 FROM leads WHERE leads.email = clientes.email AND leads.vendedor_asignado = auth.uid())
  OR EXISTS (SELECT 1 FROM leads WHERE leads.telefono = clientes.telefono AND leads.vendedor_asignado = auth.uid())
);
CREATE POLICY "clientes_empleado_insert" ON clientes FOR INSERT WITH CHECK (true); -- Permitir a cualquier empleado crear un cliente
CREATE POLICY "clientes_empleado_update" ON clientes FOR UPDATE USING (
  EXISTS (SELECT 1 FROM ventas WHERE ventas.cliente_id = clientes.id AND ventas.vendedor_id = auth.uid())
  OR EXISTS (SELECT 1 FROM leads WHERE leads.email = clientes.email AND leads.vendedor_asignado = auth.uid())
  OR EXISTS (SELECT 1 FROM leads WHERE leads.telefono = clientes.telefono AND leads.vendedor_asignado = auth.uid())
);

-- ============================================
-- RLS — POLÍTICAS PARA ventas
-- ============================================
-- Admin puede ver, insertar, actualizar, eliminar todo
CREATE POLICY "ventas_admin_all" ON ventas FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
-- Empleado puede ver y gestionar sus propias ventas
CREATE POLICY "ventas_empleado_all" ON ventas FOR ALL USING (vendedor_id = auth.uid()) WITH CHECK (vendedor_id = auth.uid());

-- ============================================
-- PERMISOS ADICIONALES
-- ============================================
GRANT ALL ON TABLE public.inventario_motos TO anon, authenticated;
GRANT ALL ON TABLE public.clientes TO anon, authenticated;
GRANT ALL ON TABLE public.ventas TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_inventario_motos_updated_at() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_clientes_updated_at() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_ventas_updated_at() TO anon, authenticated;

-- ============================================
-- DONE
-- ============================================
