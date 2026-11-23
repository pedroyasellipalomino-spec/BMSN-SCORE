-- BMSN — avisos push (notificaciones al teléfono).
-- Ejecutar después de 10_solicitudes.sql. Se puede ejecutar varias veces.
-- La URL de la función y el secreto compartido se guardan aparte en bmsn_ajustes
-- ('avisos_url', 'avisos_secreto'); no van en este archivo.

create table if not exists public.push_subs (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  creado timestamptz not null default now()
);
create index if not exists push_subs_user_idx on public.push_subs(user_id);
alter table public.push_subs enable row level security;
revoke all on public.push_subs from anon, authenticated;

-- El miembro guarda o quita la suscripción de su aparato
create or replace function public.guardar_suscripcion(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero'; end if;
  if p_endpoint !~ '^https://' then raise exception 'Suscripción no válida'; end if;
  insert into push_subs(endpoint, user_id, p256dh, auth) values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth;
end $$;
create or replace function public.borrar_suscripcion(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from push_subs where endpoint = p_endpoint and user_id = auth.uid()
$$;
revoke execute on function public.guardar_suscripcion(text, text, text) from public, anon;
revoke execute on function public.borrar_suscripcion(text) from public, anon;
grant execute on function public.guardar_suscripcion(text, text, text) to authenticated;
grant execute on function public.borrar_suscripcion(text) to authenticated;

-- Solo para la función de avisos (service_role)
create or replace function public.push_destinos(p_solo_admins boolean) returns table(endpoint text, p256dh text, auth text)
language sql stable security definer set search_path = public, auth as $$
  select s.endpoint, s.p256dh, s.auth from push_subs s
  where not p_solo_admins or exists (
    select 1 from auth.users u join admins a on lower(a.email) = lower(u.email) where u.id = s.user_id)
$$;
create or replace function public.push_borrar(p_endpoint text) returns void
language sql security definer set search_path = public as $$ delete from push_subs where endpoint = p_endpoint $$;
revoke execute on function public.push_destinos(boolean) from public, anon, authenticated;
revoke execute on function public.push_borrar(text) from public, anon, authenticated;
grant execute on function public.push_destinos(boolean) to service_role;
grant execute on function public.push_borrar(text) to service_role;

-- Enviar un aviso (no hace nada si los avisos no están configurados)
create or replace function public.bmsn_avisar(p_titulo text, p_cuerpo text, p_url text default './', p_solo_admins boolean default false) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare u text; sec text;
begin
  select valor into u from bmsn_ajustes where clave = 'avisos_url';
  select valor into sec from bmsn_ajustes where clave = 'avisos_secreto';
  if u is null or sec is null then return; end if;
  perform net.http_post(
    url := u,
    body := jsonb_build_object('titulo', p_titulo, 'cuerpo', p_cuerpo, 'url', p_url, 'solo_admins', p_solo_admins),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-bmsn-secreto', sec));
exception when others then
  raise notice 'No se pudo enviar el aviso: %', sqlerrm; -- un aviso fallido nunca rompe nada
end $$;
revoke execute on function public.bmsn_avisar(text, text, text, boolean) from public, anon, authenticated;

-- Aviso al admin cuando llega una solicitud nueva
create or replace function public.bmsn_avisar_solicitud() returns trigger
language plpgsql security definer set search_path = public as $$
declare quien text; titulo text;
begin
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
drop trigger if exists solicitudes_avisar on public.solicitudes;
create trigger solicitudes_avisar after insert on public.solicitudes
  for each row execute function public.bmsn_avisar_solicitud();

-- Jugador del mes automático, ahora con avisos (reemplaza la versión de 08)
create or replace function public.automatizar_encuestas() returns text
language plpgsql security definer set search_path = public as $$
declare
  hoy date := (now() at time zone 'America/Lima')::date;
  fin_prev date := date_trunc('month', hoy)::date - 1;
  mes_prev text := to_char(fin_prev, 'YYYY-MM');
  nom encuestas; f encuestas; top text[]; corte bigint; hecho text := 'nada'; gan text;
begin
  -- 1) Nominados del mes anterior (solo en los primeros días del mes)
  select * into nom from encuestas where tipo = 'nominacion' and mes = mes_prev order by creado limit 1;
  if not found and extract(day from hoy) <= 5 then
    insert into encuestas(mes, pregunta, opciones, tipo, max_votos)
      select mes_prev, 'Jugador del mes · ' || bmsn_nombre_mes(mes_prev), array_agg(nombre order by nombre), 'nominacion', 3
      from personas where desde is null or desde <= fin_prev
      having count(*) >= 2;
    if found then
      perform bmsn_avisar('🏆 ¡Vota al Jugador de ' || bmsn_nombre_mes(mes_prev) || '!', 'Elige hasta 3 personas. En 2 días sale la final.', './#encuestas');
    end if;
    return 'nominados creados';
  end if;

  -- 2) Final dos días después de abrir los nominados
  for nom in select * from encuestas e where e.tipo = 'nominacion' and not e.cerrada
             and hoy >= (e.creado at time zone 'America/Lima')::date + 2
             and not exists (select 1 from encuestas x where x.padre = e.id) loop
    select n into corte from (select count(*) n from votos where encuesta_id = nom.id group by opcion order by 1 desc offset 2 limit 1) x;
    select array_agg(opcion order by n desc, opcion) into top
      from (select opcion, count(*) n from votos where encuesta_id = nom.id group by opcion) c
      where n >= coalesce(corte, 1);
    if coalesce(array_length(top, 1), 0) >= 2 then
      insert into encuestas(mes, pregunta, opciones, tipo, max_votos, padre)
        values (nom.mes, '¿Quién es el jugador de ' || bmsn_nombre_mes(nom.mes) || '?', top, 'final', 1, nom.id);
      update encuestas set cerrada = true where id = nom.id;
      perform bmsn_avisar('🔥 ¡Final del Jugador de ' || bmsn_nombre_mes(nom.mes) || '!', array_to_string(top, ', ') || '. Un voto, tienes 2 días.', './#encuestas');
      hecho := 'final creada';
    end if;
  end loop;

  -- 3) La final se cierra sola 2 días después (si alguien votó) y se proclama al jugador
  for f in select * from encuestas e where e.tipo = 'final' and not e.cerrada
           and hoy >= (e.creado at time zone 'America/Lima')::date + 2
           and exists (select 1 from votos v where v.encuesta_id = e.id) loop
    update encuestas set cerrada = true where id = f.id;
    select string_agg(opcion, ' y ' order by opcion) into gan from (
      select opcion, count(*) n, max(count(*)) over () m from votos where encuesta_id = f.id group by opcion) x where n = m;
    perform bmsn_avisar('🏆 ' || coalesce(gan, 'Tenemos') || ', Jugador de ' || bmsn_nombre_mes(f.mes), 'Mira los resultados en BMSN.', './#encuestas');
    hecho := 'jugador del mes proclamado';
  end loop;
  return hecho;
end $$;
grant execute on function public.automatizar_encuestas() to anon, authenticated;

-- Aviso de prueba para el admin (desde el panel)
create or replace function public.probar_aviso() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Solo el admin'; end if;
  perform bmsn_avisar('🔔 Aviso de prueba', 'Si ves esto, los avisos de BMSN funcionan.', './#admin', true);
end $$;
revoke execute on function public.probar_aviso() from public, anon;
grant execute on function public.probar_aviso() to authenticated;
