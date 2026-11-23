# BMSN

Herramienta para anotar quién va a cada plan, quién puso casa y ver los promedios de cada persona. También permite hacer encuestas mensuales con votos verificados.

Todo funciona sobre GitHub: la página está en **GitHub Pages**, los datos viven en `data/` (JSON) y cada cambio entra como un **issue** que procesa una **GitHub Action**. No hay que pagar ni mantener ningún servidor.

## Qué hace

- **Planes**: fecha, nombre, quién puso casa 🏠 y quién asistió.
- **Promedios** (por todo el historial, por año o por mes):
  - % asistencia = planes a los que fue ÷ planes del periodo
  - veces que puso casa y % casa = veces que puso casa ÷ planes a los que fue
  - promedio de asistencias por mes
- **Encuestas mensuales**: una por mes. Solo se puede votar durante ese mes.

## Cómo se verifican los votos

1. Votar abre un issue de GitHub ya rellenado. GitHub **solo deja abrir issues a cuentas con el correo electrónico verificado**.
2. La Action comprueba que el usuario de GitHub esté registrado en `data/personas.json` (lista de quiénes pueden votar).
3. Un voto por cuenta y por encuesta. Si alguien vuelve a votar, se reemplaza su voto anterior.
4. El voto queda guardado en `data/votos.json` y en el historial de commits.

> Ojo: si el repositorio es público, los votos son públicos (se ve quién votó qué).

## Puesta en marcha (una sola vez)

1. Fusiona esta rama en `main`.
2. **Settings → Pages → Source: GitHub Actions**.
3. **Settings → Actions → General → Workflow permissions: Read and write**.
4. Revisa `data/config.json`:
   - `admins`: usuarios de GitHub que pueden anotar planes, personas y encuestas (el dueño del repo siempre puede).
   - `zonaHoraria`: decide cuándo empieza y termina cada mes para las encuestas.
5. Abre la página (`https://<usuario>.github.io/BMSN-SCORE/`), añade a las personas y empieza a anotar planes.

## Estructura

| Archivo | Qué es |
|---|---|
| `index.html`, `app.js`, `styles.css` | La página |
| `data/*.json` | Base de datos (personas, planes, encuestas, votos, config) |
| `scripts/procesar.mjs` | Valida cada issue y actualiza los JSON |
| `.github/workflows/procesar.yml` | Ejecuta el script cuando se abre un issue `BMSN …` |
| `.github/workflows/pages.yml` | Publica la página en GitHub Pages |
