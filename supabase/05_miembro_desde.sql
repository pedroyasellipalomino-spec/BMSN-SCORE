-- BMSN — fecha de ingreso de cada persona ("Miembro desde").
-- Su % de asistencia solo cuenta los planes desde esa fecha. Vacío = desde siempre.
alter table public.personas add column if not exists desde date;
