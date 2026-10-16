ALTER POLICY inventario_empleado_select ON public.inventario_motos TO public;
ALTER POLICY inventario_public_select ON public.inventario_motos TO public USING (true);
