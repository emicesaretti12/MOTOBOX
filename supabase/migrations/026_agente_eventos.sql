-- 026: actividad del agente en tiempo real.
-- agente_eventos guarda cada mensaje que entra o sale por el bot (webhook de SendPulse) y cada dato que
-- el agente deja en un lead (forma de pago, modelo, DNI, derivación). El CRM lo muestra en vivo.

create table if not exists public.agente_eventos (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  canal text,                -- whatsapp | instagram
  tipo text not null,        -- mensaje_entrante | mensaje_saliente | dato | flujo | otro
  autor text,                -- cliente | agente | humano | sistema
  contact_id text,
  telefono text,
  nombre text,
  lead_id uuid references public.leads (id) on delete set null,
  texto text,
  raw jsonb
);

create index if not exists agente_eventos_fecha_idx on public.agente_eventos (created_at desc);
create index if not exists agente_eventos_lead_idx on public.agente_eventos (lead_id, created_at desc);
create index if not exists agente_eventos_contacto_idx on public.agente_eventos (contact_id, created_at desc);

alter table public.agente_eventos enable row level security;

drop policy if exists agente_eventos_admin_select on public.agente_eventos;
create policy agente_eventos_admin_select on public.agente_eventos
  for select using (public.is_admin());

drop policy if exists agente_eventos_vendedor_select on public.agente_eventos;
create policy agente_eventos_vendedor_select on public.agente_eventos
  for select using (exists (select 1 from public.leads l where l.id = agente_eventos.lead_id and l.vendedor_asignado = auth.uid()));

-- Solo escribe el servidor (webhook y triggers); nadie inserta desde el navegador.

-- Datos que el agente deja en el lead: un evento legible por cada cambio relevante.
create or replace function public.leads_registrar_evento_agente()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  partes text[] := '{}';
  canal text := case when new.origen::text in ('whatsapp', 'instagram') then new.origen::text end;
begin
  if tg_op = 'INSERT' then
    partes := array_append(partes, 'Nuevo lead');
  end if;
  if new.forma_pago is distinct from (case when tg_op = 'UPDATE' then old.forma_pago end) and new.forma_pago is not null then
    partes := array_append(partes, 'Forma de pago: ' || new.forma_pago::text);
  end if;
  if coalesce(new.modelo_interes, '') <> '' and new.modelo_interes is distinct from (case when tg_op = 'UPDATE' then old.modelo_interes end) then
    partes := array_append(partes, 'Moto: ' || new.modelo_interes);
  end if;
  if new.dni is distinct from (case when tg_op = 'UPDATE' then old.dni end) and new.dni is not null then
    partes := array_append(partes, 'Mandó DNI');
  end if;
  if new.bcra_resultado is distinct from (case when tg_op = 'UPDATE' then old.bcra_resultado end) and new.bcra_resultado is not null then
    partes := array_append(partes, 'Precalificación: ' || new.bcra_resultado);
  end if;
  if new.caliente_at is not null and (tg_op = 'INSERT' or old.caliente_at is null or new.caliente_at is distinct from old.caliente_at) then
    partes := array_append(partes, case when new.caliente_motivo = 'asesor' then 'Pidió hablar con un asesor' else 'Listo para comprar' end);
  end if;
  if tg_op = 'UPDATE' and coalesce(new.notas, '') ~* 'dejó la conversación sin terminar' and coalesce(old.notas, '') !~* 'dejó la conversación sin terminar' then
    partes := array_append(partes, 'Dejó la conversación sin terminar');
  end if;

  if array_length(partes, 1) > 0 then
    insert into public.agente_eventos (canal, tipo, autor, contact_id, telefono, nombre, lead_id, texto)
    values (canal, 'dato', case when auth.uid() is null then 'agente' else 'humano' end, new.sendpulse_contact_id, new.telefono, new.nombre, new.id, array_to_string(partes, ' · '));
  end if;
  return null;
exception when others then
  return null; -- nunca frenar el guardado del lead por el registro de actividad
end;
$$;

drop trigger if exists trg_leads_evento_agente on public.leads;
create trigger trg_leads_evento_agente
  after insert or update of forma_pago, modelo_interes, dni, bcra_resultado, caliente_at, notas on public.leads
  for each row execute function public.leads_registrar_evento_agente();

-- Tiempo real para el CRM.
do $$ begin
  alter publication supabase_realtime add table public.agente_eventos;
exception when duplicate_object then null; when undefined_object then null;
end $$;

-- Token del webhook de SendPulse. Tabla sin políticas: solo la lee el servidor (service role).
create table if not exists public.secretos_internos (clave text primary key, valor text not null, created_at timestamptz not null default now());
alter table public.secretos_internos enable row level security;
insert into public.secretos_internos (clave, valor)
values ('agente_webhook_token', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (clave) do nothing;
