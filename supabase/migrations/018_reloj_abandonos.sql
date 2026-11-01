-- 018: reloj de seguimiento para los leads que dejaron la calificación a medias.
-- El webhook (accion sin_cierre) los crea ~4 h después del último mensaje del cliente (agente 1 h +
-- recordatorio + agente 3 h) y sin bot_ultimo_evento_at, así que seguimiento-auto nunca les escribía.
-- Se les pone como reloj created_at - 4 h, que es cuándo habló el cliente por última vez.

create or replace function public.leads_reloj_abandono()
returns trigger
language plpgsql
as $$
begin
  if new.bot_ultimo_evento_at is null and coalesce(new.notas, '') like '%sin terminar la calificación%' then
    new.bot_ultimo_evento_at := coalesce(new.created_at, now()) - interval '4 hours';
  end if;
  return new;
end;
$$;

drop trigger if exists leads_reloj_abandono on public.leads;
create trigger leads_reloj_abandono
  before insert on public.leads
  for each row execute function public.leads_reloj_abandono();

update public.leads
set bot_ultimo_evento_at = created_at - interval '4 hours'
where bot_ultimo_evento_at is null
  and notas like '%sin terminar la calificación%';
