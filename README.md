# BMSN

Herramienta personal para anotar quién va a cada plan, quién puso casa y ver los promedios de cada persona. Incluye encuestas mensuales en las que se vota con un correo verificado (Gmail o cualquier otro), sin necesidad de cuenta de GitHub.

## Cómo está montado

- **Página**: HTML + JS estático (`index.html`, `app.js`, `styles.css`).
- **Base de datos y verificación de correos**: [Supabase](https://supabase.com) (plan gratis). Ejecuta en orden `supabase/esquema.sql`, `supabase/02_perfiles.sql` y `supabase/03_fotos_admin.sql`.
- **Conexión**: `config.js` lleva la URL del proyecto y la clave pública `anon`. La seguridad la ponen las reglas RLS del esquema.

## Permisos

- **Admin** (solo tú): la primera cuenta que entra en la página queda como admin. Puede anotar planes, personas y encuestas, y ver quién votó qué.
- **Cualquiera con correo**: entra con un código de 6 dígitos que llega a su correo (o con la contraseña del grupo) y vota. Un voto por correo y encuesta (si vuelve a votar, cambia su voto). Solo se vota durante el mes de la encuesta (zona horaria `America/Lima`, se cambia en `esquema.sql` y en `app.js`).
- **Público**: ve los promedios y los resultados de las encuestas (solo conteos, nunca los correos).

## Perfiles

- Cada correo que entra elige quién es: si escribe un nombre que ya existe, su cuenta se une a ese perfil con todas sus estadísticas; si no, se crea uno nuevo.
- Cada miembro edita su propio perfil (nombre, emoji, color y frase). El admin puede editar cualquiera y soltar una cuenta de un perfil equivocado.
- El perfil muestra asistencia, veces que puso casa, racha, encuestas votadas y el historial de actividad. Qué votó cada uno solo lo ve esa persona (y el admin).

## Calendario y panel de admin

- **Planes → Calendario**: cada día con plan aparece marcado. Si tu cuenta está unida a tu perfil, ves en verde los planes a los que fuiste, en naranja donde pusiste casa y con ✕ los que te perdiste. Con «Ver como» se mira a cualquier otra persona.
- **Panel de admin** (`#admin`): resumen, acciones rápidas, estado de las cuentas, gestión de admins y descarga de los planes en CSV.
- **Fotos de perfil**: se recortan y reducen en el navegador antes de subirse a Supabase Storage.

## Promedios

- % asistencia = planes a los que fue ÷ planes del periodo
- % casa = veces que puso casa ÷ planes a los que fue
- Promedio por mes = asistencias ÷ meses con planes

## Instalar como app

BMSN es una app instalable (PWA): icono propio, pantalla completa y abre sin señal con los últimos datos.

- **iPhone / iPad**: abrir el link en Safari → Compartir → *Añadir a pantalla de inicio*.
- **Android**: Chrome muestra *Instalar app* (o el botón *Instalar* dentro de BMSN).
- **Computadora**: icono *Instalar* en la barra de direcciones de Chrome o Edge.

Para entrar se usa un código de 6 dígitos que llega por correo (o la contraseña del grupo), así que funciona igual en Safari y en la app instalada.

## Probar sin tocar datos reales

Añade `?demo` a la dirección (`…/BMSN-SCORE/?demo`): carga datos inventados y nada se guarda.
