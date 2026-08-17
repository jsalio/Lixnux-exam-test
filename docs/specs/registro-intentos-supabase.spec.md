# SDD Spec: Registro de intentos del examen en Supabase

**Feature**: Persistir en Supabase cada intento finalizado del examen LPI 010-160 con nombre del usuario, IP, número de intento, nota y modo de examen.
**User story**: "Monta una base de datos en Supabase para esta aplicación que se registre el nombre del usuario, su IP, el # de intento con su nota, y si es la versión de prueba de 60 o la 100."
**Estado**: Draft
**Fecha**: 2026-08-17
**Aplicación objetivo**: `lpi-linux-essentials/index.html` (banco de 145 preguntas, 2 modos)
**Pipeline siguiente**: /impact → /arch → /tdd-plan → /why

---

## Decisiones fijas

| Decisión | Valor | Motivo |
|---|---|---|
| Backend de datos | Supabase (Postgres + Edge Functions) | Pedido explícito del usuario |
| Identificación de "versión" | `modo ∈ {'simulacro_60min','completo'}` + `total_preguntas` + `limite_minutos` | Los dos modos ya existentes de la app: simulacro (40 preguntas / 60 min) y banco completo (145 preguntas / sin límite). No se altera el diseño del examen |
| Captura del nombre | Campo obligatorio en la pantalla de inicio; sin nombre válido no arranca el intento | Garantiza que toda fila tenga autor; se recuerda en `localStorage` para intentos siguientes |
| Obtención de la IP | Edge Function de Supabase que lee la IP de la petición y hace el insert | El cliente nunca envía ni puede falsificar la IP |
| Numeración del intento | `intento_num` secuencial por usuario, asignado en la BD por trigger | Consistente aunque el usuario cambie de navegador o borre datos locales |
| Credenciales | `anon key` en el HTML (pública); `service_role` **solo** en el entorno de la Edge Function | La anon key sin políticas RLS no da acceso a datos |
| Escritura desde el cliente | Prohibida directamente contra la tabla; todo pasa por la Edge Function | Un único punto de validación y de asignación de IP |
| Fallo de red | Nunca bloquea el resultado local; el intento se encola y se reintenta | El valor principal de la app es el examen, no la telemetría |
| Idempotencia | `client_attempt_id` (UUID generado en el navegador) con constraint `unique` | Reintentos y dobles clics no duplican filas |

---

## Modelo de datos

Entidad **nueva**. Una sola tabla; el desglose por tema se guarda como `jsonb` porque siempre se lee junto con la fila y nunca se consulta por sus claves individualmente.

```sql
-- supabase/migrations/0001_exam_attempts.sql

create table public.exam_attempts (
  id                 bigint generated always as identity primary key,
  created_at         timestamptz not null default now(),

  -- identidad
  usuario_nombre     text        not null,
  usuario_key        text        not null,          -- nombre normalizado (agrupación)
  intento_num        integer     not null,          -- 1,2,3... por usuario_key

  -- versión del examen
  modo               text        not null,
  total_preguntas    smallint    not null,
  limite_minutos     smallint,                      -- 60 en simulacro, NULL en completo

  -- resultado
  correctas          smallint    not null,
  incorrectas        smallint    not null,
  sin_responder      smallint    not null,
  porcentaje         numeric(5,2) not null,
  puntuacion_escala  smallint    not null,          -- equivalencia aproximada 200-800
  aprobado           boolean     not null,
  duracion_segundos  integer     not null,
  desglose_temas     jsonb       not null default '{}'::jsonb,

  -- contexto
  ip                 inet,                          -- NULL solo si la cabecera no llegó
  user_agent         text,
  idioma             text        not null default 'both',
  app_version        text        not null,
  client_attempt_id  uuid        not null,

  constraint exam_attempts_nombre_ck
    check (length(btrim(usuario_nombre)) between 2 and 80),
  constraint exam_attempts_key_ck
    check (usuario_key = btrim(usuario_key) and length(usuario_key) between 2 and 80),
  constraint exam_attempts_intento_ck    check (intento_num > 0),
  constraint exam_attempts_modo_ck       check (modo in ('simulacro_60min','completo')),
  constraint exam_attempts_idioma_ck     check (idioma in ('both','es','en')),
  constraint exam_attempts_total_ck      check (total_preguntas between 1 and 500),
  constraint exam_attempts_conteos_ck
    check (correctas >= 0 and incorrectas >= 0 and sin_responder >= 0
           and correctas + incorrectas + sin_responder = total_preguntas),
  constraint exam_attempts_pct_ck        check (porcentaje between 0 and 100),
  constraint exam_attempts_escala_ck     check (puntuacion_escala between 200 and 800),
  constraint exam_attempts_aprobado_ck   check (aprobado = (porcentaje >= 65)),
  constraint exam_attempts_duracion_ck   check (duracion_segundos >= 0),
  constraint exam_attempts_limite_ck
    check ((modo = 'simulacro_60min' and limite_minutos = 60)
        or (modo = 'completo'        and limite_minutos is null)),
  constraint exam_attempts_duracion_limite_ck
    check (limite_minutos is null or duracion_segundos <= limite_minutos * 60),
  constraint exam_attempts_desglose_ck   check (jsonb_typeof(desglose_temas) = 'object'),

  constraint exam_attempts_usuario_intento_uk unique (usuario_key, intento_num),
  constraint exam_attempts_client_uk          unique (client_attempt_id)
);

create index exam_attempts_usuario_idx on public.exam_attempts (usuario_key, intento_num desc);
create index exam_attempts_created_idx  on public.exam_attempts (created_at desc);
create index exam_attempts_modo_idx     on public.exam_attempts (modo, created_at desc);

-- RLS activo y SIN políticas: anon/authenticated no pueden leer ni escribir.
-- Solo service_role (Edge Function) accede a la tabla.
alter table public.exam_attempts enable row level security;

-- Asignación del número de intento, serializada por usuario para evitar carreras.
create or replace function public.exam_attempts_set_intento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.usuario_key));
  select coalesce(max(intento_num), 0) + 1
    into new.intento_num
    from public.exam_attempts
   where usuario_key = new.usuario_key;
  return new;
end;
$$;

create trigger exam_attempts_set_intento_trg
before insert on public.exam_attempts
for each row execute function public.exam_attempts_set_intento();
```

