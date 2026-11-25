-- BMSN — convocar un plan («📣 Hay plan»): qué, dónde y cuándo. Llega un aviso a todos,
-- sale en Inicio y cada uno responde Voy / Quizás / No voy. Al empezar se pasa a plan en vivo.
-- Ejecutar después de 14_plan_en_vivo.sql. Se puede ejecutar varias veces.

create table if not exists public.convocatorias (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (char_length(titulo) between 1 and 80),
  anfitrion uuid references public.personas(id) on delete set null,
  lugar text not null default '' check (char_length(lugar) <= 80),
  cuando timestamptz not null,
  notas text not null default '' check (char_length(notas) <= 200),
  creado_por uuid references public.personas(id) on delete set null,
  creado timestamptz not null default now(),
  cancelada boolean not null default false,
  vivo_id uuid references public.planes_vivo(id) on delete set null
);
create index if not exists convocatorias_cuando_idx on public.convocatorias(cuando);
create table if not exists public.respuestas_conv (
  conv_id uuid not null references public.convocatorias(id) on delete cascade,
  persona_id uuid not null references public.personas(id) on delete cascade,
  respuesta text not null check (respuesta in ('voy', 'quizas', 'no')),
  fecha timestamptz not null default now(),
  primary key (conv_id, persona_id)
);
alter table public.convocatorias enable row level security;
alter table public.respuestas_conv enable row level security;
grant select on public.convocatorias, public.respuestas_conv to anon, authenticated;
drop policy if exists "leer" on public.convocatorias;
drop policy if exists "leer" on public.respuestas_conv;
create policy "leer" on public.convocatorias for select using (true);
create policy "leer" on public.respuestas_conv for select using (true);

-- Texto corto de cuándo (hora de Lima): «hoy 21:00», «mañana 20:30», «sáb 30/11 21:00»
create or replace function public.bmsn_cuando_txt(t timestamptz) returns text
language sql stable set search_path = public as $$
  select case (t at time zone 'America/Lima')::date - (now() at time zone 'America/Lima')::date
           when 0 then 'hoy' when 1 then 'mañana'
           else (array['dom','lun','mar','mié','jue','vie','sáb'])[extract(dow from t at time zone 'America/Lima')::int + 1]
                || ' ' || to_char(t at time zone 'America/Lima', 'DD/MM') end
         || ' a las ' || to_char(t at time zone 'America/Lima', 'HH24:MI')
$$;

