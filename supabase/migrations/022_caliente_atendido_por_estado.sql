-- 022: un lead caliente se da por atendido cuando el vendedor le cambia el estado.
-- Los vendedores escribían al cliente y pasaban el lead a "contactado" sin tocar
-- "Listo" en la alerta naranja, así que la alerta mostraba leads ya atendidos.

create or replace function public.leads_caliente_atendido_por_estado()
returns trigger
language plpgsql
as $$
begin
  if new.caliente_at is not null
     and new.caliente_atendido_at is null
     and old.estado = 'nuevo'
     and new.estado is distinct from 'nuevo' then
    new.caliente_atendido_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_leads_caliente_atendido_por_estado on public.leads;
create trigger trg_leads_caliente_atendido_por_estado
  before update of estado on public.leads
  for each row execute function public.leads_caliente_atendido_por_estado();

-- Ponerse al día: calientes que ya no están en "nuevo" quedan como atendidos.
update public.leads
   set caliente_atendido_at = coalesce(primer_contacto_at, updated_at, now())
 where caliente_at is not null
   and caliente_atendido_at is null
   and estado <> 'nuevo';
