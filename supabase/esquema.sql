-- BMSN — esquema de base de datos para Supabase.
-- Se puede ejecutar varias veces sin romper nada.

-- Zona horaria que define el "mes actual" de las encuestas.
create or replace function public.bmsn_mes_actual() returns text
language sql stable as $$ select to_char(now() at time zone 'America/Lima', 'YYYY-MM') $$;

-- ---------- Tablas ----------
create table if not exists public.admins (
  email text primary key
);

create table if not exists public.personas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique check (char_length(nombre) between 1 and 40),
  creado timestamptz not null default now()
);

create table if not exists public.planes (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  titulo text not null check (char_length(titulo) between 1 and 80),
  anfitrion uuid references public.personas(id) on delete set null,
  notas text not null default '' check (char_length(notas) <= 200),
  creado timestamptz not null default now()
);

create table if not exists public.asistencias (
  plan_id uuid not null references public.planes(id) on delete cascade,
  persona_id uuid not null references public.personas(id) on delete cascade,
  primary key (plan_id, persona_id)
);

create table if not exists public.encuestas (
  id uuid primary key default gen_random_uuid(),
  mes text not null check (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  pregunta text not null check (char_length(pregunta) between 1 and 120),
  opciones text[] not null check (array_length(opciones, 1) between 2 and 30),
  creado timestamptz not null default now()
);

create table if not exists public.votos (
  encuesta_id uuid not null references public.encuestas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  opcion text not null,
  fecha timestamptz not null default now(),
  primary key (encuesta_id, user_id)
);

-- ---------- Funciones ----------
create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where lower(email) = lower(auth.jwt() ->> 'email'))
$$;

-- El primer usuario que la llama (con la tabla de admins vacía) se vuelve admin.
create or replace function public.reclamar_admin() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero'; end if;
  if exists (select 1 from admins) then return es_admin(); end if;
  insert into admins(email) values (lower(auth.jwt() ->> 'email'));
  return true;
end $$;

-- Votar: un voto por correo verificado y encuesta; volver a votar lo reemplaza.
create or replace function public.votar(p_encuesta uuid, p_opcion text) returns void
language plpgsql security definer set search_path = public as $$
declare e encuestas;
begin
  if auth.uid() is null then raise exception 'Inicia sesión con tu correo para votar'; end if;
  select * into e from encuestas where id = p_encuesta;
  if not found then raise exception 'La encuesta no existe'; end if;
  if e.mes <> bmsn_mes_actual() then raise exception 'Esta encuesta no está abierta'; end if;
  if not (p_opcion = any(e.opciones)) then raise exception 'Opción no válida'; end if;
  insert into votos(encuesta_id, user_id, email, opcion)
  values (p_encuesta, auth.uid(), lower(auth.jwt() ->> 'email'), p_opcion)
  on conflict (encuesta_id, user_id) do update set opcion = excluded.opcion, fecha = now();
end $$;

-- Resultados públicos (solo conteos, sin correos).
create or replace function public.resultados()
returns table(encuesta_id uuid, opcion text, votos bigint)
language sql stable security definer set search_path = public as $$
  select encuesta_id, opcion, count(*) from votos group by 1, 2
$$;

-- Guardar un plan con sus asistentes en una sola operación.
create or replace function public.guardar_plan(p_id uuid, p_fecha date, p_titulo text,
  p_anfitrion uuid, p_asistentes uuid[], p_notas text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id;
begin
  if not es_admin() then raise exception 'Solo el admin puede anotar planes'; end if;
  if v_id is null then
    insert into planes(fecha, titulo, anfitrion, notas)
    values (p_fecha, trim(p_titulo), p_anfitrion, coalesce(trim(p_notas), '')) returning id into v_id;
  else
    update planes set fecha = p_fecha, titulo = trim(p_titulo), anfitrion = p_anfitrion,
      notas = coalesce(trim(p_notas), '') where id = v_id;
    delete from asistencias where plan_id = v_id;
  end if;
  insert into asistencias(plan_id, persona_id)
  select v_id, x from unnest(array_append(p_asistentes, p_anfitrion)) x where x is not null
  on conflict do nothing;
  return v_id;
end $$;

-- ---------- Seguridad (RLS) ----------
alter table public.admins enable row level security;
alter table public.personas enable row level security;
alter table public.planes enable row level security;
alter table public.asistencias enable row level security;
alter table public.encuestas enable row level security;
alter table public.votos enable row level security;

do $$
declare t text;
begin
  foreach t in array array['personas', 'planes', 'asistencias', 'encuestas'] loop
    execute format('drop policy if exists "leer" on public.%I', t);
    execute format('drop policy if exists "admin escribe" on public.%I', t);
    execute format('create policy "leer" on public.%I for select using (true)', t);
    execute format('create policy "admin escribe" on public.%I for all using (public.es_admin()) with check (public.es_admin())', t);
  end loop;
end $$;

drop policy if exists "ver votos" on public.votos;
create policy "ver votos" on public.votos for select
  using (user_id = auth.uid() or public.es_admin());
drop policy if exists "admin borra votos" on public.votos;
create policy "admin borra votos" on public.votos for delete using (public.es_admin());

drop policy if exists "admin ve admins" on public.admins;
create policy "admin ve admins" on public.admins for select using (public.es_admin());

-- Las funciones que escriben solo pueden llamarlas usuarios con sesión iniciada.
revoke execute on function public.reclamar_admin() from public, anon;
revoke execute on function public.votar(uuid, text) from public, anon;
revoke execute on function public.guardar_plan(uuid, date, text, uuid, uuid[], text) from public, anon;
grant execute on function public.reclamar_admin() to authenticated;
grant execute on function public.votar(uuid, text) to authenticated;
grant execute on function public.guardar_plan(uuid, date, text, uuid, uuid[], text) to authenticated;
grant execute on function public.resultados() to anon, authenticated;
grant execute on function public.es_admin() to anon, authenticated;

-- Permisos de tabla (los proyectos nuevos de Supabase no los dan por defecto).
grant usage on schema public to anon, authenticated;
grant select on public.personas, public.planes, public.asistencias, public.encuestas to anon, authenticated;
grant insert, update, delete on public.personas, public.planes, public.asistencias, public.encuestas to authenticated;
grant select, delete on public.votos to authenticated;
grant select on public.admins to authenticated;
