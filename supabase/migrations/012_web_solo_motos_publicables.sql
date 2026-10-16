-- La web pública (motobox-web, rol anon) solo debe ver motos visibles y disponibles.
-- Antes: dos políticas con USING (true) para todos los roles dejaban leer todo el inventario,
-- incluidas motos ocultas y vendidas (la web filtraba 'vendida', pero el estado real es 'vendido').
-- El CRM (authenticated) no cambia: sigue con inventario_select y inventario_admin_all.
ALTER POLICY inventario_empleado_select ON public.inventario_motos TO authenticated;
ALTER POLICY inventario_public_select ON public.inventario_motos TO anon
  USING (visible_web IS NOT FALSE AND estado = 'disponible');
