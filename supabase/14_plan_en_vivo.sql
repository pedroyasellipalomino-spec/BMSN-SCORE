-- BMSN — plan en vivo: mientras se está haciendo un plan, sale en Inicio (título, casa, quién está).
-- Cualquiera con perfil lo empieza; cada uno pulsa «Estoy aquí». Al terminar se crea el plan y la
-- asistencia de cada presente queda pendiente de que el admin la apruebe (si lo termina el admin,
-- cuenta directamente). Después se queda 1 día en Inicio para valorarlo.
-- Ejecutar después de 13_valoraciones.sql. Se puede ejecutar varias veces.

create table if not exists public.planes_vivo (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (char_length(titulo) between 1 and 80),
  anfitrion uuid references public.personas(id) on delete set null,
  notas text not null default '' check (char_length(notas) <= 200),
  iniciado_por uuid references public.personas(id) on delete set null,
  inicio timestamptz not null default now(),
  fin timestamptz,
  plan_id uuid references public.planes(id) on delete set null
);
-- Solo un plan en vivo a la vez
create unique index if not exists planes_vivo_uno_activo on public.planes_vivo ((true)) where fin is null;
create table if not exists public.presentes_vivo (
  vivo_id uuid not null references public.planes_vivo(id) on delete cascade,
  persona_id uuid not null references public.personas(id) on delete cascade,
  llegada timestamptz not null default now(),
  primary key (vivo_id, persona_id)
);
alter table public.planes_vivo enable row level security;
alter table public.presentes_vivo enable row level security;
grant select on public.planes_vivo, public.presentes_vivo to anon, authenticated;
drop policy if exists "leer" on public.planes_vivo;
drop policy if exists "leer" on public.presentes_vivo;
create policy "leer" on public.planes_vivo for select using (true);
create policy "leer" on public.presentes_vivo for select using (true);

