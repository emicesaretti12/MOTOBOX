select cron.unschedule('recalcular-puntajes');
drop function if exists public.recalcular_puntajes();
drop trigger if exists leads_puntaje on public.leads;
drop function if exists public.leads_puntaje_trigger();
drop function if exists public.calcular_puntaje_lead(public.leads);
drop index if exists public.leads_puntaje_idx;
alter table public.leads drop column if exists puntaje_compra, drop column if exists puntaje_motivo, drop column if exists duplicado_de;
