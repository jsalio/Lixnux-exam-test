/**
 * Validación y derivaciones puras de la Edge Function `record-attempt`.
 *
 * Sin E/S y sin estado: todo lo que hay aquí se puede probar con `deno test`.
 * `index.ts` se queda con el transporte (CORS, HTTP, llamada al RPC).
 */

/** Orígenes que pueden llamar al endpoint desde un navegador. */
export const ALLOWED_ORIGINS = new Set([
  "https://jsalio.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
  "null", // la app abierta como file://
]);

export const MAX_BODY_BYTES = 8 * 1024;
const NOMBRE_MIN = 2;
const NOMBRE_MAX = 80;
const APP_VERSION_MAX = 40;
const MAX_TEMAS = 20;
export const USER_AGENT_MAX = 300;
export const RETRY_AFTER_SECONDS = 1800;
const SIMULACRO_MINUTOS = 60;

const MODOS = new Set(["simulacro_60min", "completo"]);
const IDIOMAS = new Set(["both", "es", "en"]);

/** Claves admitidas en el body. Cualquier otra es motivo de rechazo. */
const CAMPOS_PERMITIDOS = new Set([
  "client_attempt_id", "usuario_nombre", "modo", "total_preguntas", "limite_minutos",
  "correctas", "incorrectas", "sin_responder", "porcentaje", "puntuacion_escala",
  "duracion_segundos", "desglose_temas", "idioma", "app_version",
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const IPV6_RE = /^[0-9a-f:]+$/i;

export interface AttemptInput {
  client_attempt_id: string;
  usuario_nombre: string;
  modo: string;
  total_preguntas: number;
  limite_minutos: number | null;
  correctas: number;
  incorrectas: number;
  sin_responder: number;
  porcentaje: number;
  puntuacion_escala: number;
  duracion_segundos: number;
  desglose_temas: Record<string, { n: number; ok: number }>;
  idioma: string;
  app_version: string;
}

/**
 * Construye las cabeceras CORS para un origen concreto.
 *
 * @param origin - Valor de la cabecera `Origin`; cadena vacía si no viene.
 * @returns Cabeceras a añadir a la respuesta, o null si el origen no está permitido.
 */
export function corsHeaders(origin: string): Record<string, string> | null {
  if (!ALLOWED_ORIGINS.has(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

/**
 * Extrae la IP del cliente de las cabeceras de la petición.
 * Toma el primer valor de `x-forwarded-for`, descarta el puerto y acepta IPv6
 * tanto en forma desnuda como entre corchetes.
 *
 * @param req - Petición entrante.
 * @returns IP en formato textual, o null si ninguna cabecera la aporta o no parece válida.
 */
export function clientIp(req: Request): string | null {
  const raw = (req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "")
    .split(",")[0]
    .trim();
  if (!raw) return null;

  let candidate = raw;
  if (candidate.startsWith("[")) {
    // [2001:db8::1]:443 -> 2001:db8::1
    candidate = candidate.slice(1, candidate.indexOf("]") > 0 ? candidate.indexOf("]") : undefined);
  } else if ((candidate.match(/:/g) ?? []).length === 1) {
    // 203.0.113.7:44321 -> 203.0.113.7 (un solo ':' nunca es IPv6)
    candidate = candidate.split(":")[0];
  }

  if (IPV4_RE.test(candidate)) {
    return candidate.split(".").every((o) => Number(o) <= 255) ? candidate : null;
  }
  return IPV6_RE.test(candidate) && candidate.includes(":") ? candidate : null;
}

/**
 * Normaliza un nombre para agrupar los intentos de la misma persona.
 * Recorta, colapsa espacios, pasa a minúsculas y elimina diacríticos.
 *
 * @param nombre - Nombre escrito por el usuario.
 * @returns Clave de agrupación estable; cadena vacía si el nombre no es válido.
 */
export function normalizeUserKey(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 '\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Comprueba que el valor es un entero dentro del rango indicado. */
export function esEntero(v: unknown, min: number, max: number): boolean {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

/**
 * Valida el cuerpo de la petición de registro de intento.
 *
 * @param body - JSON recibido, de estructura no confiable.
 * @returns Payload validado y tipado, o la lista de campos que no superaron la validación.
 */
export function validateBody(
  body: unknown,
): { ok: true; value: AttemptInput } | { ok: false; campos: string[] } {
  const campos: string[] = [];
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, campos: ["body"] };
  }
  const b = body as Record<string, unknown>;

  for (const clave of Object.keys(b)) {
    if (!CAMPOS_PERMITIDOS.has(clave)) campos.push(clave);
  }

  if (typeof b.client_attempt_id !== "string" || !UUID_RE.test(b.client_attempt_id)) {
    campos.push("client_attempt_id");
  }

  const nombre = typeof b.usuario_nombre === "string" ? b.usuario_nombre.trim() : "";
  if (nombre.length < NOMBRE_MIN || nombre.length > NOMBRE_MAX) campos.push("usuario_nombre");
  if (nombre && !normalizeUserKey(nombre)) campos.push("usuario_nombre");

  const modo = typeof b.modo === "string" ? b.modo : "";
  if (!MODOS.has(modo)) campos.push("modo");

  if (!esEntero(b.total_preguntas, 1, 500)) campos.push("total_preguntas");

  // El límite es función del modo, no un dato libre.
  if (modo === "simulacro_60min" && b.limite_minutos !== SIMULACRO_MINUTOS) campos.push("limite_minutos");
  if (modo === "completo" && b.limite_minutos !== null) campos.push("limite_minutos");

  for (const c of ["correctas", "incorrectas", "sin_responder"] as const) {
    if (!esEntero(b[c], 0, 500)) campos.push(c);
  }
  if (
    esEntero(b.total_preguntas, 1, 500) &&
    esEntero(b.correctas, 0, 500) && esEntero(b.incorrectas, 0, 500) && esEntero(b.sin_responder, 0, 500) &&
    (b.correctas as number) + (b.incorrectas as number) + (b.sin_responder as number) !== b.total_preguntas
  ) {
    campos.push("total_preguntas");
  }

  if (typeof b.porcentaje !== "number" || !Number.isFinite(b.porcentaje) || b.porcentaje < 0 || b.porcentaje > 100) {
    campos.push("porcentaje");
  }
  if (!esEntero(b.puntuacion_escala, 200, 800)) campos.push("puntuacion_escala");

  if (!esEntero(b.duracion_segundos, 0, 86_400)) {
    campos.push("duracion_segundos");
  } else if (modo === "simulacro_60min" && (b.duracion_segundos as number) > SIMULACRO_MINUTOS * 60) {
    campos.push("duracion_segundos");
  }

  const temas = b.desglose_temas;
  if (typeof temas !== "object" || temas === null || Array.isArray(temas)) {
    campos.push("desglose_temas");
  } else {
    const claves = Object.keys(temas as Record<string, unknown>);
    if (claves.length > MAX_TEMAS) campos.push("desglose_temas");
    for (const t of claves) {
      const v = (temas as Record<string, unknown>)[t];
      if (
        typeof v !== "object" || v === null ||
        !esEntero((v as Record<string, unknown>).n, 0, 500) ||
        !esEntero((v as Record<string, unknown>).ok, 0, 500)
      ) {
        campos.push("desglose_temas");
        break;
      }
    }
  }

  if (typeof b.idioma !== "string" || !IDIOMAS.has(b.idioma)) campos.push("idioma");
  if (typeof b.app_version !== "string" || b.app_version.length < 1 || b.app_version.length > APP_VERSION_MAX) {
    campos.push("app_version");
  }

  if (campos.length) return { ok: false, campos: [...new Set(campos)] };
  return { ok: true, value: b as unknown as AttemptInput };
}

