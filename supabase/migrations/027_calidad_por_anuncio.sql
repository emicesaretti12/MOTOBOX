-- 027: calidad de leads por anuncio.
-- El primer mensaje que llega desde un anuncio de Meta trae el id del anuncio (referral). Se guarda en
-- agente_eventos y la vista calidad_anuncios cruza cada conversación con el lead que generó: cuántos
-- quedaron listos para comprar, cuántos aprobaron el DNI, cuántos agendaron visita y cuántos compraron.
-- ctwa_clid queda guardado para devolverle a Meta qué leads fueron buenos (API de conversiones).

alter table public.agente_eventos
  add column if not exists anuncio_id text,
  add column if not exists anuncio_titulo text,
  add column if not exists ctwa_clid text;

create index if not exists agente_eventos_anuncio_idx on public.agente_eventos (anuncio_id) where anuncio_id is not null;

-- Nombre de cada anuncio tal como está en el Administrador de anuncios (el webhook solo trae el id).
create table if not exists public.anuncios_meta (
  id text primary key,
  nombre text not null,
  campania text,
  updated_at timestamptz not null default now()
);
alter table public.anuncios_meta enable row level security;
drop policy if exists anuncios_meta_select on public.anuncios_meta;
create policy anuncios_meta_select on public.anuncios_meta for select using (public.is_admin());

insert into public.anuncios_meta (id, nombre, campania) values
  ('120248835387240772', 'WA | Honda Wave S 110', 'WhatsApp | Contado Córdoba'),
  ('120248835386970772', 'WA | Video 3 motos', 'WhatsApp | Contado Córdoba'),
  ('120248835387140772', 'WA | Keller Crono 110 Full', 'WhatsApp | Contado Córdoba'),
  ('120248834738330772', 'WA | Keller Stratus 150', 'WhatsApp | Contado Córdoba'),
  ('120248187598580772', 'IG | Motos 2 · Llevátela hoy', 'IG Direct | Principal Córdoba'),
  ('120248722084610772', 'IG | NUEVO · Honda Wave', 'IG Direct | Principal Córdoba'),
  ('120248722081500772', 'IG | NUEVO · Keller Stratus', 'IG Direct | Principal Córdoba'),
  ('120248722083190772', 'IG | NUEVO · Keller Crono', 'IG Direct | Principal Córdoba'),
  ('120248835385050772', 'IG | CONTADO · Video 3 motos', 'IG Direct | Principal Córdoba'),
  ('120248835385540772', 'IG | CONTADO · Keller Crono 110 Full', 'IG Direct | Principal Córdoba'),
  ('120248835386530772', 'IG | CONTADO · Honda Wave S 110', 'IG Direct | Principal Córdoba'),
  ('120248832454990772', 'IG | CONTADO · Keller Stratus 150', 'IG Direct | Principal Córdoba')
on conflict (id) do update set nombre = excluded.nombre, campania = excluded.campania, updated_at = now();

-- Una fila por conversación que vino de un anuncio (el primer referral de cada contacto) con su lead.
create or replace view public.calidad_anuncios_detalle with (security_invoker = true) as
with origen as (
  select distinct on (e.contact_id) e.contact_id, e.canal, e.anuncio_id, e.anuncio_titulo, e.ctwa_clid, e.created_at
  from public.agente_eventos e
  where e.anuncio_id is not null and e.contact_id is not null
  order by e.contact_id, e.created_at
)
select o.contact_id, o.canal, o.anuncio_id, coalesce(a.nombre, o.anuncio_titulo, o.anuncio_id) as anuncio,
       o.ctwa_clid, o.created_at as llego_at,
       l.id as lead_id, l.estado, l.prioridad, l.forma_pago, l.estado_dni, l.bcra_resultado, l.fecha_agenda, l.caliente_at
from origen o
left join public.anuncios_meta a on a.id = o.anuncio_id
left join lateral (
  select * from public.leads l where l.sendpulse_contact_id = o.contact_id and l.duplicado_de is null
  order by l.created_at desc limit 1
) l on true;

create or replace view public.calidad_anuncios with (security_invoker = true) as
select anuncio_id, min(anuncio) as anuncio, min(canal) as canal,
       count(*) as conversaciones,
       count(lead_id) as leads,
       count(*) filter (where forma_pago is not null) as dijeron_como_pagan,
       count(*) filter (where prioridad = 'alta') as listos_para_comprar,
       count(*) filter (where estado_dni = 'aprobado' or bcra_resultado = 'apto') as dni_aprobado,
       count(*) filter (where estado_dni = 'rechazado' or bcra_resultado = 'no_apto') as dni_rechazado,
       count(*) filter (where fecha_agenda is not null) as con_visita,
       count(*) filter (where estado = 'venta_cerrada') as ventas,
       min(llego_at) as desde, max(llego_at) as hasta
from public.calidad_anuncios_detalle
group by anuncio_id;
