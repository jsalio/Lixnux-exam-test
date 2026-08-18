/**
 * Edge Function `record-attempt`.
 *
 * Único endpoint público del registro de intentos del examen LPI 010-160.
 * Recibe un intento finalizado desde el navegador, deriva en el servidor lo que
 * el cliente no puede decidir (IP, clave de agrupación) y delega la escritura en
 * `public.record_exam_attempt`, que es lo único que puede tocar el esquema
 * `telemetry`.
 *
 * Contrato: docs/specs/registro-intentos-supabase.spec.md
 *
 * La autenticación la resuelve la plataforma: con `verify_jwt` activo (valor por
 * defecto de `functions deploy`) una petición sin `apikey`/`Authorization` válidos
 * nunca llega hasta aquí.
 */

import {
  type AttemptInput,
  clientIp,
  corsHeaders,
  MAX_BODY_BYTES,
  normalizeUserKey,
  RETRY_AFTER_SECONDS,
  USER_AGENT_MAX,
  validateBody,
} from "./validation.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

/** Respuesta JSON con las cabeceras CORS ya incorporadas. */
function json(status: number, payload: unknown, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = corsHeaders(req.headers.get("origin") ?? "");
  if (!cors) {
    return new Response(JSON.stringify({ ok: false, error: "forbidden_origin" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" }, cors);

  const declarado = Number(req.headers.get("content-length") ?? "0");
  if (declarado > MAX_BODY_BYTES) return json(413, { ok: false, error: "payload_too_large" }, cors);

  const crudo = await req.text();
  if (crudo.length > MAX_BODY_BYTES) return json(413, { ok: false, error: "payload_too_large" }, cors);

  let body: unknown;
  try {
    body = JSON.parse(crudo);
  } catch {
    return json(400, { ok: false, error: "invalid_payload", campos: ["body"] }, cors);
  }

  const validado = validateBody(body);
  if (!validado.ok) {
    return json(400, { ok: false, error: "invalid_payload", campos: validado.campos }, cors);
  }
  const intento = validado.value;

  // Derivado en el servidor: el cliente no decide ni la IP ni la clave de agrupación.
  const ip = clientIp(req);
  const userAgent = (req.headers.get("user-agent") ?? "").slice(0, USER_AGENT_MAX);
  const usuarioKey = normalizeUserKey(intento.usuario_nombre.trim());

  let fila: { id: number | null; intento_num: number | null; duplicado: boolean; rate_limited: boolean };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_exam_attempt`, {
      method: "POST",
      headers: {
        "apikey": SERVICE_KEY,
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_client_attempt_id: intento.client_attempt_id,
        p_usuario_nombre: intento.usuario_nombre.trim(),
        p_usuario_key: usuarioKey,
        p_modo: intento.modo,
        p_total_preguntas: intento.total_preguntas,
        p_limite_minutos: intento.limite_minutos,
        p_correctas: intento.correctas,
        p_incorrectas: intento.incorrectas,
        p_sin_responder: intento.sin_responder,
        p_porcentaje: intento.porcentaje,
        p_puntuacion_escala: intento.puntuacion_escala,
        p_duracion_segundos: intento.duracion_segundos,
        p_desglose_temas: intento.desglose_temas,
        p_idioma: intento.idioma,
        p_app_version: intento.app_version,
        p_ip: ip,
        p_user_agent: userAgent,
      }),
    });

    if (!res.ok) {
      // El detalle se queda en el log; la respuesta nunca expone el esquema ni el error de Postgres.
      console.error("rpc_error", res.status, await res.text());
      return json(500, { ok: false, error: "db_error" }, cors);
    }

    const filas = await res.json();
    if (!Array.isArray(filas) || filas.length === 0) {
      console.error("rpc_sin_filas", JSON.stringify(filas));
      return json(500, { ok: false, error: "db_error" }, cors);
    }
    fila = filas[0];
  } catch (e) {
    console.error("rpc_fetch_error", e instanceof Error ? e.message : String(e));
    return json(500, { ok: false, error: "db_error" }, cors);
  }

  if (fila.rate_limited) {
    return json(429, { ok: false, error: "rate_limited", reintentar_en: RETRY_AFTER_SECONDS }, cors);
  }

  return json(fila.duplicado ? 200 : 201, {
    ok: true,
    id: fila.id,
    intento_num: fila.intento_num,
    duplicado: fila.duplicado,
  }, cors);
});
