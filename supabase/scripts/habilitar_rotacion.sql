-- ============================================
-- Poner a Vendedor 1 y Vendedor 2 en la rotación de leads aprobados.
-- "Empleado MotoBox" y "pruebae" quedan afuera (no son vendedores reales).
-- Requiere la migración 009. Modifica 2 registros existentes de profiles: correr el PASO 1,
-- revisar y recién con OK correr el PASO 2.
-- ============================================

-- PASO 1 — SIMULACIÓN (no cambia nada). Tiene que mostrar 2 filas: hoy = false, quedaria = true.
SELECT id, full_name, role, recibe_leads AS hoy, true AS quedaria
  FROM public.profiles
 WHERE id IN ('5358f97a-825d-49ae-b9d3-8d9cb4203dfd',   -- Vendedor 1
              '49dbaf34-2fc2-4d9d-b810-18dbe39b32c0');  -- Vendedor 2

-- PASO 2 — APLICAR (solo con OK). Tiene que decir "UPDATE 2".
-- BEGIN;
-- UPDATE public.profiles
--    SET recibe_leads = true
--  WHERE id IN ('5358f97a-825d-49ae-b9d3-8d9cb4203dfd', '49dbaf34-2fc2-4d9d-b810-18dbe39b32c0')
--    AND recibe_leads = false;
-- COMMIT;

-- PARA DESHACER
-- UPDATE public.profiles SET recibe_leads = false
--  WHERE id IN ('5358f97a-825d-49ae-b9d3-8d9cb4203dfd', '49dbaf34-2fc2-4d9d-b810-18dbe39b32c0');
