-- BMSN — mejoras de seguridad, rendimiento, copias y mantenimiento.
-- Ejecutar después de 08_jugador_del_mes.sql. Se puede ejecutar varias veces.

-- =====================================================================
-- 1) Contraseña del grupo: las cuentas que ya entraron con código
--    solo pueden volver a entrar con código (nadie puede suplantarlas).
-- =====================================================================

-- La app la llama justo después de entrar con el código del correo.
create or replace function public.asegurar_cuenta() returns void
language sql security definer set search_path = public, auth as $$
  update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"via":"codigo"}'::jsonb
  where id = auth.uid()
$$;
revoke execute on function public.asegurar_cuenta() from public, anon;
grant execute on function public.asegurar_cuenta() to authenticated;

create or replace function public.entrar_grupo(p_email text, p_clave text) returns text
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  hash text; n text := bmsn_normalizar(p_clave);
  e text := lower(btrim(coalesce(p_email, '')));
  u auth.users;
begin
  select valor into hash from bmsn_ajustes where clave = 'grupo';
  if hash is null then raise exception 'El admin todavía no ha puesto la contraseña del grupo'; end if;
  if extensions.crypt(n, hash) <> hash then
    perform pg_sleep(1);
    raise exception 'Contraseña del grupo incorrecta';
  end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Escribe un correo válido'; end if;
  if exists (select 1 from admins where lower(email) = e) then
    raise exception 'El correo del admin entra con el código por correo';
  end if;

  select * into u from auth.users where lower(email) = e;
  if found and u.raw_user_meta_data ->> 'via' = 'codigo' then
    raise exception 'Esta cuenta ya está verificada: entra con «Código por correo»';
  end if;

  if not found then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', e,
      extensions.crypt(n, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{"via":"clave_grupo"}', now(), now(),
      '', '', '', ''
    ) returning * into u;
    insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id::text, u.id,
      jsonb_build_object('sub', u.id::text, 'email', e, 'email_verified', true), 'email', now(), now(), now());
  else
    update auth.users set encrypted_password = extensions.crypt(n, extensions.gen_salt('bf')),
      email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
    where id = u.id;
  end if;
  return 'ok';
end $$;
revoke execute on function public.entrar_grupo(text, text) from public;
grant execute on function public.entrar_grupo(text, text) to anon, authenticated;

-- =====================================================================
-- 2) Cambiar un nombre ya no deja votos huérfanos: se actualizan las
--    opciones y los votos de las encuestas de personas (jugador del mes).
-- =====================================================================
create or replace function public.bmsn_renombrar_en_encuestas() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.nombre is distinct from old.nombre then
    update votos v set opcion = new.nombre
      from encuestas e
      where v.encuesta_id = e.id and e.tipo in ('nominacion', 'final') and v.opcion = old.nombre;
    update encuestas set opciones = array_replace(opciones, old.nombre, new.nombre)
      where tipo in ('nominacion', 'final') and old.nombre = any(opciones);
  end if;
  return new;
end $$;
drop trigger if exists personas_renombrar on public.personas;
create trigger personas_renombrar after update of nombre on public.personas
  for each row execute function public.bmsn_renombrar_en_encuestas();
revoke execute on function public.bmsn_renombrar_en_encuestas() from public, anon, authenticated;

-- =====================================================================
-- 3) Copias de seguridad: una copia completa cada domingo (se guardan 12)
--    y descarga desde el panel de admin.
-- =====================================================================
create table if not exists public.bmsn_copias (
  id bigint generated always as identity primary key,
  creada timestamptz not null default now(),
  datos jsonb not null
);
alter table public.bmsn_copias enable row level security;
revoke all on public.bmsn_copias from anon, authenticated;

create or replace function public.bmsn_volcado() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'version', 1, 'fecha', now(),
    'personas',    (select coalesce(jsonb_agg(to_jsonb(p) order by p.nombre), '[]') from personas p),
    'planes',      (select coalesce(jsonb_agg(to_jsonb(p) order by p.fecha), '[]') from planes p),
    'asistencias', (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from asistencias a),
    'encuestas',   (select coalesce(jsonb_agg(to_jsonb(e) order by e.creado), '[]') from encuestas e),
    'votos',       (select coalesce(jsonb_agg(to_jsonb(v)), '[]') from votos v),
    'admins',      (select coalesce(jsonb_agg(a.email), '[]') from admins a)
  )
$$;
revoke execute on function public.bmsn_volcado() from public, anon, authenticated;

create or replace function public.hacer_copia() returns bigint
language plpgsql security definer set search_path = public as $$
declare nuevo bigint;
begin
  if auth.uid() is not null and not es_admin() then raise exception 'Solo el admin puede hacer copias'; end if;
  insert into bmsn_copias(datos) values (bmsn_volcado()) returning id into nuevo;
  delete from bmsn_copias where id not in (select id from bmsn_copias order by creada desc limit 12);
  return nuevo;
