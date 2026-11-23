-- BMSN — entrar con la contraseña del grupo (sin correo de verificación).
-- Ejecutar después de 03_fotos_admin.sql. La contraseña NO va en este archivo:
-- se guarda cifrada desde el panel de admin (o con el INSERT que te da Claude en el chat).

create extension if not exists pgcrypto with schema extensions;

-- Ajustes privados: nadie los lee directamente (RLS sin políticas).
create table if not exists public.bmsn_ajustes (
  clave text primary key,
  valor text not null
);
alter table public.bmsn_ajustes enable row level security;
revoke all on public.bmsn_ajustes from anon, authenticated;

-- Misma normalización que en app.js: minúsculas, sin tildes, espacios simples.
create or replace function public.bmsn_normalizar(p text) returns text
language sql immutable as $$
  select btrim(regexp_replace(lower(translate(coalesce(p, ''),
    'ÁÉÍÓÚÜÑÀÈÌÒÙÂÊÎÔÛáéíóúüñàèìòùâêîôû', 'AEIOUUNAEIOUAEIOUaeiouunaeiouaeiou')), '\s+', ' ', 'g'))
$$;

-- ¿Hay contraseña de grupo configurada? (para mostrar la pestaña)
create or replace function public.clave_grupo_activa() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from bmsn_ajustes where clave = 'grupo')
$$;
grant execute on function public.clave_grupo_activa() to anon, authenticated;

-- El admin pone o cambia la contraseña del grupo.
create or replace function public.poner_clave_grupo(p_clave text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare n text := bmsn_normalizar(p_clave);
begin
  if not es_admin() then raise exception 'Solo el admin puede cambiar la contraseña del grupo'; end if;
  if char_length(n) < 6 then raise exception 'La contraseña debe tener al menos 6 caracteres'; end if;
  insert into bmsn_ajustes(clave, valor) values ('grupo', extensions.crypt(n, extensions.gen_salt('bf')))
  on conflict (clave) do update set valor = excluded.valor;
end $$;
revoke execute on function public.poner_clave_grupo(text) from public, anon;
grant execute on function public.poner_clave_grupo(text) to authenticated;

-- Comprueba la contraseña del grupo y deja lista la cuenta de ese correo
-- (la crea si no existe) con la contraseña del grupo. Después la app inicia sesión.
create or replace function public.entrar_grupo(p_email text, p_clave text) returns text
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  hash text; n text := bmsn_normalizar(p_clave);
  e text := lower(btrim(coalesce(p_email, '')));
  uid uuid;
begin
  select valor into hash from bmsn_ajustes where clave = 'grupo';
  if hash is null then raise exception 'El admin todavía no ha puesto la contraseña del grupo'; end if;
  if extensions.crypt(n, hash) <> hash then
    perform pg_sleep(1); -- frena a quien intente adivinarla
    raise exception 'Contraseña del grupo incorrecta';
  end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Escribe un correo válido'; end if;
  if exists (select 1 from admins where lower(email) = e) then
    raise exception 'El correo del admin entra con el enlace por correo';
  end if;

  select id into uid from auth.users where lower(email) = e;
  if uid is null then
    uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', e,
      extensions.crypt(n, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{"via":"clave_grupo"}', now(), now(),
      '', '', '', ''
    );
    insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid::text, uid,
      jsonb_build_object('sub', uid::text, 'email', e, 'email_verified', true), 'email', now(), now(), now());
  else
    update auth.users set encrypted_password = extensions.crypt(n, extensions.gen_salt('bf')),
      email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
    where id = uid;
  end if;
  return 'ok';
end $$;
revoke execute on function public.entrar_grupo(text, text) from public;
grant execute on function public.entrar_grupo(text, text) to anon, authenticated;
