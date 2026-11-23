# BMSN

Herramienta personal para anotar quién va a cada plan, quién puso casa y ver los promedios de cada persona. Incluye encuestas mensuales en las que se vota con un correo verificado (Gmail o cualquier otro), sin necesidad de cuenta de GitHub.

## Cómo está montado

- **Página**: HTML + JS estático (`index.html`, `app.js`, `styles.css`).
- **Base de datos y verificación de correos**: [Supabase](https://supabase.com) (plan gratis). El esquema está en `supabase/esquema.sql`.
- **Conexión**: `config.js` lleva la URL del proyecto y la clave pública `anon`. La seguridad la ponen las reglas RLS del esquema.

## Permisos

- **Admin** (solo tú): la primera cuenta que entra en la página queda como admin. Puede anotar planes, personas y encuestas, y ver quién votó qué.
- **Cualquiera con correo**: entra con un enlace que llega a su correo y vota. Un voto por correo y encuesta (si vuelve a votar, cambia su voto). Solo se vota durante el mes de la encuesta (zona horaria `America/Lima`, se cambia en `esquema.sql` y en `app.js`).
- **Público**: ve los promedios y los resultados de las encuestas (solo conteos, nunca los correos).

## Promedios

- % asistencia = planes a los que fue ÷ planes del periodo
- % casa = veces que puso casa ÷ planes a los que fue
- Promedio por mes = asistencias ÷ meses con planes

## Probar sin tocar datos reales

Añade `?demo` a la dirección (`…/BMSN-SCORE/?demo`): carga datos inventados y nada se guarda.
