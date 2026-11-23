-- BMSN — planes importados marcados + solicitudes de miembros ("Yo fui" y "Proponer plan").
-- Ejecutar después de 09_mejoras.sql. Se puede ejecutar varias veces.

-- ---------- Planes importados (asistentes repartidos, no exactos) ----------
alter table public.planes add column if not exists importado boolean not null default false;

-- ---------- Solicitudes ----------
create table if not exists public.solicitudes (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('asistencia', 'plan')),
  persona_id uuid not null references public.personas(id) on delete cascade,
  plan_id uuid references public.planes(id) on delete cascade,
  datos jsonb not null default '{}'::jsonb,   -- para "plan": fecha, titulo, anfitrion, asistentes, notas
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada')),
  creado timestamptz not null default now(),
  resuelto timestamptz
);
create index if not exists solicitudes_persona_idx on public.solicitudes(persona_id);
create index if not exists solicitudes_plan_idx on public.solicitudes(plan_id);
create unique index if not exists solicitudes_una_por_plan on public.solicitudes(tipo, plan_id, persona_id)
  where tipo = 'asistencia' and estado = 'pendiente';
alter table public.solicitudes enable row level security;
revoke all on public.solicitudes from anon;
grant select on public.solicitudes to authenticated;
drop policy if exists "ver solicitudes" on public.solicitudes;
create policy "ver solicitudes" on public.solicitudes for select to authenticated
  using ((select public.es_admin()) or persona_id = (select id from public.personas where user_id = (select auth.uid())));

create or replace function public.mi_persona() returns uuid
language sql stable security definer set search_path = public as $$
  select id from personas where user_id = auth.uid()
$$;

-- "Yo fui": un miembro pide que lo apunten a un plan
create or replace function public.pedir_asistencia(p_plan uuid) returns void
language plpgsql security definer set search_path = public as $$
declare yo uuid := mi_persona();
begin
  if yo is null then raise exception 'Primero elige tu perfil (¿Quién eres?)'; end if;
  if not exists (select 1 from planes where id = p_plan) then raise exception 'Ese plan no existe'; end if;
  if exists (select 1 from asistencias where plan_id = p_plan and persona_id = yo) then raise exception 'Ya estás apuntado a ese plan'; end if;
  insert into solicitudes(tipo, persona_id, plan_id) values ('asistencia', yo, p_plan)
  on conflict do nothing;
end $$;

-- "Proponer plan": un miembro propone un plan completo para que el admin lo apruebe
create or replace function public.proponer_plan(p_fecha date, p_titulo text, p_anfitrion uuid, p_asistentes uuid[], p_notas text) returns void
language plpgsql security definer set search_path = public as $$
declare yo uuid := mi_persona();
begin
  if yo is null then raise exception 'Primero elige tu perfil (¿Quién eres?)'; end if;
  if p_fecha is null or p_fecha > (now() at time zone 'America/Lima')::date then raise exception 'Fecha no válida'; end if;
  if char_length(btrim(coalesce(p_titulo, ''))) not between 1 and 80 then raise exception 'Ponle un nombre al plan'; end if;
  if coalesce(array_length(p_asistentes, 1), 0) = 0 then raise exception 'Marca quién fue'; end if;
  if (select count(*) from solicitudes where persona_id = yo and estado = 'pendiente') >= 10 then
    raise exception 'Tienes muchas propuestas pendientes; espera a que el admin las revise';
  end if;
  insert into solicitudes(tipo, persona_id, datos) values ('plan', yo, jsonb_build_object(
    'fecha', p_fecha, 'titulo', btrim(p_titulo), 'anfitrion', p_anfitrion,
    'asistentes', to_jsonb(p_asistentes), 'notas', left(coalesce(btrim(p_notas), ''), 200)));
end $$;

-- El admin aprueba o rechaza
create or replace function public.resolver_solicitud(p_id uuid, p_aprobar boolean) returns void
language plpgsql security definer set search_path = public as $$
declare s solicitudes; nuevo uuid;
begin
  if not es_admin() then raise exception 'Solo el admin puede revisar solicitudes'; end if;
  select * into s from solicitudes where id = p_id and estado = 'pendiente';
  if not found then raise exception 'Esa solicitud ya fue revisada'; end if;
  if p_aprobar then
    if s.tipo = 'asistencia' then
      insert into asistencias(plan_id, persona_id) values (s.plan_id, s.persona_id) on conflict do nothing;
    else
      insert into planes(fecha, titulo, anfitrion, notas)
        values ((s.datos->>'fecha')::date, s.datos->>'titulo', nullif(s.datos->>'anfitrion', '')::uuid, coalesce(s.datos->>'notas', ''))
        returning id into nuevo;
      insert into asistencias(plan_id, persona_id)
        select nuevo, x::uuid from jsonb_array_elements_text(s.datos->'asistentes') x
        where exists (select 1 from personas where id = x::uuid)
        union select nuevo, nullif(s.datos->>'anfitrion', '')::uuid where nullif(s.datos->>'anfitrion', '') is not null
        on conflict do nothing;
      update solicitudes set plan_id = nuevo where id = p_id;
    end if;
  end if;
  update solicitudes set estado = case when p_aprobar then 'aprobada' else 'rechazada' end, resuelto = now() where id = p_id;
end $$;

-- Al anotar al anfitrión o al aprobar, las solicitudes de "Yo fui" ya cumplidas se cierran solas
create or replace function public.bmsn_cerrar_solicitudes_cumplidas() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update solicitudes set estado = 'aprobada', resuelto = now()
  where tipo = 'asistencia' and estado = 'pendiente' and plan_id = new.plan_id and persona_id = new.persona_id;
  return new;
end $$;
drop trigger if exists asistencias_cierra_solicitudes on public.asistencias;
create trigger asistencias_cierra_solicitudes after insert on public.asistencias
  for each row execute function public.bmsn_cerrar_solicitudes_cumplidas();

revoke execute on function public.mi_persona() from public, anon;
revoke execute on function public.pedir_asistencia(uuid) from public, anon;
revoke execute on function public.proponer_plan(date, text, uuid, uuid[], text) from public, anon;
revoke execute on function public.resolver_solicitud(uuid, boolean) from public, anon;
revoke execute on function public.bmsn_cerrar_solicitudes_cumplidas() from public, anon, authenticated;
grant execute on function public.mi_persona() to authenticated;
grant execute on function public.pedir_asistencia(uuid) to authenticated;
grant execute on function public.proponer_plan(date, text, uuid, uuid[], text) to authenticated;
grant execute on function public.resolver_solicitud(uuid, boolean) to authenticated;

-- Las copias de seguridad incluyen también las solicitudes
create or replace function public.bmsn_volcado() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'version', 2, 'fecha', now(),
    'personas',    (select coalesce(jsonb_agg(to_jsonb(p) order by p.nombre), '[]') from personas p),
    'planes',      (select coalesce(jsonb_agg(to_jsonb(p) order by p.fecha), '[]') from planes p),
    'asistencias', (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from asistencias a),
    'encuestas',   (select coalesce(jsonb_agg(to_jsonb(e) order by e.creado), '[]') from encuestas e),
    'votos',       (select coalesce(jsonb_agg(to_jsonb(v)), '[]') from votos v),
    'solicitudes', (select coalesce(jsonb_agg(to_jsonb(s) order by s.creado), '[]') from solicitudes s),
    'admins',      (select coalesce(jsonb_agg(a.email), '[]') from admins a)
  )
$$;
revoke execute on function public.bmsn_volcado() from public, anon, authenticated;