**Formato de `desglose_temas`** — clave = tema oficial, valor = preguntas del intento y aciertos:

```json
{ "101": {"n": 7, "ok": 5},
  "102": {"n": 8, "ok": 8},
  "103": {"n": 10, "ok": 6},
  "104": {"n": 8, "ok": 7},
  "105": {"n": 7, "ok": 4} }
```

**Normalización de `usuario_key`** (la calcula la Edge Function, no la BD, para no depender de funciones no inmutables):
`trim` → colapsar espacios internos a uno → minúsculas → NFD y eliminar diacríticos → conservar solo letras, dígitos, espacio, guion y apóstrofo.
Ejemplo: `"  Jorge  Rodríguez "` → `"jorge rodriguez"`.

### Invariantes del modelo

1. `correctas + incorrectas + sin_responder = total_preguntas` en toda fila.
2. `aprobado` es siempre exactamente `porcentaje >= 65`; nunca se envía desde el cliente como dato independiente sin validarlo.
3. `intento_num` es único y contiguo desde 1 para cada `usuario_key`; lo asigna la BD, nunca el cliente.
4. `modo = 'simulacro_60min'` implica `limite_minutos = 60`; `modo = 'completo'` implica `limite_minutos IS NULL`.
5. `duracion_segundos` nunca excede el límite del modo cuando existe límite.
6. `client_attempt_id` identifica un intento del navegador de forma única: reintentar el envío jamás crea una segunda fila.
7. La `ip` la escribe exclusivamente el servidor; cualquier campo `ip` presente en el body se ignora.
8. Ninguna clave `service_role` aparece en el HTML ni en ningún archivo servido al navegador.
9. Un intento se registra solo cuando el examen ha finalizado (`S.finished = true`); los intentos abandonados no llegan a la BD.

---

## Contratos de API

Un único endpoint público. La tabla no se expone vía PostREST (RLS sin políticas).

### `POST /functions/v1/record-attempt`

- **Headers**
  - `Content-Type: application/json`
  - `apikey: <SUPABASE_ANON_KEY>`
  - `Authorization: Bearer <SUPABASE_ANON_KEY>`
- **Body**

```jsonc
{
  "client_attempt_id": "b3f1c0de-1111-4222-8333-444455556666",  // uuid v4
  "usuario_nombre":    "Jorge Rodríguez",                        // 2..80 tras trim
  "modo":              "simulacro_60min",                        // | "completo"
  "total_preguntas":   40,
  "limite_minutos":    60,                                       // null si completo
  "correctas":         30,
  "incorrectas":       6,
  "sin_responder":     4,
  "porcentaje":        75.0,
  "puntuacion_escala": 586,
  "duracion_segundos": 2410,
  "desglose_temas":    { "101": {"n":7,"ok":4} },
  "idioma":            "both",                                   // both | es | en
  "app_version":       "1.0.0+bank145"
}
```

