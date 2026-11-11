-- 024: próximo paso de cada lead. La pantalla "Para vender hoy" arma la cola del vendedor con esto.
-- proximo_contacto_at: cuándo vuelve a aparecer en la cola. ultimo_contacto_at / contacto_intentos:
-- último contacto humano registrado y cuántas veces se intentó sin avanzar.

alter table public.leads add column if not exists proximo_contacto_at timestamptz;
alter table public.leads add column if not exists ultimo_contacto_at timestamptz;
alter table public.leads add column if not exists contacto_intentos integer not null default 0;

create index if not exists leads_proximo_contacto_idx on public.leads (proximo_contacto_at) where proximo_contacto_at is not null;