-- ¿Puedo gestionar este plan en vivo? (quien lo empezó o el admin)
create or replace function public.bmsn_gestiona_vivo(p_vivo uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select es_admin() or exists (select 1 from planes_vivo where id = p_vivo and iniciado_por = mi_persona() and mi_persona() is not null)
$$;

create or replace function public.empezar_plan_vivo(p_titulo text, p_anfitrion uuid, p_notas text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare yo uuid := mi_persona(); nuevo uuid; casa text;
begin
  if yo is null and not es_admin() then raise exception 'Primero elige tu perfil (¿Quién eres?)'; end if;
  perform bmsn_cerrar_vivos_viejos();
  if exists (select 1 from planes_vivo where fin is null) then raise exception 'Ya hay un plan en vivo. Únete con «Estoy aquí».'; end if;
  if char_length(btrim(coalesce(p_titulo, ''))) not between 1 and 80 then raise exception 'Ponle un nombre al plan'; end if;
  insert into planes_vivo(titulo, anfitrion, notas, iniciado_por)
    values (btrim(p_titulo), p_anfitrion, left(btrim(coalesce(p_notas, '')), 200), yo) returning id into nuevo;
  insert into presentes_vivo(vivo_id, persona_id)
    select nuevo, x from unnest(array[yo, p_anfitrion]) x where x is not null on conflict do nothing;
  select nombre into casa from personas where id = p_anfitrion;
  perform bmsn_avisar('🔴 Plan en vivo: ' || btrim(p_titulo),
    coalesce('En casa de ' || casa, 'Fuera de casa') || '. ¿Estás ahí? Pulsa «Estoy aquí».', './#inicio');
  return nuevo;
end $$;

create or replace function public.editar_plan_vivo(p_vivo uuid, p_titulo text, p_anfitrion uuid, p_notas text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  if not bmsn_gestiona_vivo(p_vivo) then raise exception 'Solo quien empezó el plan o el admin pueden editarlo'; end if;
  if char_length(btrim(coalesce(p_titulo, ''))) not between 1 and 80 then raise exception 'Ponle un nombre al plan'; end if;
  update planes_vivo set titulo = btrim(p_titulo), anfitrion = p_anfitrion, notas = left(btrim(coalesce(p_notas, '')), 200)
    where id = p_vivo and fin is null;
  if not found then raise exception 'Ese plan ya terminó'; end if;
end $$;

-- «Estoy aquí» (yo) o añadir a alguien sin móvil (quien lo empezó o el admin)
create or replace function public.estoy_aqui(p_vivo uuid, p_persona uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare yo uuid := mi_persona(); quien uuid := coalesce(p_persona, mi_persona());
begin
  if quien is null then raise exception 'Primero elige tu perfil (¿Quién eres?)'; end if;
  if quien is distinct from yo and not bmsn_gestiona_vivo(p_vivo) then raise exception 'Solo quien empezó el plan o el admin pueden añadir a otros'; end if;
  if not exists (select 1 from planes_vivo where id = p_vivo and fin is null) then raise exception 'Ese plan ya terminó'; end if;
  insert into presentes_vivo(vivo_id, persona_id) values (p_vivo, quien) on conflict do nothing;
end $$;

create or replace function public.quitar_presente(p_vivo uuid, p_persona uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare quien uuid := coalesce(p_persona, mi_persona());
begin
  if quien is distinct from mi_persona() and not bmsn_gestiona_vivo(p_vivo) then raise exception 'Solo quien empezó el plan o el admin pueden quitar a otros'; end if;
  if not exists (select 1 from planes_vivo where id = p_vivo and fin is null) then raise exception 'Ese plan ya terminó'; end if;
  delete from presentes_vivo where vivo_id = p_vivo and persona_id = quien;
end $$;

-- Terminar: crea el plan. Si termina el admin, los presentes cuentan ya; si no, quedan pendientes.
create or replace function public.bmsn_terminar_vivo(p_vivo uuid, p_directo boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare v planes_vivo; nuevo uuid; n int;
begin
  select * into v from planes_vivo where id = p_vivo and fin is null for update;
  if not found then raise exception 'Ese plan ya terminó'; end if;
  -- Sin nadie apuntado no se crea ningún plan
  if not exists (select 1 from presentes_vivo where vivo_id = p_vivo) then
    update planes_vivo set fin = now() where id = p_vivo;
    return null;
  end if;
  insert into planes(fecha, titulo, anfitrion, notas)
    values ((v.inicio at time zone 'America/Lima')::date, v.titulo, v.anfitrion, v.notas) returning id into nuevo;
  -- Directas: todos si termina el admin; si no, solo los presentes que son admin
  insert into asistencias(plan_id, persona_id)
    select nuevo, pv.persona_id from presentes_vivo pv
    where pv.vivo_id = p_vivo and (p_directo or pv.persona_id in (select persona_id from personas_admin()))
    on conflict do nothing;
  -- El resto, pendiente de aprobación (sin un aviso por persona: va uno solo al admin)
  perform set_config('bmsn.silencio', '1', true);
  insert into solicitudes(tipo, persona_id, plan_id)
    select 'asistencia', pv.persona_id, nuevo from presentes_vivo pv
    where pv.vivo_id = p_vivo and not exists (select 1 from asistencias a where a.plan_id = nuevo and a.persona_id = pv.persona_id)
    on conflict do nothing;
  get diagnostics n = row_count;
  perform set_config('bmsn.silencio', '', true);
  update planes_vivo set fin = now(), plan_id = nuevo where id = p_vivo;
  if n > 0 then
    perform bmsn_avisar('🙋 ' || v.titulo || ' terminó', n || ' asistencia' || case when n = 1 then '' else 's' end || ' por confirmar. Tócalo para revisarlas.', './#admin', true);
  end if;
  perform bmsn_avisar('⭐ ¿Qué tal estuvo ' || v.titulo || '?', 'Valóralo en BMSN: tienes 1 día.', './#inicio');
  return nuevo;
end $$;

create or replace function public.terminar_plan_vivo(p_vivo uuid) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not bmsn_gestiona_vivo(p_vivo) then raise exception 'Solo quien empezó el plan o el admin pueden terminarlo'; end if;
  return bmsn_terminar_vivo(p_vivo, es_admin());
end $$;

-- Si nadie lo termina, se termina solo a las 14 horas
create or replace function public.bmsn_cerrar_vivos_viejos() returns void
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  for v in select id from planes_vivo where fin is null and inicio < now() - interval '14 hours' loop
    perform bmsn_terminar_vivo(v, false);
  end loop;
end $$;

-- El admin puede borrar un plan en vivo (por error). No borra el plan ya creado.
create or replace function public.borrar_plan_vivo(p_vivo uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Solo el admin puede borrarlo'; end if;
  delete from planes_vivo where id = p_vivo;
end $$;

-- Aviso por cada solicitud nueva, salvo cuando llegan en bloque al terminar un plan en vivo
create or replace function public.bmsn_avisar_solicitud() returns trigger
language plpgsql security definer set search_path = public as $$
declare quien text; titulo text;
begin
  if coalesce(current_setting('bmsn.silencio', true), '') = '1' then return new; end if;
  select nombre into quien from personas where id = new.persona_id;
  if new.tipo = 'asistencia' then
    select p.titulo into titulo from planes p where p.id = new.plan_id;
    perform bmsn_avisar('🙋 ' || coalesce(quien, 'Alguien') || ' dice que fue', coalesce(titulo, 'un plan') || ' · tócalo para revisarlo', './#admin', true);
  else
    perform bmsn_avisar('📅 Nueva propuesta de plan', coalesce(quien, 'Alguien') || ' propone «' || coalesce(new.datos->>'titulo', 'un plan') || '»', './#admin', true);
  end if;
  return new;
end $$;
revoke execute on function public.bmsn_avisar_solicitud() from public, anon, authenticated;

-- Valorar: también pueden los que tienen la asistencia pendiente (su voto cuenta cuando se apruebe)
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
  if not exists (select 1 from asistencias where plan_id = p_plan and persona_id = yo)
     and not exists (select 1 from solicitudes where tipo = 'asistencia' and plan_id = p_plan and persona_id = yo and estado = 'pendiente') then
    raise exception 'Solo pueden valorar los que fueron al plan';
  end if;
  if f > (now() at time zone 'America/Lima')::date then raise exception 'Ese plan aún no ha pasado'; end if;
  if p_estrellas not between 1 and 5 then raise exception 'Elige de 1 a 5 estrellas'; end if;
  insert into valoraciones(plan_id, persona_id, estrellas, comentario)
    values (p_plan, yo, p_estrellas, left(btrim(coalesce(p_comentario, '')), 200))
  on conflict (plan_id, persona_id) do update
    set estrellas = excluded.estrellas, comentario = excluded.comentario, editado = now();
end $$;

revoke execute on function public.bmsn_gestiona_vivo(uuid) from public, anon;
revoke execute on function public.bmsn_terminar_vivo(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.bmsn_cerrar_vivos_viejos() from public, anon;
revoke execute on function public.empezar_plan_vivo(text, uuid, text) from public, anon;
revoke execute on function public.editar_plan_vivo(uuid, text, uuid, text) from public, anon;
revoke execute on function public.estoy_aqui(uuid, uuid) from public, anon;
revoke execute on function public.quitar_presente(uuid, uuid) from public, anon;
revoke execute on function public.terminar_plan_vivo(uuid) from public, anon;
revoke execute on function public.borrar_plan_vivo(uuid) from public, anon;
grant execute on function public.bmsn_gestiona_vivo(uuid) to authenticated;
grant execute on function public.bmsn_cerrar_vivos_viejos() to authenticated;
grant execute on function public.empezar_plan_vivo(text, uuid, text) to authenticated;
grant execute on function public.editar_plan_vivo(uuid, text, uuid, text) to authenticated;
grant execute on function public.estoy_aqui(uuid, uuid) to authenticated;
grant execute on function public.quitar_presente(uuid, uuid) to authenticated;
grant execute on function public.terminar_plan_vivo(uuid) to authenticated;
grant execute on function public.borrar_plan_vivo(uuid) to authenticated;

-- Cierre automático cada media hora
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'bmsn-cerrar-vivos';
  perform cron.schedule('bmsn-cerrar-vivos', '*/30 * * * *', 'select public.bmsn_cerrar_vivos_viejos()');
exception when others then
  raise notice 'pg_cron no disponible (%)', sqlerrm;
end $$;

-- Copias de seguridad con los planes en vivo
create or replace function public.bmsn_volcado() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'version', 5, 'fecha', now(),
    'personas',      (select coalesce(jsonb_agg(to_jsonb(p) order by p.nombre), '[]') from personas p),
    'planes',        (select coalesce(jsonb_agg(to_jsonb(p) order by p.fecha), '[]') from planes p),
    'asistencias',   (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from asistencias a),
    'encuestas',     (select coalesce(jsonb_agg(to_jsonb(e) order by e.creado), '[]') from encuestas e),
    'votos',         (select coalesce(jsonb_agg(to_jsonb(v)), '[]') from votos v),
    'solicitudes',   (select coalesce(jsonb_agg(to_jsonb(s) order by s.creado), '[]') from solicitudes s),
    'jugadores_mes', (select coalesce(jsonb_agg(to_jsonb(j) order by j.mes), '[]') from jugadores_mes j),
    'valoraciones',  (select coalesce(jsonb_agg(to_jsonb(v)), '[]') from valoraciones v),
    'planes_vivo',   (select coalesce(jsonb_agg(to_jsonb(v) order by v.inicio), '[]') from planes_vivo v),
    'presentes_vivo',(select coalesce(jsonb_agg(to_jsonb(x)), '[]') from presentes_vivo x),
    'admins',        (select coalesce(jsonb_agg(a.email), '[]') from admins a)
  )
$$;
revoke execute on function public.bmsn_volcado() from public, anon, authenticated;