- **Response 201 Created**

```json
{ "ok": true, "id": 42, "intento_num": 3, "duplicado": false }
```

- **Response 200 OK** (mismo `client_attempt_id` ya registrado; se devuelve la fila existente)

```json
{ "ok": true, "id": 42, "intento_num": 3, "duplicado": true }
```

- **EFECTO**: inserta una fila en `public.exam_attempts` con `ip` y `user_agent` tomados de la petición y `intento_num` asignado por el trigger. Sin efectos secundarios adicionales (no envía correos, no borra nada).
- **ERRORES**

| Código | Cuerpo | Cuándo |
|---|---|---|
| 400 | `{"ok":false,"error":"invalid_payload","campos":["porcentaje"]}` | Falta un campo, tipo incorrecto, fuera de rango, o los conteos no suman `total_preguntas` |
| 401 | `{"ok":false,"error":"unauthorized"}` | Falta o es inválida la `apikey` / el Bearer |
| 405 | `{"ok":false,"error":"method_not_allowed"}` | Método distinto de POST (excepto OPTIONS del preflight) |
| 429 | `{"ok":false,"error":"rate_limited","reintentar_en":1800}` | Más de 60 intentos registrados desde la misma IP en la última hora |
| 500 | `{"ok":false,"error":"db_error"}` | Fallo de inserción no previsto; el detalle se registra en el log de la función, nunca en la respuesta |

- **CORS**: `Access-Control-Allow-Origin: *`, métodos `POST, OPTIONS`, cabeceras `authorization, apikey, content-type`. Necesario porque la app puede abrirse desde `file://` (origen `null`).
- **`verify_jwt`**: activado (valor por defecto). La anon key es un JWT válido y basta como credencial; no se acepta tráfico sin ella.

---

## Generación / lógica especial

### Orden de operaciones de la Edge Function

1. Responder al preflight `OPTIONS`.
2. Validar método y credenciales.
3. Parsear y validar el body campo por campo (400 con la lista de campos inválidos).
4. Derivar en el servidor, ignorando lo que venga del cliente:
   - `ip` ← primer valor de `x-forwarded-for` (fallback: `x-real-ip`; si no hay ninguno → `null`).
   - `user_agent` ← cabecera `user-agent` truncada a 300 caracteres.
   - `usuario_key` ← normalización del nombre.
   - `aprobado` ← `porcentaje >= 65`.
5. Comprobar el rate limit por IP (`count(*)` en la última hora).
6. Insertar con `service_role`.
   - Si el error es `23505` sobre `exam_attempts_client_uk` → leer la fila existente y responder 200 con `duplicado: true`.
   - Si el error es `23505` sobre `exam_attempts_usuario_intento_uk` (carrera extrema) → reintentar el insert hasta 3 veces.
7. Responder con `id` e `intento_num`.

### Cola de reenvío en el cliente

- Clave `lpi-010-160-cola` en `localStorage`: array de payloads pendientes, máximo 20 (FIFO, se descarta el más antiguo).
- Se intenta vaciar la cola al cargar la app y tras cada envío manual.
- Un payload se elimina de la cola con respuesta 2xx o con un 400 (payload irreparable: se descarta y se registra en consola). Los 429/500/errores de red lo mantienen en cola.

---

## Principios SOLID aplicables

| Principio | Aplicación concreta | Riesgo si se viola |
|---|---|---|
| SRP | `finish()` calcula y muestra el resultado; no sabe de HTTP. El envío vive en un módulo aparte: `buildAttemptPayload(S)` (pura), `recordAttempt(payload)` (I/O), `flushQueue()` | Una función que califica, pinta y hace fetch se vuelve intestable y un fallo de red rompe el render del resultado |
| OCP | El payload se construye en una sola función pura a partir del estado del intento; añadir un campo nuevo no obliga a tocar el render ni la máquina de estados | Campos nuevos dispersos por `renderResult` y por el fetch, con dos fuentes de verdad |
| DIP | La UI depende de la interfaz `attemptSink.record(payload)`; hay dos implementaciones: `remoteSink` (Edge Function) y `noopSink` (cuando no hay `SUPABASE_URL` configurado) | La app deja de funcionar como archivo local suelto si el código de UI llama a `fetch` directamente |
| ISP | La Edge Function expone una sola operación con un contrato mínimo, no un CRUD genérico sobre la tabla | Un endpoint genérico obliga al cliente a conocer el esquema y abre superficie de escritura |

