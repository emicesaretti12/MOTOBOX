-- ============================================
-- Habilitar a Vendedor 1 y Vendedor 2 para verificar DNIs.
-- (Los admin ya pueden verificar sin hacer nada.)
-- Requiere la migración 008. Modifica 2 registros existentes de profiles: correr el PASO 1,
-- revisar el resultado y recién con OK correr el PASO 2.
-- ============================================

-- PASO 1 — SIMULACIÓN (no cambia nada). Tiene que mostrar 2 filas: hoy = false, quedaria = true.
SELECT id, full_name, role, verifica_dni AS hoy, true AS quedaria
  FROM public.profiles
 WHERE id IN ('5358f97a-825d-49ae-b9d3-8d9cb4203dfd',   -- Vendedor 1
              '49dbaf34-2fc2-4d9d-b810-18dbe39b32c0');  -- Vendedor 2

-- PASO 2 — APLICAR (solo con OK). Tiene que decir "UPDATE 2".
-- BEGIN;
-- UPDATE public.profiles
--    SET verifica_dni = true
--  WHERE id IN ('5358f97a-825d-49ae-b9d3-8d9cb4203dfd', '49dbaf34-2fc2-4d9d-b810-18dbe39b32c0')
--    AND verifica_dni = false;
-- COMMIT;

-- PARA DESHACER
-- UPDATE public.profiles SET verifica_dni = false
--  WHERE id IN ('5358f97a-825d-49ae-b9d3-8d9cb4203dfd', '49dbaf34-2fc2-4d9d-b810-18dbe39b32c0');
