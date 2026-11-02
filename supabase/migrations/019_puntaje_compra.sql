-- 019: puntaje de probabilidad de compra (0-100) y marca de duplicados.
--
-- El puntaje sale de lo que tuvieron en común las ventas cerradas y las negociaciones del CRM
-- (backtest al 01/11/2026: ventas promedio 61, negociación 63, perdidos 38):
--   + forma de pago fuerte (contado / tarjeta / Naranja / efectivo)   +25
--   + anticipo en efectivo                                              +15
--   + crédito aprobado (Credicuotas o monto aprobado)                   +30
--   + BCRA apto                                                         +5
--   - DNI rechazado / BCRA no apto sin otra forma de pago               -20 (-5 si tiene alternativa)
--   + modelo concreto                                                   +10
--   + vino al local, referido o WhatsApp                               +10
--   + visita agendada +10, en negociación +15
--   + teléfono válido +10 ; sin teléfono -40 (no se puede contactar)
--   - "no le interesa", "caro", "no responde", número mal, duplicado    -20
--   + actividad reciente (≤3 días +15, ≤10 +8, >30 -8, >60 -15)
-- Se recalcula solo en cada alta o cambio del lead (trigger). puntaje_motivo explica el número.

alter table public.leads
  add column if not exists puntaje_compra smallint,
  add column if not exists puntaje_motivo text,
  add column if not exists duplicado_de uuid references public.leads(id) on delete set null;

create or replace function public.calcular_puntaje_lead(l public.leads)
returns table (puntaje smallint, motivo text)
language plpgsql
stable
as $$
declare
  -- Solo lo que dijo el cliente o anotó un vendedor: se sacan las líneas automáticas (bot, seguimiento, CRM),
  -- que mencionan "tarjeta", "anticipo" o "rechazado" como sugerencia y no como dato del cliente.
  humano text := regexp_replace(coalesce(l.notas, ''),
    '(\[[^\]\n]*\]\s*(Bot|Seguimiento automático|CRM:|WhatsApp:|RESCATE|VISITA AGENDADA)[^\n]*|Nuevo contacto vía[^\n]*|Campaña Instagram[^\n]*)', '', 'g');
  txt text := lower(humano || ' ' || coalesce(l.nombre, '') || ' ' || coalesce(l.modelo_interes, '') || ' ' || coalesce(l.anticipo, ''));
  dig int := length(regexp_replace(coalesce(l.telefono, ''), '\D', '', 'g'));
  pago_fuerte boolean := l.forma_pago in ('contado', 'tarjeta') or txt ~ '(contado|efectivo|tarjeta|naranja|visa|master|cordobesa|transferencia)';
  ant boolean := l.forma_pago = 'anticipo_cuotas' or l.anticipo is not null or txt ~ '(anticipo|mitad|entrega de)';
  aprob boolean := l.estado_dni = 'aprobado' or coalesce(l.monto_aprobado, 0) > 0 or txt ~ '(aprobad|aprovad)';
  rech boolean := l.estado_dni = 'rechazado' or l.bcra_resultado = 'no_apto' or txt ~ '(rechaz|no aprueba|no califica|menor de 21|dni menor)';
  -- Lo negativo sí se toma también de las notas del bot ("el cliente dijo que no le interesa").
  neg boolean := lower(coalesce(l.notas, '') || ' ' || coalesce(l.nombre, '')) ~ '(no le interesa|no interesa|no responde|no contesta|\mcaro\M|ya compr|duplicad|numero mal|número mal|telefono mal|teléfono mal|falta (el )?n)';
  -- Actividad real del cliente (no updated_at, que cambia con cualquier edición o recálculo).
  ultima timestamptz := greatest(l.created_at, coalesce(l.bot_ultimo_evento_at, l.created_at), coalesce(l.primer_contacto_at, l.created_at));
  dias numeric := extract(epoch from (now() - ultima)) / 86400;
  p int := 30;
  m text[] := '{}';
begin
  if pago_fuerte then p := p + 25; m := array_append(m, 'contado/tarjeta'); end if;
  if ant then p := p + 15; m := array_append(m, 'anticipo'); end if;
  if aprob then p := p + 30; m := array_append(m, 'crédito aprobado'); end if;
  if l.bcra_resultado = 'apto' and not rech then p := p + 5; m := array_append(m, 'BCRA apto'); end if;
  if rech then
    if pago_fuerte or ant or aprob then p := p - 5; m := array_append(m, 'DNI rechazado (tiene alternativa)');
    else p := p - 20; m := array_append(m, 'DNI rechazado'); end if;
  end if;
  if l.modelo_interes ~* '[a-z]{3,}' then p := p + 10; m := array_append(m, 'modelo definido'); end if;
  if l.origen in ('presencial', 'referido', 'whatsapp') then p := p + 10; m := array_append(m, l.origen::text); end if;
  if l.fecha_agenda is not null then p := p + 10; m := array_append(m, 'visita agendada'); end if;
  if l.estado = 'en_negociacion' then p := p + 15; m := array_append(m, 'en negociación'); end if;
  if dig >= 10 then p := p + 10; else p := p - 40; m := array_append(m, 'SIN TELÉFONO VÁLIDO'); end if;
  if neg then p := p - 20; m := array_append(m, 'nota negativa'); end if;
  if dias <= 3 then p := p + 15; m := array_append(m, 'activo hace ≤3 días');
  elsif dias <= 10 then p := p + 8; m := array_append(m, 'activo hace ≤10 días');
  elsif dias > 60 then p := p - 15; m := array_append(m, 'sin actividad +60 días');
  elsif dias > 30 then p := p - 8; m := array_append(m, 'sin actividad +30 días');
  end if;
  puntaje := greatest(0, least(100, p))::smallint;
  motivo := array_to_string(m, ' · ');
  return next;
end;
$$;

create or replace function public.leads_puntaje_trigger()
returns trigger
language plpgsql
as $$
declare r record;
begin
  select * into r from public.calcular_puntaje_lead(new);
  new.puntaje_compra := r.puntaje;
  new.puntaje_motivo := r.motivo;
  return new;
end;
$$;

drop trigger if exists leads_puntaje on public.leads;
create trigger leads_puntaje
  before insert or update of nombre, telefono, notas, modelo_interes, origen, estado, forma_pago, anticipo,
    estado_dni, monto_aprobado, bcra_resultado, fecha_agenda, bot_ultimo_evento_at
  on public.leads
  for each row execute function public.leads_puntaje_trigger();

create index if not exists leads_puntaje_idx on public.leads (puntaje_compra desc nulls last);

-- Recalcula todos los puntajes (el de actividad reciente baja con los días). Solo toca los que cambian.
create or replace function public.recalcular_puntajes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  update public.leads l
  set puntaje_compra = r.puntaje, puntaje_motivo = r.motivo
  from public.leads x
  cross join lateral public.calcular_puntaje_lead(x) r
  where l.id = x.id
    and (l.puntaje_compra is distinct from r.puntaje or l.puntaje_motivo is distinct from r.motivo);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.recalcular_puntajes() from public, anon, authenticated;

select cron.schedule('recalcular-puntajes', '0 9 * * *', 'select public.recalcular_puntajes()');
