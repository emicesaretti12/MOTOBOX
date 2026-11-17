drop function if exists public.registrar_venta(uuid, numeric, text, uuid, text, timestamptz, text);
drop trigger if exists trg_ventas_completar_cliente on public.ventas;
drop function if exists public.ventas_completar_cliente();
alter table public.ventas drop column if exists metodo_pago, drop column if exists modelo;
