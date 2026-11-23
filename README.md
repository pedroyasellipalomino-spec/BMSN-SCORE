# BMSN

Herramienta personal para anotar quién va a cada plan, quién puso casa y ver los promedios de cada persona. Incluye encuestas mensuales en las que se vota con un correo verificado (Gmail o cualquier otro), sin necesidad de cuenta de GitHub.

## Cómo está montado

- **Página**: HTML + JS estático (`index.html`, `app.js`, `styles.css`).
- **Base de datos y verificación de correos**: [Supabase](https://supabase.com) (plan gratis). Ejecuta en orden `supabase/esquema.sql` y `supabase/02_perfiles.sql`.
- **Conexión**: `config.js` lleva la URL del proyecto y la clave pública `anon`. La seguridad la ponen las reglas RLS del esquema.

## Permisos

- **Admin** (solo tú): la primera cuenta que entra en la página queda como admin. Puede anotar planes, personas y encuestas, y ver quién votó qué.
- **Cualquiera con correo**: entra con un enlace que llega a su correo y vota. Un voto por correo y encuesta (si vuelve a votar, cambia su voto). Solo se vota durante el mes de la encuesta (zona horaria `America/Lima`, se cambia en `esquema.sql` y en `app.js`).
- **Público**: ve los promedios y los resultados de las encuestas (solo conteos, nunca los correos).

## Perfiles

- Cada correo que entra elige quién es: si escribe un nombre que ya existe, su cuenta se une a ese perfil con todas sus estadísticas; si no, se crea uno nuevo.
- Cada miembro edita su propio perfil (nombre, emoji, color y frase). El admin puede editar cualquiera y soltar una cuenta de un perfil equivocado.
- El perfil muestra asistencia, veces que puso casa, racha, encuestas votadas y el historial de actividad. Qué votó cada uno solo lo ve esa persona (y el admin).

## Promedios

- % asistencia = planes a los que fue ÷ planes del periodo
- % casa = veces que puso casa ÷ planes a los que fue
- Promedio por mes = asistencias ÷ meses con planes

## Probar sin tocar datos reales

Añade `?demo` a la dirección (`…/BMSN-SCORE/?demo`): carga datos inventados y nada se guarda.
