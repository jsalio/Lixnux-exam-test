import { assertEquals } from "jsr:@std/assert@1";
import {
  clientIp,
  corsHeaders,
  normalizeUserKey,
  validateBody,
} from "../record-attempt/validation.ts";

/** Intento válido de referencia; cada prueba lo modifica en un solo campo. */
function intentoValido(extra: Record<string, unknown> = {}) {
  return {
    client_attempt_id: "b3f1c0de-1111-4222-8333-444455556666",
    usuario_nombre: "Jorge Rodríguez",
    modo: "simulacro_60min",
    total_preguntas: 40,
    limite_minutos: 60,
    correctas: 30,
    incorrectas: 6,
    sin_responder: 4,
    porcentaje: 75.0,
    puntuacion_escala: 586,
    duracion_segundos: 2410,
    desglose_temas: { "101": { n: 7, ok: 4 } },
    idioma: "both",
    app_version: "1.0.0+bank145",
    ...extra,
  };
}

function req(headers: Record<string, string>): Request {
  return new Request("https://x.test/", { headers });
}

Deno.test("normalizeUserKey quita diacríticos y colapsa espacios", () => {
  assertEquals(normalizeUserKey("  Jorge  Rodríguez "), "jorge rodriguez");
  assertEquals(normalizeUserKey("ÑOÑO Ünïcode"), "nono unicode");
  assertEquals(normalizeUserKey("O'Brien-Smith"), "o'brien-smith");
  assertEquals(normalizeUserKey("   "), "");
});

Deno.test("clientIp toma el primer valor y descarta el puerto", () => {
  assertEquals(clientIp(req({ "x-forwarded-for": "203.0.113.7" })), "203.0.113.7");
  assertEquals(clientIp(req({ "x-forwarded-for": "203.0.113.7:44321" })), "203.0.113.7");
  assertEquals(clientIp(req({ "x-forwarded-for": "203.0.113.7, 70.41.3.18" })), "203.0.113.7");
  assertEquals(clientIp(req({ "x-forwarded-for": "[2001:db8::1]:443" })), "2001:db8::1");
  assertEquals(clientIp(req({ "x-forwarded-for": "2001:db8::1" })), "2001:db8::1");
  assertEquals(clientIp(req({ "x-real-ip": "198.51.100.4" })), "198.51.100.4");
});

Deno.test("clientIp devuelve null ante basura", () => {
  assertEquals(clientIp(req({})), null);
  assertEquals(clientIp(req({ "x-forwarded-for": "no-es-una-ip" })), null);
  assertEquals(clientIp(req({ "x-forwarded-for": "999.1.1.1" })), null);
  assertEquals(clientIp(req({ "x-forwarded-for": "   " })), null);
});

Deno.test("corsHeaders solo responde a orígenes permitidos", () => {
  assertEquals(corsHeaders("https://jsalio.github.io")?.["Access-Control-Allow-Origin"], "https://jsalio.github.io");
  assertEquals(corsHeaders("null")?.["Access-Control-Allow-Origin"], "null");
  assertEquals(corsHeaders("https://sitio-ajeno.example"), null);
  assertEquals(corsHeaders(""), null);
});

Deno.test("validateBody acepta un intento correcto", () => {
  const r = validateBody(intentoValido());
  assertEquals(r.ok, true);
});

Deno.test("validateBody rechaza campos desconocidos", () => {
  const r = validateBody(intentoValido({ ip: "1.2.3.4" }));
  assertEquals(r.ok, false);
  assertEquals(r.ok === false && r.campos.includes("ip"), true);
});

Deno.test("validateBody rechaza el modo sin mapear del cliente", () => {
  const r = validateBody(intentoValido({ modo: "sim" }));
  assertEquals(r.ok === false && r.campos.includes("modo"), true);
});

Deno.test("validateBody exige que los conteos sumen total_preguntas", () => {
  const r = validateBody(intentoValido({ sin_responder: 3 }));
  assertEquals(r.ok === false && r.campos.includes("total_preguntas"), true);
});

Deno.test("validateBody ata limite_minutos al modo", () => {
  assertEquals(
    validateBody(intentoValido({ modo: "completo", limite_minutos: 60, total_preguntas: 40 })).ok,
    false,
  );
  const r = validateBody(intentoValido({ limite_minutos: null }));
  assertEquals(r.ok === false && r.campos.includes("limite_minutos"), true);
});

Deno.test("validateBody rechaza duración por encima del límite del simulacro", () => {
  const r = validateBody(intentoValido({ duracion_segundos: 3601 }));
  assertEquals(r.ok === false && r.campos.includes("duracion_segundos"), true);
  assertEquals(validateBody(intentoValido({ duracion_segundos: 3600 })).ok, true);
});

Deno.test("validateBody valida uuid, nombre y desglose", () => {
  assertEquals(validateBody(intentoValido({ client_attempt_id: "no-uuid" })).ok, false);
  assertEquals(validateBody(intentoValido({ usuario_nombre: "J" })).ok, false);
  assertEquals(validateBody(intentoValido({ usuario_nombre: "x".repeat(81) })).ok, false);
  assertEquals(validateBody(intentoValido({ desglose_temas: { "101": { n: "7", ok: 4 } } })).ok, false);
  assertEquals(validateBody(intentoValido({ desglose_temas: [] })).ok, false);
});

Deno.test("validateBody rechaza rangos imposibles", () => {
  assertEquals(validateBody(intentoValido({ porcentaje: 101 })).ok, false);
  assertEquals(validateBody(intentoValido({ puntuacion_escala: 199 })).ok, false);
  assertEquals(validateBody(intentoValido({ idioma: "fr" })).ok, false);
  assertEquals(validateBody(intentoValido({ total_preguntas: 0 })).ok, false);
});
