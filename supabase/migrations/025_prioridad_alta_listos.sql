-- 025: todo lead que aparece en "Para vender hoy" como listo para comprar es de prioridad alta.
-- Antes la prioridad la ponía solo el bot y quedaban calientes en "media" y aprobados en "baja".

create or replace function public.leads_prioridad_alta()
returns trigger
language plpgsql
as $$
begin
  if new.estado not in ('venta_cerrada', 'perdido')
     and (new.caliente_at is not null or new.estado_dni = 'aprobado' or new.bcra_resultado = 'apto') then
    new.prioridad := 'alta';
  end if;
  return new;
end;
$$;

-- El nombre lo hace correr después de trg_leads_marcar_caliente (los triggers van por orden alfabético).
drop trigger if exists trg_leads_prioridad_alta on public.leads;
create trigger trg_leads_prioridad_alta
  before insert or update on public.leads
  for each row execute function public.leads_prioridad_alta();

update public.leads set prioridad = 'alta'
 where prioridad is distinct from 'alta'
   and estado not in ('venta_cerrada', 'perdido')
   and (caliente_at is not null or estado_dni = 'aprobado' or bcra_resultado = 'apto');
