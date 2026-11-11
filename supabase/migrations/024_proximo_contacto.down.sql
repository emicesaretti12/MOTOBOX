drop index if exists public.leads_proximo_contacto_idx;
alter table public.leads drop column if exists contacto_intentos;
alter table public.leads drop column if exists ultimo_contacto_at;
alter table public.leads drop column if exists proximo_contacto_at;
