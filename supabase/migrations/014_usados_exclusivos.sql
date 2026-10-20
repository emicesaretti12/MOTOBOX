-- ============================================
-- MOTOBOX — Usados exclusivos
--
-- Motos usadas seleccionadas, separadas del inventario 0km (inventario_motos) para que
-- no se mezclen en el catálogo ni en las métricas de stock nuevo.
--   * El CRM las carga y edita (solo admin; los vendedores las ven).
--   * La web (rol anon) solo lee las publicadas que están disponibles o reservadas,
--     y nunca ve las notas internas.
--
-- Cómo aplicarlo: Supabase > SQL Editor > pegar todo este archivo > Run.
-- Se puede correr más de una vez sin romper nada.
-- ============================================

CREATE TABLE IF NOT EXISTS public.usados_exclusivos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marca TEXT NOT NULL CHECK (length(trim(marca)) BETWEEN 1 AND 60),
  modelo TEXT NOT NULL CHECK (length(trim(modelo)) BETWEEN 1 AND 80),
  anio INTEGER CHECK (anio BETWEEN 1970 AND 2100),
  km INTEGER CHECK (km >= 0 AND km < 1000000),
  precio NUMERIC CHECK (precio >= 0),
  cilindrada TEXT CHECK (length(cilindrada) <= 20),
  color TEXT CHECK (length(color) <= 40),
  duenos SMALLINT CHECK (duenos BETWEEN 1 AND 9),           -- cantidad de dueños anteriores
  frase TEXT CHECK (length(frase) <= 140),                   -- frase corta para la tarjeta
  descripcion TEXT CHECK (length(descripcion) <= 1500),
  papeles_al_dia BOOLEAN NOT NULL DEFAULT true,
  service_al_dia BOOLEAN NOT NULL DEFAULT false,
  acepta_permuta BOOLEAN NOT NULL DEFAULT false,
  financiacion BOOLEAN NOT NULL DEFAULT false,
  imagen_url TEXT,
  imagenes TEXT[] NOT NULL DEFAULT '{}',
  estado TEXT NOT NULL DEFAULT 'disponible' CHECK (estado IN ('disponible', 'reservado', 'vendido')),
  visible_web BOOLEAN NOT NULL DEFAULT true,
  destacada BOOLEAN NOT NULL DEFAULT false,
  notas TEXT,                                                -- solo CRM
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usados_exclusivos_web_idx
  ON public.usados_exclusivos (visible_web, estado, destacada DESC, created_at DESC);

CREATE OR REPLACE FUNCTION public.usados_exclusivos_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.usados_exclusivos_touch() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS usados_exclusivos_touch ON public.usados_exclusivos;
CREATE TRIGGER usados_exclusivos_touch BEFORE UPDATE ON public.usados_exclusivos
  FOR EACH ROW EXECUTE FUNCTION public.usados_exclusivos_touch();

-- --------------------------------------------
-- Acceso
-- --------------------------------------------
ALTER TABLE public.usados_exclusivos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usados_web_select ON public.usados_exclusivos;
DROP POLICY IF EXISTS usados_crm_select ON public.usados_exclusivos;
DROP POLICY IF EXISTS usados_admin_all ON public.usados_exclusivos;

-- Web: solo publicadas y no vendidas
CREATE POLICY usados_web_select ON public.usados_exclusivos FOR SELECT TO anon
  USING (visible_web AND estado IN ('disponible', 'reservado'));
-- CRM: cualquier usuario con sesión las ve; solo un admin las crea, edita o borra
CREATE POLICY usados_crm_select ON public.usados_exclusivos FOR SELECT TO authenticated
  USING (true);
CREATE POLICY usados_admin_all ON public.usados_exclusivos FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- La web lee columna por columna: las notas internas quedan fuera aunque pida "todo".
REVOKE ALL ON public.usados_exclusivos FROM anon;
GRANT SELECT (id, marca, modelo, anio, km, precio, cilindrada, color, duenos, frase, descripcion,
  papeles_al_dia, service_al_dia, acepta_permuta, financiacion, imagen_url, imagenes, estado,
  visible_web, destacada, created_at)
  ON public.usados_exclusivos TO anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.usados_exclusivos FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.usados_exclusivos TO authenticated;

-- El CRM se actualiza solo cuando otro admin carga o cambia un usado.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'usados_exclusivos')
     AND EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.usados_exclusivos;
  END IF;
END;
$$;
