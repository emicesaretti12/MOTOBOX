update public.leads set forma_pago = 'contado' where forma_pago = 'tarjeta';
alter table public.leads drop constraint if exists leads_forma_pago_check;
alter table public.leads add constraint leads_forma_pago_check
  check (forma_pago is null or forma_pago = any (array['cuotas', 'anticipo_cuotas', 'contado']));
