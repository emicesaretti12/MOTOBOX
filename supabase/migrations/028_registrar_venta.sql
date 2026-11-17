-- 028: registrar una venta en un toque desde el lead.
-- Hasta acá la pantalla de Ventas no podía guardar: ventas.cliente_id es obligatorio y el formulario no lo mandaba,
-- y mandaba metodo_pago, que no existía. Por eso no había ninguna venta cargada.
--   * ventas.metodo_pago y ventas.modelo (cuando la moto no está en el inventario).
--   * Trigger: si la venta no trae cliente, lo busca o lo crea a partir del lead (teléfono, email o DNI).
--   * registrar_venta(): crea la venta y cierra el lead, todo junto.

alter table public.ventas
  add column if not exists metodo_pago text,
  add column if not exists modelo text;

create or replace function public.ventas_completar_cliente()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  l record;
  cid uuid;
begin
  if new.cliente_id is not null then return new; end if;
  if new.lead_id is not null then
    select nombre, telefono, email, dni into l from public.leads where id = new.lead_id;
    if found then
      select c.id into cid from public.clientes c
       where (l.telefono is not null and regexp_replace(c.telefono, '\D', '', 'g') <> ''
              and right(regexp_replace(c.telefono, '\D', '', 'g'), 10) = right(regexp_replace(l.telefono, '\D', '', 'g'), 10))
          or (l.email is not null and lower(c.email) = lower(l.email))
          or (l.dni is not null and c.dni = l.dni)
       order by c.created_at limit 1;
      if cid is null then
        insert into public.clientes (full_name, telefono, email, dni)
        values (coalesce(nullif(trim(l.nombre), ''), 'Cliente'), l.telefono, l.email, l.dni)
        returning id into cid;
      end if;
    end if;
  end if;
  if cid is null then
    insert into public.clientes (full_name) values ('Cliente sin datos') returning id into cid;
  end if;
  new.cliente_id := cid;
  return new;
end;
$$;

drop trigger if exists trg_ventas_completar_cliente on public.ventas;
create trigger trg_ventas_completar_cliente before insert on public.ventas
  for each row execute function public.ventas_completar_cliente();

create or replace function public.registrar_venta(
  p_lead_id uuid,
  p_precio numeric,
  p_metodo_pago text default null,
  p_moto_id uuid default null,
  p_modelo text default null,
  p_fecha timestamptz default now(),
  p_notas text default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  yo uuid := auth.uid();
  l record;
  vendedor uuid;
  vid uuid;
begin
  if yo is null then raise exception 'Sin sesión'; end if;
  if p_precio is null or p_precio <= 0 then raise exception 'Falta el precio de la venta'; end if;
  select id, vendedor_asignado, notas into l from public.leads where id = p_lead_id;
  if not found then raise exception 'Lead no encontrado'; end if;
  if not public.is_admin() and l.vendedor_asignado is distinct from yo and l.vendedor_asignado is not null then
    raise exception 'Este lead lo atiende otro vendedor';
  end if;
  if exists (select 1 from public.ventas where lead_id = p_lead_id) then
    raise exception 'Este lead ya tiene una venta registrada';
  end if;
  -- La venta es del vendedor que tenía el lead; si no tenía, de quien la registra.
  vendedor := coalesce(l.vendedor_asignado, yo);

  insert into public.ventas (lead_id, moto_id, modelo, vendedor_id, precio_venta, metodo_pago, fecha_venta, notas)
  values (p_lead_id, p_moto_id, nullif(trim(p_modelo), ''), vendedor, p_precio, nullif(p_metodo_pago, ''), coalesce(p_fecha, now()), nullif(trim(p_notas), ''))
  returning id into vid;

  update public.leads
     set estado = 'venta_cerrada',
         vendedor_asignado = vendedor,
         notas = concat_ws(E'\n', nullif(l.notas, ''),
                 '[' || to_char(now() at time zone 'America/Argentina/Cordoba', 'DD/MM HH24:MI') || '] CRM: venta registrada por $'
                 || to_char(p_precio, 'FM999G999G999') || coalesce(' (' || nullif(trim(p_modelo), '') || ')', ''))
   where id = p_lead_id;

  -- El inventario es por modelo (una fila por moto publicada en la web), no por unidad: no se toca el estado.
  return vid;
end;
$$;

revoke all on function public.registrar_venta(uuid, numeric, text, uuid, text, timestamptz, text) from public, anon;
grant execute on function public.registrar_venta(uuid, numeric, text, uuid, text, timestamptz, text) to authenticated;
