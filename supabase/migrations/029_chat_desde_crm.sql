-- 029: conversación completa en la ficha del lead.
-- Los primeros mensajes de una charla llegan antes de que exista el lead (se crea cuando Valen termina de calificar),
-- así que quedaban sin lead_id y el vendedor no los veía. Cuando el lead aparece (o cambia su contacto de SendPulse)
-- se le asignan todos los mensajes de ese contacto.

create or replace function public.leads_vincular_eventos()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.sendpulse_contact_id is not null and new.duplicado_de is null then
    update public.agente_eventos set lead_id = new.id
     where contact_id = new.sendpulse_contact_id and lead_id is null;
  end if;
  return null;
exception when others then
  return null;
end;
$$;

drop trigger if exists trg_leads_vincular_eventos on public.leads;
create trigger trg_leads_vincular_eventos
  after insert or update of sendpulse_contact_id on public.leads
  for each row execute function public.leads_vincular_eventos();

-- Lo que ya está guardado.
update public.agente_eventos e set lead_id = l.id
  from public.leads l
 where e.lead_id is null and e.contact_id is not null
   and l.sendpulse_contact_id = e.contact_id and l.duplicado_de is null;