LSP no aplica: no hay jerarquías de tipos en este feature.

---

## Documentación esperada de funciones públicas

Cliente (JSDoc, en `index.html`):

```js
/**
 * Construye el registro que se enviará a Supabase a partir de un intento finalizado.
 * No realiza ninguna operación de red y no modifica el estado recibido.
 *
 * @param {object} attempt  Intento finalizado (S), con items respondidos y elapsedMs fijado.
 * @param {string} nombre   Nombre del usuario tal como lo escribió, sin normalizar.
 * @returns {object} Payload listo para POST /functions/v1/record-attempt.
 * @throws {Error} Si el intento no está finalizado o no tiene preguntas.
 */
function buildAttemptPayload(attempt, nombre) {}

/**
 * Registra un intento en Supabase, con idempotencia por client_attempt_id.
 *
 * @param {object} payload  Registro devuelto por buildAttemptPayload.
 * @returns {Promise<{ok:boolean, intento_num?:number, encolado?:boolean, error?:string}>}
 *          intento_num viene de la BD; encolado indica que el envío quedó pendiente de reintento.
 *          Nunca lanza: los fallos se comunican en el valor de retorno para no romper la UI.
 */
async function recordAttempt(payload) {}

/**
 * Reintenta los envíos pendientes en localStorage, en orden de llegada.
 *
 * @returns {Promise<{enviados:number, pendientes:number}>} Resumen del vaciado de la cola.
 */
async function flushAttemptQueue() {}

/**
 * Normaliza un nombre para agrupar los intentos de la misma persona.
 * Recorta, colapsa espacios, pasa a minúsculas y elimina diacríticos.
 *
 * @param {string} nombre  Nombre escrito por el usuario.
 * @returns {string} Clave de agrupación estable; cadena vacía si el nombre no es válido.
 */
function normalizeUserKey(nombre) {}
```

Edge Function (TSDoc, `supabase/functions/record-attempt/index.ts`):

```ts
/**
 * Valida el cuerpo de la petición de registro de intento.
 *
 * @param body - JSON recibido, de estructura no confiable.
 * @returns Payload validado y tipado, o la lista de campos que no superaron la validación.
 */
function validateBody(body: unknown): { ok: true; value: AttemptInput } | { ok: false; campos: string[] };

/**
 * Extrae la IP del cliente de las cabeceras de la petición.
 *
 * @param req - Petición entrante; se leen x-forwarded-for y x-real-ip en ese orden.
 * @returns IP en formato textual, o null si ninguna cabecera la aporta.
 */
function clientIp(req: Request): string | null;
```

---

## Señales de Clean Code a respetar

- [ ] Nombres de variables y funciones expresan intención (`buildAttemptPayload`, no `getData`)
- [ ] Funciones que hacen una sola cosa: construir, enviar, encolar y pintar están separadas
- [ ] Sin números mágicos: `PASS_PCT`, `MAX_QUEUE = 20`, `RATE_LIMIT_HOUR = 60`, `NOMBRE_MIN = 2`, `NOMBRE_MAX = 80` como constantes nombradas
- [ ] Manejo explícito de errores: cada rama de fallo del envío produce un estado visible en la UI; nada se silencia con un `catch {}` vacío
- [ ] La configuración de Supabase vive en un único bloque de constantes al inicio del script, no repartida por el código
- [ ] Cero duplicación del cálculo del resultado: `renderResult` y `buildAttemptPayload` consumen la misma función de agregación (`summarizeAttempt(S)`)
- [ ] La validación del nombre está en una sola función usada por el formulario y por el envío

---

## Máquina de estados del frontend

### Formulario de nombre (pantalla de inicio)

| Estado | Descripción | Transición |
|---|---|---|
| `nombre_vacio` | Botones de modo deshabilitados, mensaje de ayuda | input válido → `nombre_valido` |
| `nombre_invalido` | Menos de 2 o más de 80 caracteres útiles; borde de error | corrección → `nombre_valido` |
| `nombre_valido` | Botones de modo habilitados; el nombre se guarda en `localStorage` | click en un modo → arranca el intento |

### Envío del intento (pantalla de resultado)

Estados: `sin_enviar` → `enviando` → `guardado` | `fallido` → `en_cola`.

