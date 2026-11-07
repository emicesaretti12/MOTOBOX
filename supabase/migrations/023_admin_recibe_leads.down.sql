create or replace function public.asignacion_siguiente_vendedor()
returns uuid
language sql
security definer
set search_path to 'public'
as $$
  SELECT p.id
    FROM public.profiles p
    LEFT JOIN LATERAL (
      SELECT max(a.created_at) AS ultima FROM public.asignaciones_lead a WHERE a.vendedor_id = p.id
    ) u ON true
   WHERE p.role = 'empleado' AND p.recibe_leads
   ORDER BY u.ultima ASC NULLS FIRST, p.created_at ASC, p.id
   LIMIT 1;
$$;

update public.profiles set recibe_leads = (full_name in ('Vendedor 1', 'Vendedor 2'))
 where recibe_leads or full_name in ('Vendedor 1', 'Vendedor 2');
