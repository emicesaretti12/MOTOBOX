-- 030: avisos push con la app cerrada.
-- Cada celular/compu que activa los avisos guarda su suscripción. Cuando un lead se vuelve "listo para comprar"
-- (caliente_at) o cambia de vendedor, la base llama a la función enviar-push, que avisa al vendedor asignado
-- (o a los admins si no tiene). No modifica datos existentes.

create table if not exists public.push_suscripciones (
  endpoint text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  dispositivo text,
  created_at timestamptz not null default now(),
  ultimo_envio_at timestamptz
);
create index if not exists push_suscripciones_user_idx on public.push_suscripciones (user_id);

alter table public.push_suscripciones enable row level security;
drop policy if exists push_propias_ver on public.push_suscripciones;
drop policy if exists push_propias_alta on public.push_suscripciones;
drop policy if exists push_propias_cambio on public.push_suscripciones;
drop policy if exists push_propias_baja on public.push_suscripciones;
create policy push_propias_ver on public.push_suscripciones for select to authenticated using (user_id = auth.uid());
create policy push_propias_alta on public.push_suscripciones for insert to authenticated with check (user_id = auth.uid());
create policy push_propias_cambio on public.push_suscripciones for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_propias_baja on public.push_suscripciones for delete to authenticated using (user_id = auth.uid());
revoke all on public.push_suscripciones from anon;
grant select, insert, update, delete on public.push_suscripciones to authenticated;

-- Token con el que la base se identifica ante la función (solo lo lee el servidor).
insert into public.secretos_internos (clave, valor)
values ('push_token', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (clave) do nothing;

-- push_url: URL de la función enviar-push. push_vapid_publica: clave pública para suscribirse (no es secreta).
insert into public.crm_config (clave, valor, descripcion) values
  ('push_url', '""'::jsonb, 'URL de la función enviar-push (avisos con la app cerrada)'),
  ('push_vapid_publica', '""'::jsonb, 'Clave pública VAPID para los avisos push')
on conflict (clave) do nothing;

create or replace function public.leads_aviso_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_token text;
begin
  if new.caliente_at is null or new.caliente_atendido_at is not null or new.duplicado_de is not null
     or new.estado in ('venta_cerrada', 'perdido') then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.caliente_at is not distinct from new.caliente_at
     and old.vendedor_asignado is not distinct from new.vendedor_asignado then
    return null;
  end if;
  select valor #>> '{}' into v_url from public.crm_config where clave = 'push_url';
  select valor into v_token from public.secretos_internos where clave = 'push_token';
  if coalesce(v_url, '') = '' or v_token is null then return null; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_token),
    body := jsonb_build_object('lead_id', new.id),
    timeout_milliseconds := 10000);
  return null;
exception when others then
  return null; -- un aviso que falla nunca frena el guardado del lead
end;
$$;

drop trigger if exists trg_leads_aviso_push on public.leads;
create trigger trg_leads_aviso_push
  after insert or update of caliente_at, vendedor_asignado on public.leads
  for each row execute function public.leads_aviso_push();
