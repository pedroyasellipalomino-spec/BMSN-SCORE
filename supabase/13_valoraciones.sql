-- BMSN — valorar qué tal estuvo un plan (1 a 5 estrellas + comentario opcional).
-- Solo pueden valorar los que fueron. Todos ven la media y cuántos votaron;
-- lo que puso cada uno solo lo ve esa persona y el admin.
-- Ejecutar después de 12_jugadores_mes.sql. Se puede ejecutar varias veces.

create table if not exists public.valoraciones (
  plan_id uuid not null references public.planes(id) on delete cascade,
  persona_id uuid not null references public.personas(id) on delete cascade,
  estrellas smallint not null check (estrellas between 1 and 5),
  comentario text not null default '' check (char_length(comentario) <= 200),
  creado timestamptz not null default now(),
  editado timestamptz not null default now(),
  primary key (plan_id, persona_id)
);
create index if not exists valoraciones_persona_idx on public.valoraciones(persona_id);
alter table public.valoraciones enable row level security;
revoke all on public.valoraciones from anon;
grant select on public.valoraciones to authenticated;
drop policy if exists "ver valoraciones" on public.valoraciones;
create policy "ver valoraciones" on public.valoraciones for select to authenticated
  using ((select public.es_admin()) or persona_id = (select public.mi_persona()));

-- Valorar (o cambiar la valoración). p_estrellas null = quitar mi valoración.
create or replace function public.valorar_plan(p_plan uuid, p_estrellas int, p_comentario text default '') returns void
language plpgsql security definer set search_path = public as $$
declare yo uuid := mi_persona(); f date;
begin
  if yo is null then raise exception 'Primero elige tu perfil (¿Quién eres?)'; end if;
  select fecha into f from planes where id = p_plan;
  if not found then raise exception 'Ese plan no existe'; end if;
  if p_estrellas is null then
    delete from valoraciones where plan_id = p_plan and persona_id = yo;
    return;
  end if;
  if not exists (select 1 from asistencias where plan_id = p_plan and persona_id = yo) then
    raise exception 'Solo pueden valorar los que fueron al plan';
  end if;
  if f > (now() at time zone 'America/Lima')::date then raise exception 'Ese plan aún no ha pasado'; end if;
  if p_estrellas not between 1 and 5 then raise exception 'Elige de 1 a 5 estrellas'; end if;
  insert into valoraciones(plan_id, persona_id, estrellas, comentario)
    values (p_plan, yo, p_estrellas, left(btrim(coalesce(p_comentario, '')), 200))
  on conflict (plan_id, persona_id) do update
    set estrellas = excluded.estrellas, comentario = excluded.comentario, editado = now();
end $$;

-- Media pública por plan (solo cuentan los que siguen apuntados al plan)
create or replace function public.valoraciones_resumen()
returns table(plan_id uuid, media numeric, n int)
language sql stable security definer set search_path = public as $$
  select v.plan_id, round(avg(v.estrellas), 2), count(*)::int
  from valoraciones v
  join asistencias a on a.plan_id = v.plan_id and a.persona_id = v.persona_id
  group by v.plan_id
$$;

revoke execute on function public.valorar_plan(uuid, int, text) from public, anon;
grant execute on function public.valorar_plan(uuid, int, text) to authenticated;
revoke execute on function public.valoraciones_resumen() from public;
grant execute on function public.valoraciones_resumen() to anon, authenticated;

-- Las copias de seguridad incluyen también las valoraciones
create or replace function public.bmsn_volcado() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'version', 4, 'fecha', now(),
    'personas',      (select coalesce(jsonb_agg(to_jsonb(p) order by p.nombre), '[]') from personas p),
    'planes',        (select coalesce(jsonb_agg(to_jsonb(p) order by p.fecha), '[]') from planes p),
    'asistencias',   (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from asistencias a),
    'encuestas',     (select coalesce(jsonb_agg(to_jsonb(e) order by e.creado), '[]') from encuestas e),
    'votos',         (select coalesce(jsonb_agg(to_jsonb(v)), '[]') from votos v),
    'solicitudes',   (select coalesce(jsonb_agg(to_jsonb(s) order by s.creado), '[]') from solicitudes s),
    'jugadores_mes', (select coalesce(jsonb_agg(to_jsonb(j) order by j.mes), '[]') from jugadores_mes j),
    'valoraciones',  (select coalesce(jsonb_agg(to_jsonb(v)), '[]') from valoraciones v),
    'admins',        (select coalesce(jsonb_agg(a.email), '[]') from admins a)
  )
$$;
revoke execute on function public.bmsn_volcado() from public, anon, authenticated;
