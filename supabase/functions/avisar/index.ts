// BMSN — envía notificaciones push a los miembros que activaron los avisos.
// La llama la base de datos (bmsn_avisar) con un secreto compartido; no es pública.
// Secretos de la función: VAPID_PUBLICA, VAPID_PRIVADA, AVISOS_SECRETO.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
webpush.setVapidDetails(
  "https://pedroyasellipalomino-spec.github.io/BMSN-SCORE/",
  Deno.env.get("VAPID_PUBLICA")!,
  Deno.env.get("VAPID_PRIVADA")!,
);

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Método no permitido", { status: 405 });
  if (req.headers.get("x-bmsn-secreto") !== Deno.env.get("AVISOS_SECRETO")) return new Response("No autorizado", { status: 401 });

  const { titulo, cuerpo, url, solo_admins } = await req.json();
  const { data: subs, error } = await sb.rpc("push_destinos", { p_solo_admins: !!solo_admins });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const payload = JSON.stringify({ titulo, cuerpo, url: url || "./" });
  let enviados = 0, borradas = 0, fallos = 0;
  await Promise.all((subs ?? []).map(async (s: { endpoint: string; p256dh: string; auth: string }) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: "high" });
      enviados++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) { await sb.rpc("push_borrar", { p_endpoint: s.endpoint }); borradas++; }
      else fallos++;
    }
  }));
  return Response.json({ total: subs?.length ?? 0, enviados, borradas, fallos });
});