end $$;
revoke execute on function public.hacer_copia() from public, anon;
grant execute on function public.hacer_copia() to authenticated;

create or replace function public.listar_copias()
returns table(id bigint, creada timestamptz, planes int, personas int, votos int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Solo el admin puede ver las copias'; end if;
  return query select c.id, c.creada, jsonb_array_length(c.datos->'planes'), jsonb_array_length(c.datos->'personas'),
                      jsonb_array_length(c.datos->'votos')
               from bmsn_copias c order by c.creada desc;
end $$;
revoke execute on function public.listar_copias() from public, anon;
grant execute on function public.listar_copias() to authenticated;

create or replace function public.descargar_copia(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d jsonb;
begin
  if not es_admin() then raise exception 'Solo el admin puede descargar copias'; end if;
  if p_id is null then return bmsn_volcado(); end if;
  select datos into d from bmsn_copias where id = p_id;
  return d;
end $$;
revoke execute on function public.descargar_copia(bigint) from public, anon;
grant execute on function public.descargar_copia(bigint) to authenticated;

-- =====================================================================
-- 4) Avisos de Supabase: search_path fijo, permisos y políticas sin
--    duplicados (más rápidas), índices en las claves foráneas.
-- =====================================================================
alter function public.bmsn_mes_actual() set search_path = public;
alter function public.bmsn_normalizar(text) set search_path = pg_catalog;
alter function public.bmsn_nombre_mes(text) set search_path = pg_catalog;
alter function public.encuesta_abierta(public.encuestas) set search_path = public;
revoke execute on function public.puede_foto(text) from public, anon;

-- Una sola política de lectura + políticas separadas de escritura para el admin.
do $$
declare t text;
begin
  foreach t in array array['personas', 'planes', 'asistencias', 'encuestas'] loop
    execute format('drop policy if exists "admin escribe" on public.%I', t);
    execute format('drop policy if exists "admin inserta" on public.%I', t);
    execute format('drop policy if exists "admin cambia" on public.%I', t);
    execute format('drop policy if exists "admin borra" on public.%I', t);
    execute format('create policy "admin inserta" on public.%I for insert to authenticated with check ((select public.es_admin()))', t);
    execute format('create policy "admin cambia" on public.%I for update to authenticated using ((select public.es_admin())) with check ((select public.es_admin()))', t);
    execute format('create policy "admin borra" on public.%I for delete to authenticated using ((select public.es_admin()))', t);
  end loop;
end $$;

drop policy if exists "admin gestiona admins" on public.admins;
drop policy if exists "admin ve admins" on public.admins;
drop policy if exists "admin añade admins" on public.admins;
drop policy if exists "admin quita admins" on public.admins;
create policy "admin ve admins" on public.admins for select to authenticated using ((select public.es_admin()));
create policy "admin añade admins" on public.admins for insert to authenticated with check ((select public.es_admin()));
create policy "admin quita admins" on public.admins for delete to authenticated using ((select public.es_admin()));

drop policy if exists "ver votos" on public.votos;
create policy "ver votos" on public.votos for select to authenticated
  using (user_id = (select auth.uid()) or (select public.es_admin()));
drop policy if exists "admin borra votos" on public.votos;
create policy "admin borra votos" on public.votos for delete to authenticated using ((select public.es_admin()));

create index if not exists planes_anfitrion_idx on public.planes(anfitrion);
create index if not exists asistencias_persona_idx on public.asistencias(persona_id);
create index if not exists votos_user_idx on public.votos(user_id);
create index if not exists encuestas_padre_idx on public.encuestas(padre);

-- =====================================================================
-- 5) Tareas programadas: copia semanal y "visita" diaria para que
--    Supabase no pause el proyecto por inactividad (plan gratis).
-- =====================================================================
do $$
begin
  begin
    create extension if not exists pg_cron with schema pg_catalog;
    create extension if not exists pg_net with schema extensions;
  exception when others then
    raise notice 'pg_cron/pg_net no disponibles (%)', sqlerrm;
    return;
  end;
  perform cron.unschedule(jobid) from cron.job where jobname in ('bmsn-copia-semanal', 'bmsn-mantener-activo');
  -- Domingo 03:15 de Lima (08:15 UTC)
  perform cron.schedule('bmsn-copia-semanal', '15 8 * * 0', 'select public.hacer_copia()');
  -- Todos los días 12:20 de Lima (17:20 UTC): una consulta a la API pública cuenta como actividad
  perform cron.schedule('bmsn-mantener-activo', '20 17 * * *', $job$
    select net.http_get(
      url := 'https://tjktlndycdncwvybutua.supabase.co/rest/v1/personas?select=id&limit=1',
      headers := jsonb_build_object('apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqa3RsbmR5Y2RuY3d2eWJ1dHVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUzOTc2OTgsImV4cCI6MjExMDk3MzY5OH0.IWXWajlHb6diuvqtnrXwn28Y5SuC29hVY1Jl5EsfI5k')
    )
  $job$);
end $$;
