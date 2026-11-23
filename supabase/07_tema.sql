-- BMSN — tema de colores de cada miembro (le sigue en todos sus aparatos).
alter table public.personas add column if not exists tema text;
do $$ begin
  alter table public.personas add constraint personas_tema_ok check (tema is null or tema in ('neon', 'vice', 'escudo', 'oceano', 'dia'));
exception when duplicate_object then null; end $$;

create or replace function public.poner_tema(p_tema text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero'; end if;
  update personas set tema = p_tema where user_id = auth.uid();
end $$;
revoke execute on function public.poner_tema(text) from public, anon;
grant execute on function public.poner_tema(text) to authenticated;
