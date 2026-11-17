drop view if exists public.calidad_anuncios;
drop view if exists public.calidad_anuncios_detalle;
drop table if exists public.anuncios_meta;
drop index if exists public.agente_eventos_anuncio_idx;
alter table public.agente_eventos drop column if exists anuncio_id, drop column if exists anuncio_titulo, drop column if exists ctwa_clid;
