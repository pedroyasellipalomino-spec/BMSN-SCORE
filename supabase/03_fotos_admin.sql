-- BMSN — fotos de perfil y gestión de admins. Ejecutar después de 02_perfiles.sql.

alter table public.personas add column if not exists foto text;

-- Carpeta pública de fotos (máx. 2 MB, solo imágenes).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatares', 'avatares', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- Cada uno sube solo su foto (archivo <id de su persona>.jpg); el admin, cualquiera.
create or replace function public.puede_foto(p_nombre_archivo text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.es_admin() or exists (
    select 1 from personas where user_id = auth.uid() and id::text = split_part(p_nombre_archivo, '.', 1)
  )
$$;
grant execute on function public.puede_foto(text) to authenticated;

drop policy if exists "avatares leer" on storage.objects;
drop policy if exists "avatares subir" on storage.objects;
drop policy if exists "avatares cambiar" on storage.objects;
drop policy if exists "avatares borrar" on storage.objects;
create policy "avatares leer" on storage.objects for select using (bucket_id = 'avatares');
create policy "avatares subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatares' and public.puede_foto(name));
create policy "avatares cambiar" on storage.objects for update to authenticated
  using (bucket_id = 'avatares' and public.puede_foto(name))
  with check (bucket_id = 'avatares' and public.puede_foto(name));
create policy "avatares borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'avatares' and public.puede_foto(name));

-- Guardar (o quitar) la foto de una persona.
create or replace function public.poner_foto(p_persona uuid, p_url text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (es_admin() or exists (select 1 from personas where id = p_persona and user_id = auth.uid())) then
    raise exception 'Solo puedes cambiar tu propia foto';
  end if;
  if p_url is not null and p_url not like '%/storage/v1/object/public/avatares/%' then
    raise exception 'Foto no válida';
  end if;
  update personas set foto = p_url where id = p_persona;
end $$;
revoke execute on function public.poner_foto(uuid, text) from public, anon;
grant execute on function public.poner_foto(uuid, text) to authenticated;

-- El admin puede añadir o quitar otros admins.
drop policy if exists "admin gestiona admins" on public.admins;
create policy "admin gestiona admins" on public.admins for all
  using (public.es_admin()) with check (public.es_admin());
grant insert, delete on public.admins to authenticated;
