-- BMSN — historial de Jugadores del mes anotados a mano (meses anteriores a las votaciones
-- automáticas, o correcciones). Los que salen de una final cerrada se calculan solos.
-- Ejecutar después de 11_avisos.sql. Se puede ejecutar varias veces.

create table if not exists public.jugadores_mes (
  mes text primary key check (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  persona_id uuid not null references public.personas(id) on delete cascade,
  creado timestamptz not null default now()
);
create index if not exists jugadores_mes_persona_idx on public.jugadores_mes(persona_id);
alter table public.jugadores_mes enable row level security;
grant select on public.jugadores_mes to anon, authenticated;
grant insert, update, delete on public.jugadores_mes to authenticated;
drop policy if exists "leer" on public.jugadores_mes;
drop policy if exists "admin inserta" on public.jugadores_mes;
drop policy if exists "admin cambia" on public.jugadores_mes;
drop policy if exists "admin borra" on public.jugadores_mes;
create policy "leer" on public.jugadores_mes for select using (true);
create policy "admin inserta" on public.jugadores_mes for insert to authenticated with check ((select public.es_admin()));
create policy "admin cambia" on public.jugadores_mes for update to authenticated using ((select public.es_admin())) with check ((select public.es_admin()));
create policy "admin borra" on public.jugadores_mes for delete to authenticated using ((select public.es_admin()));

-- Las copias de seguridad incluyen también este historial
create or replace function public.bmsn_volcado() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'version', 3, 'fecha', now(),
    'personas',      (select coalesce(jsonb_agg(to_jsonb(p) order by p.nombre), '[]') from personas p),
    'planes',        (select coalesce(jsonb_agg(to_jsonb(p) order by p.fecha), '[]') from planes p),
    'asistencias',   (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from asistencias a),
    'encuestas',     (select coalesce(jsonb_agg(to_jsonb(e) order by e.creado), '[]') from encuestas e),
    'votos',         (select coalesce(jsonb_agg(to_jsonb(v)), '[]') from votos v),
    'solicitudes',   (select coalesce(jsonb_agg(to_jsonb(s) order by s.creado), '[]') from solicitudes s),
    'jugadores_mes', (select coalesce(jsonb_agg(to_jsonb(j) order by j.mes), '[]') from jugadores_mes j),
    'admins',        (select coalesce(jsonb_agg(a.email), '[]') from admins a)
  )
$$;
revoke execute on function public.bmsn_volcado() from public, anon, authenticated;
