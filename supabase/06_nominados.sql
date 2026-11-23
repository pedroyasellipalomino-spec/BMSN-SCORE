-- BMSN — encuestas en dos fases: nominados (varios votos) → final con los 3 más votados.
-- Ejecutar después de 05_miembro_desde.sql. Se puede ejecutar varias veces.

alter table public.encuestas add column if not exists tipo text not null default 'simple';
alter table public.encuestas add column if not exists max_votos int not null default 1;
alter table public.encuestas add column if not exists padre uuid references public.encuestas(id) on delete cascade;
alter table public.encuestas add column if not exists cerrada boolean not null default false;
do $$ begin
  alter table public.encuestas add constraint encuestas_tipo_ok check (tipo in ('simple', 'nominacion', 'final'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.encuestas add constraint encuestas_max_ok check (max_votos between 1 and 10);
exception when duplicate_object then null; end $$;

-- Un mismo correo puede dar varios votos en una encuesta (uno por opción).
do $$ begin
  if (select array_length(conkey, 1) from pg_constraint where conname = 'votos_pkey') = 2 then
    alter table public.votos drop constraint votos_pkey;
    alter table public.votos add primary key (encuesta_id, user_id, opcion);
  end if;
end $$;

-- Abierta: las normales durante su mes; nominados y final hasta que el admin las cierre.
create or replace function public.encuesta_abierta(e public.encuestas) returns boolean
language sql stable as $$
  select not e.cerrada and case when e.tipo = 'simple' then e.mes = public.bmsn_mes_actual()
                                else e.mes <= public.bmsn_mes_actual() end
$$;

-- Votar una o varias opciones (reemplaza los votos anteriores de esa persona en esa encuesta).
create or replace function public.votar_varios(p_encuesta uuid, p_opciones text[]) returns void
language plpgsql security definer set search_path = public as $$
declare e encuestas; n int;
begin
  if auth.uid() is null then raise exception 'Inicia sesión con tu correo para votar'; end if;
  select * into e from encuestas where id = p_encuesta;
  if not found then raise exception 'La encuesta no existe'; end if;
  if not encuesta_abierta(e) then raise exception 'Esta encuesta no está abierta'; end if;
  select count(distinct o) into n from unnest(p_opciones) o;
  if n = 0 then raise exception 'Elige al menos una opción'; end if;
  if n > e.max_votos then raise exception 'Puedes elegir como máximo %', e.max_votos; end if;
  if exists (select 1 from unnest(p_opciones) o where not (o = any(e.opciones))) then
    raise exception 'Opción no válida';
  end if;
  delete from votos where encuesta_id = p_encuesta and user_id = auth.uid();
  insert into votos(encuesta_id, user_id, email, opcion)
    select p_encuesta, auth.uid(), lower(auth.jwt() ->> 'email'), o from (select distinct unnest(p_opciones) o) x;
end $$;

-- El voto simple de siempre ahora usa lo mismo.
create or replace function public.votar(p_encuesta uuid, p_opcion text) returns void
language sql security definer set search_path = public as $$
  select public.votar_varios(p_encuesta, array[p_opcion])
$$;

-- Cuántas personas votaron en cada encuesta.
create or replace function public.votantes()
returns table(encuesta_id uuid, n bigint)
language sql stable security definer set search_path = public as $$
  select encuesta_id, count(distinct user_id) from votos group by 1
$$;

-- Participación: encuestas en las que votó cada persona (no votos sueltos).
create or replace function public.participacion()
returns table(persona_id uuid, votos bigint, ultimo timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, count(distinct v.encuesta_id), max(v.fecha) from personas p join votos v on v.user_id = p.user_id group by p.id
$$;

revoke execute on function public.votar_varios(uuid, text[]) from public, anon;
grant execute on function public.votar_varios(uuid, text[]) to authenticated;
revoke execute on function public.votar(uuid, text) from public, anon;
grant execute on function public.votar(uuid, text) to authenticated;
grant execute on function public.votantes() to anon, authenticated;
grant execute on function public.participacion() to anon, authenticated;
