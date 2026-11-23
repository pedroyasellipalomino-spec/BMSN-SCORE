# BMSN

Herramienta personal para anotar quién va a cada plan, quién puso casa y ver los promedios de cada persona. Incluye encuestas mensuales en las que se vota con un correo verificado (Gmail o cualquier otro), sin necesidad de cuenta de GitHub.

## Cómo está montado

- **Página**: HTML + JS estático (`index.html`, `app.js`, `styles.css`).
- **Base de datos y verificación de correos**: [Supabase](https://supabase.com) (plan gratis). Ejecuta en orden `supabase/esquema.sql`, `supabase/02_perfiles.sql` y `supabase/03_fotos_admin.sql`, `04_clave_grupo.sql`, `05_miembro_desde.sql`, `06_nominados.sql`, `07_tema.sql`, `08_jugador_del_mes.sql`, `09_mejoras.sql`, `10_solicitudes.sql` y `11_avisos.sql`, y despliega la función `supabase/functions/avisar` (secretos VAPID_PUBLICA, VAPID_PRIVADA, AVISOS_SECRETO).
- **Conexión**: `config.js` lleva la URL del proyecto y la clave pública `anon`. La seguridad la ponen las reglas RLS del esquema.

## Permisos

- **Admin** (solo tú): la primera cuenta que entra en la página queda como admin. Puede anotar planes, personas y encuestas, y ver quién votó qué.
- **Cualquiera con correo**: entra con un código de 6 dígitos que llega a su correo (o con la contraseña del grupo) y vota. Un voto por correo y encuesta (si vuelve a votar, cambia su voto). Solo se vota durante el mes de la encuesta (zona horaria `America/Lima`, se cambia en `esquema.sql` y en `app.js`).
- **Público**: ve los promedios y los resultados de las encuestas (solo conteos, nunca los correos).

## Perfiles

- Cada correo que entra elige quién es: si escribe un nombre que ya existe, su cuenta se une a ese perfil con todas sus estadísticas; si no, se crea uno nuevo.
- Cada miembro edita su propio perfil (nombre, emoji, color y frase). El admin puede editar cualquiera y soltar una cuenta de un perfil equivocado.
- El perfil muestra asistencia, veces que puso casa, racha, encuestas votadas y el historial de actividad. Qué votó cada uno solo lo ve esa persona (y el admin).

## Miembros: "Yo fui" y "Proponer plan"

- En un plan pasado, el miembro pulsa **🙋 Yo fui** y el admin lo aprueba desde su panel.
- Con el **＋** un miembro **propone** un plan completo; al aprobarlo entra al calendario y a las estadísticas.
- Los meses importados de la lista llevan la marca **≈**: los totales son exactos, pero quién fue a cada plan es aproximado.

## Logros y BMSN Wrapped

- **Logros** con niveles en cada perfil: planes, rachas, casas, meses perfectos, maratón, votos, Jugador del mes, cumpleaños y "De los de siempre".
- **BMSN Wrapped**: el resumen del año en pantallas tipo historia (tarjeta en Inicio, botón en el perfil o `#wrapped`).

## Avisos push

Notificaciones al teléfono (Android, computadora e iPhone/iPad con BMSN instalada en la pantalla de inicio) cuando se abre el Jugador del mes, su final y al proclamarlo; al admin, además, por cada solicitud nueva. Se activan en el perfil (🔔 Activar avisos). Los envía la Edge Function `avisar`, llamada desde la base de datos con un secreto compartido.

## Mantenimiento y seguridad

- **Supabase no se pausa:** cada día Supabase hace una consulta a su propia API (pg_cron + pg_net) y, como respaldo, una GitHub Action (`mantener-activo.yml`) lo hace cada 3 días.
- **Copias de seguridad:** cada domingo se guarda una copia completa en la tabla privada `bmsn_copias` (se conservan 12). Desde el panel de admin se puede hacer una al momento y descargar cualquiera en JSON.
- **Contraseña del grupo:** una cuenta que ya entró con el código del correo solo puede volver a entrar con código, así nadie puede suplantarla con la contraseña del grupo.
- **Renombrar personas** actualiza sus opciones y votos en las encuestas del Jugador del mes.

## Temas

Cada miembro elige su tema con el botón 🎨: **Neón**, **Vice City**, **Escudo**, **Océano** o **Día** (claro). Con sesión iniciada se guarda en su perfil y le sigue en todos sus aparatos.

## Jugador del mes (automático, en dos fases)

El día 1 de cada mes se abre sola la votación del mes anterior; 2 días después, la final; y 2 días más tarde la final se cierra y se proclama al jugador del mes (pg_cron en Supabase; además la app lo comprueba al abrirse).


1. **Fase 1 · Nominados**: cada miembro vota a varias personas (por defecto hasta 3).
2. El admin pulsa **Cerrar nominados y crear la final**: los 3 más votados (con empates en el 3.º puesto incluidos) pasan a la final.
3. **Fase 2 · Final**: un voto por persona. Al cerrarla se proclama al **🏆 Jugador del mes**, que aparece en Encuestas, en Inicio y como insignia en su perfil.

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