create or replace function public.convocar_plan(p_titulo text, p_anfitrion uuid, p_lugar text, p_cuando timestamptz, p_notas text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare yo uuid := mi_persona(); nuevo uuid; quien text; casa text;
begin
  if yo is null then raise exception 'Primero elige tu perfil (¿Quién eres?)'; end if;
  if char_length(btrim(coalesce(p_titulo, ''))) not between 1 and 80 then raise exception 'Ponle un nombre al plan'; end if;
  if p_cuando is null or p_cuando < now() - interval '1 hour' or p_cuando > now() + interval '60 days' then raise exception 'Elige una fecha y hora válidas'; end if;
  if not es_admin() and exists (select 1 from convocatorias where creado_por = yo and creado > now() - interval '30 minutes') then
    raise exception 'Ya convocaste un plan hace poco. Espera 30 minutos para mandar otro aviso.';
  end if;
  insert into convocatorias(titulo, anfitrion, lugar, cuando, notas, creado_por)
    values (btrim(p_titulo), p_anfitrion, case when p_anfitrion is null then left(btrim(coalesce(p_lugar, '')), 80) else '' end,
            p_cuando, left(btrim(coalesce(p_notas, '')), 200), yo)
    returning id into nuevo;
  insert into respuestas_conv(conv_id, persona_id, respuesta) values (nuevo, yo, 'voy');
  select nombre into quien from personas where id = yo;
  select nombre into casa from personas where id = p_anfitrion;
  perform bmsn_avisar('📣 ' || split_part(coalesce(quien, 'Alguien'), ' ', 1) || ' convoca: ' || btrim(p_titulo),
    initcap(left(bmsn_cuando_txt(p_cuando), 1)) || substr(bmsn_cuando_txt(p_cuando), 2)
      || coalesce(' · en casa de ' || casa, nullif(' · ' || btrim(coalesce(p_lugar, '')), ' · '), '')
      || '. ¿Vas? Responde en BMSN.', './#inicio');
  return nuevo;
end $$;

-- Voy / Quizás / No voy (null = quitar mi respuesta)
create or replace function public.responder_convocatoria(p_conv uuid, p_respuesta text) returns void
language plpgsql security definer set search_path = public as $$
declare yo uuid := mi_persona();
begin
  if yo is null then raise exception 'Primero elige tu perfil (¿Quién eres?)'; end if;
  if not exists (select 1 from convocatorias where id = p_conv and not cancelada and cuando > now() - interval '6 hours') then
    raise exception 'Esa convocatoria ya no está activa';
  end if;
  if p_respuesta is null then
    delete from respuestas_conv where conv_id = p_conv and persona_id = yo;
  elsif p_respuesta in ('voy', 'quizas', 'no') then
    insert into respuestas_conv(conv_id, persona_id, respuesta) values (p_conv, yo, p_respuesta)
      on conflict (conv_id, persona_id) do update set respuesta = excluded.respuesta, fecha = now();
  else
    raise exception 'Respuesta no válida';
  end if;
end $$;

create or replace function public.cancelar_convocatoria(p_conv uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c convocatorias;
begin
  select * into c from convocatorias where id = p_conv and not cancelada;
  if not found then raise exception 'Esa convocatoria ya no está activa'; end if;
  if not es_admin() and c.creado_por is distinct from mi_persona() then raise exception 'Solo quien convocó el plan o el admin pueden cancelarlo'; end if;
  update convocatorias set cancelada = true where id = p_conv;
  if c.vivo_id is null and c.cuando > now() - interval '1 hour' then
    perform bmsn_avisar('❌ Se cancela: ' || c.titulo, 'El plan de ' || bmsn_cuando_txt(c.cuando) || ' ya no va.', './#inicio');
  end if;
end $$;

-- Ha llegado la hora: la convocatoria pasa a plan en vivo
create or replace function public.empezar_convocatoria(p_conv uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare c convocatorias; v uuid;
begin
  select * into c from convocatorias where id = p_conv and not cancelada and vivo_id is null;
  if not found then raise exception 'Esa convocatoria ya no está activa'; end if;
  v := empezar_plan_vivo(c.titulo, c.anfitrion, trim(both ' ·' from concat_ws(' · ', nullif(c.lugar, ''), nullif(c.notas, ''))));
  update convocatorias set vivo_id = v where id = p_conv;
  return v;
end $$;

revoke execute on function public.bmsn_cuando_txt(timestamptz) from public, anon, authenticated;
revoke execute on function public.convocar_plan(text, uuid, text, timestamptz, text) from public, anon;
revoke execute on function public.responder_convocatoria(uuid, text) from public, anon;
revoke execute on function public.cancelar_convocatoria(uuid) from public, anon;
revoke execute on function public.empezar_convocatoria(uuid) from public, anon;
grant execute on function public.convocar_plan(text, uuid, text, timestamptz, text) to authenticated;
grant execute on function public.responder_convocatoria(uuid, text) to authenticated;
grant execute on function public.cancelar_convocatoria(uuid) to authenticated;
grant execute on function public.empezar_convocatoria(uuid) to authenticated;

-- Copias de seguridad con las convocatorias
create or replace function public.bmsn_volcado() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'version', 6, 'fecha', now(),
    'personas',        (select coalesce(jsonb_agg(to_jsonb(p) order by p.nombre), '[]') from personas p),
    'planes',          (select coalesce(jsonb_agg(to_jsonb(p) order by p.fecha), '[]') from planes p),
    'asistencias',     (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from asistencias a),
    'encuestas',       (select coalesce(jsonb_agg(to_jsonb(e) order by e.creado), '[]') from encuestas e),
    'votos',           (select coalesce(jsonb_agg(to_jsonb(v)), '[]') from votos v),
    'solicitudes',     (select coalesce(jsonb_agg(to_jsonb(s) order by s.creado), '[]') from solicitudes s),
    'jugadores_mes',   (select coalesce(jsonb_agg(to_jsonb(j) order by j.mes), '[]') from jugadores_mes j),
    'valoraciones',    (select coalesce(jsonb_agg(to_jsonb(v)), '[]') from valoraciones v),
    'planes_vivo',     (select coalesce(jsonb_agg(to_jsonb(v) order by v.inicio), '[]') from planes_vivo v),
    'presentes_vivo',  (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from presentes_vivo x),
    'convocatorias',   (select coalesce(jsonb_agg(to_jsonb(c) order by c.creado), '[]') from convocatorias c),
    'respuestas_conv', (select coalesce(jsonb_agg(to_jsonb(r)), '[]') from respuestas_conv r),
    'admins',          (select coalesce(jsonb_agg(a.email), '[]') from admins a)
  )
$$;
revoke execute on function public.bmsn_volcado() from public, anon, authenticated;
