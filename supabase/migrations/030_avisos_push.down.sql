drop trigger if exists trg_leads_aviso_push on public.leads;
drop function if exists public.leads_aviso_push();
delete from public.crm_config where clave in ('push_url', 'push_vapid_publica');
delete from public.secretos_internos where clave = 'push_token';
drop table if exists public.push_suscripciones;
