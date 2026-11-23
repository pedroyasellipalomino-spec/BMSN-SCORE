-- BMSN — "Jugador del mes" automático.
--  · Día 1 de cada mes: se abre la votación de nominados del mes anterior (hasta 3 por persona).
--  · 2 días después: se cierra y se abre la final con los 3 más votados (empates en el 3.º incluidos).
-- Ejecutar después de 06_nominados.sql. Se puede ejecutar varias veces.

create or replace function public.bmsn_nombre_mes(p_mes text) returns text
language sql immutable as $$
  select (array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'])
         [split_part(p_mes, '-', 2)::int]
$$;

create or replace function public.automatizar_encuestas() returns text
language plpgsql security definer set search_path = public as $$
declare
  hoy date := (now() at time zone 'America/Lima')::date;
  fin_prev date := date_trunc('month', hoy)::date - 1;
  mes_prev text := to_char(fin_prev, 'YYYY-MM');
  nom encuestas; top text[]; corte bigint; hecho text := 'nada';
begin
  -- 1) Nominados del mes anterior (solo en los primeros días del mes)
  select * into nom from encuestas where tipo = 'nominacion' and mes = mes_prev order by creado limit 1;
  if not found and extract(day from hoy) <= 5 then
    insert into encuestas(mes, pregunta, opciones, tipo, max_votos)
      select mes_prev, 'Jugador del mes · ' || bmsn_nombre_mes(mes_prev), array_agg(nombre order by nombre), 'nominacion', 3
      from personas where desde is null or desde <= fin_prev
      having count(*) >= 2;
    return 'nominados creados';
  end if;

  -- 2) Final dos días después de abrir los nominados (de cualquier mes pendiente)
  for nom in select * from encuestas e where e.tipo = 'nominacion' and not e.cerrada
             and hoy >= (e.creado at time zone 'America/Lima')::date + 2
             and not exists (select 1 from encuestas f where f.padre = e.id) loop
    select n into corte from (select count(*) n from votos where encuesta_id = nom.id group by opcion order by 1 desc offset 2 limit 1) x;
    select array_agg(opcion order by n desc, opcion) into top
      from (select opcion, count(*) n from votos where encuesta_id = nom.id group by opcion) c
      where n >= coalesce(corte, 1);
    if coalesce(array_length(top, 1), 0) >= 2 then
      insert into encuestas(mes, pregunta, opciones, tipo, max_votos, padre)
        values (nom.mes, '¿Quién es el jugador de ' || bmsn_nombre_mes(nom.mes) || '?', top, 'final', 1, nom.id);
      update encuestas set cerrada = true where id = nom.id;
      hecho := 'final creada';
    end if; -- si aún no hay al menos 2 nominados con votos, se espera al día siguiente
  end loop;
  return hecho;
end $$;
-- Es idempotente y no toca nada que no toque: la app la llama al abrirse.
grant execute on function public.automatizar_encuestas() to anon, authenticated;

-- Programarla todos los días a las 00:05 de Lima (05:05 UTC) con pg_cron.
do $$
begin
  begin
    create extension if not exists pg_cron with schema pg_catalog;
  exception when others then
    raise notice 'pg_cron no disponible (%): la app lo hará al abrirse', sqlerrm;
    return;
  end;
  perform cron.unschedule(jobid) from cron.job where jobname = 'bmsn-jugador-del-mes';
  perform cron.schedule('bmsn-jugador-del-mes', '5 5 * * *', 'select public.automatizar_encuestas()');
end $$;