| # | Transición | Disparador |
|---|---|---|
| 1 | `sin_enviar` → `enviando` | `finish()` termina de calcular el resultado |
| 2 | `enviando` → `guardado` | Respuesta 2xx; se muestra "Intento #N registrado" |
| 3 | `enviando` → `fallido` | Error de red, 429 o 5xx |
| 4 | `fallido` → `enviando` | El usuario pulsa "Reintentar" |
| 5 | `fallido` → `en_cola` | Automático: el payload queda en `localStorage` |
| 6 | `en_cola` → `enviando` | Al abrir la app de nuevo (`flushAttemptQueue`) |

**Estado optimista**: sí. El resultado completo (nota, desglose, revisión) se pinta de inmediato y el estado del envío se muestra como una línea secundaria dentro del bloque de veredicto. Un 400 muestra "no se pudo registrar" sin ofrecer reintento.

---

## Invariantes del sistema

| # | Invariante |
|---|---|
| 1 | Un fallo de Supabase nunca impide ver, revisar o imprimir el resultado del examen |
| 2 | La app sigue funcionando al 100 % sin configuración de Supabase (`noopSink`): el registro es una capa opcional |
| 3 | El navegador nunca decide la IP ni el número de intento |
| 4 | Un mismo intento finalizado produce exactamente una fila, cuantos reintentos haga el cliente |
| 5 | No se envía nada a la red antes de que el usuario finalice el intento |
| 6 | La respuesta de la API nunca incluye datos de otros usuarios |
| 7 | El contenido de las respuestas pregunta por pregunta no sale del navegador; solo agregados |
| 8 | La pantalla de inicio informa, antes de empezar, de que se registrarán nombre, IP y resultado |

---

## Impacto en archivos existentes

Tabla preliminar; el detalle se produce en `/impact`.

| Archivo | Cambio | Capa |
|---|---|---|
| `lpi-linux-essentials/index.html` | modificado: campo de nombre + aviso en el inicio, estado de envío en el resultado, módulo de telemetría, constantes de Supabase | UI + infraestructura cliente |
| `supabase/migrations/0001_exam_attempts.sql` | NUEVO: tabla, constraints, índices, RLS, trigger | persistencia |
| `supabase/functions/record-attempt/index.ts` | NUEVO: validación, IP, rate limit, insert | backend |
| `supabase/functions/record-attempt/deno.json` | NUEVO: dependencias de la función | backend |
| `supabase/config.toml` | NUEVO: configuración del proyecto local | infraestructura |
| `docs/specs/registro-intentos-supabase.spec.md` | NUEVO: este contrato | documentación |
| `index.html` (app antigua en la raíz) | sin cambios | — |

Funciones concretas que se tocan en `index.html`: `showStart()` (validación del nombre), `newAttempt()` (bloqueo si no hay nombre), `finish()` (disparar el envío), `renderResult()` (línea de estado del envío) y el bloque `init()` (vaciado de la cola).

---

## Fuera de scope (explícito)

- Panel o vista de consulta de resultados (ranking, histórico por usuario, export CSV). La tabla queda cerrada a `service_role`; leer datos requiere el panel de Supabase o un feature aparte.
- Autenticación real de usuarios: el nombre es declarativo y no se verifica; dos personas con el mismo nombre comparten `usuario_key`.
- Edición o borrado de intentos desde la app.
- Guardar la respuesta elegida en cada pregunta (solo se guardan agregados y el desglose por tema).
- Purga automática de datos por retención (se recomienda un job `pg_cron` a 12 meses, pero no entra en este spec).
- Geolocalización o enriquecimiento de la IP.
- Cambiar el diseño del examen: los modos siguen siendo 40 preguntas / 60 min y 145 preguntas / sin límite.
- Tests end-to-end contra un proyecto Supabase real; el plan de `/tdd-plan` cubrirá validación y construcción del payload con dobles.

**Riesgo aceptado**: el nombre y la IP son datos personales. Este spec exige el aviso visible (invariante 8), pero no incluye consentimiento granular, derecho de supresión ni cifrado en reposo más allá del que ofrece Supabase por defecto. Si el examen se aplica a terceros, eso debe tratarse en un spec propio.

---

## Próximos pasos del pipeline

1. `/impact` — analizar side-effects en `index.html` (orden de `finish`, `beforeunload` con cola pendiente, arranque sin configuración) y en la BD.
2. `/arch` — confirmar la separación cliente/Edge Function y dónde vive el módulo de telemetría dentro de un archivo único.
3. `/tdd-plan` — plan Red/Green/Refactor: validación de payload, normalización de `usuario_key`, idempotencia, asignación de `intento_num` bajo concurrencia, cola offline.
4. `/why` — documentar el motivo de cada cambio antes de commitear.
