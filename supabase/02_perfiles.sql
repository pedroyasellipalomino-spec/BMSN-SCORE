-- BMSN — perfiles: cada correo que entra queda unido a una persona.
-- Ejecutar después de esquema.sql. Se puede ejecutar varias veces.

alter table public.personas
  add column if not exists user_id uuid unique references auth.users(id) on delete set null,
  add column if not exists bio text not null default '',
  add column if not exists emoji text not null default '',
  add column if not exists color int,
  add column if not exists vinculado timestamptz;

do $$ begin
  alter table public.personas add constraint personas_bio_len check (char_length(bio) <= 140);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.personas add constraint personas_emoji_len check (char_length(emoji) <= 8);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.personas add constraint personas_color_rango check (color is null or color between 0 and 359);
exception when duplicate_object then null; end $$;

-- Une la cuenta que llama a una persona: por id (elegida de la lista) o por nombre.
-- Si el nombre existe y está libre, se une a ese perfil; si no existe, se crea.
create or replace function public.vincular(p_persona uuid, p_nombre text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; n text := trim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g'));
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero'; end if;
  select id into v from personas where user_id = auth.uid();
  if found then return v; end if;

  if p_persona is not null then
    update personas set user_id = auth.uid(), vinculado = now()
      where id = p_persona and user_id is null returning id into v;
    if v is null then raise exception 'Ese perfil ya pertenece a otra cuenta'; end if;
    return v;
  end if;

  if n = '' or char_length(n) > 40 then raise exception 'Escribe tu nombre (máximo 40 letras)'; end if;
  select id into v from personas where lower(nombre) = lower(n);
  if found then
    update personas set user_id = auth.uid(), vinculado = now()
      where id = v and user_id is null returning id into v;
    if v is null then raise exception 'Ese nombre ya pertenece a otra cuenta'; end if;
    return v;
  end if;

  insert into personas(nombre, user_id, vinculado) values (n, auth.uid(), now()) returning id into v;
  return v;
end $$;

-- Cada miembro edita su propio perfil.
create or replace function public.editar_perfil(p_nombre text, p_bio text, p_emoji text, p_color int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero'; end if;
  update personas set
    nombre = trim(regexp_replace(p_nombre, '\s+', ' ', 'g')),
    bio = trim(coalesce(p_bio, '')),
    emoji = coalesce(p_emoji, ''),
    color = p_color
  where user_id = auth.uid();
  if not found then raise exception 'Tu cuenta no tiene perfil todavía'; end if;
end $$;

-- El admin puede soltar una cuenta de un perfil (por si alguien eligió el equivocado).
create or replace function public.desvincular(p_persona uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Solo el admin puede hacer esto'; end if;
  update personas set user_id = null, vinculado = null where id = p_persona;
end $$;

-- Cuántas encuestas votó cada persona (sin revelar qué votó).
create or replace function public.participacion()
returns table(persona_id uuid, votos bigint, ultimo timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, count(v.*), max(v.fecha) from personas p join votos v on v.user_id = p.user_id group by p.id
$$;

-- Qué personas son admin (para mostrar la insignia).
create or replace function public.personas_admin()
returns table(persona_id uuid)
language sql stable security definer set search_path = public, auth as $$
  select p.id from personas p
  join auth.users u on u.id = p.user_id
  join admins a on lower(a.email) = lower(u.email)
$$;

revoke execute on function public.vincular(uuid, text) from public, anon;
revoke execute on function public.editar_perfil(text, text, text, int) from public, anon;
revoke execute on function public.desvincular(uuid) from public, anon;
grant execute on function public.vincular(uuid, text) to authenticated;
grant execute on function public.editar_perfil(text, text, text, int) to authenticated;
grant execute on function public.desvincular(uuid) to authenticated;
grant execute on function public.participacion() to anon, authenticated;
grant execute on function public.personas_admin() to anon, authenticated;
