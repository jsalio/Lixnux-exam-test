# SDD Spec: Estadísticas de preparación por temario

**Feature**: Agregar todos los intentos finalizados del usuario y ordenar los cinco temas oficiales por impacto de estudio, para que sepa en qué concentrarse y qué basta con repasar por encima.
**User story**: "Hay que incluir una estadística para los exámenes de práctica: una sumatoria de los intentos para ver qué tan bien está el usuario preparado, por temario, y así concentrarse en estudiar los temas que le hacen falta y repasar los demás por encima."
**Estado**: Draft
**Fecha**: 2026-08-18
**Aplicación objetivo**: `lpi_practice_exam/index.html` (banco de 145 preguntas, temas 101-105, dos modos)
**Pipeline siguiente**: /impact → /arch → /tdd-plan → /why

---

## Decisiones fijas

| Decisión | Valor | Motivo |
|---|---|---|
| Origen de los datos | Solo `localStorage`; ninguna lectura desde Supabase | Las estadísticas no necesitan servidor. Leer de `telemetry.exam_attempts` exigiría abrir un camino de lectura sobre datos con nombre no autenticado, deshaciendo el modelo de seguridad de [registro-intentos-supabase](registro-intentos-supabase.spec.md) |
| Criterio de ordenación | `impacto_t = brecha_t × peso_t`, descendente | Un porcentaje por tema dice dónde vas mal; el impacto dice dónde rinde más estudiar. El tema 103 pesa 25 % del examen y el 101 un 17,5 %: la misma carencia no cuesta lo mismo |
| Dominio por tema | Media ponderada por recencia con encogimiento bayesiano | Decisión del usuario: refleja el estado actual y no arrastra los errores de los primeros intentos |
| Factor de olvido | `0.85 ^ (intentos de antigüedad)` — vida media ≈ 4,3 intentos | Con 5 intentos por sesión de estudio, lo de hace dos semanas pesa la mitad |
| Encogimiento | `K = 5`, `P0 = 0.5` | Evita que 2 de 2 aciertos aparezcan como 100 % de dominio y manden a repasar el tema equivocado |
| Persistencia | **Una sola clave**: `lpi-010-160-historial` | Ver "Fuente única de verdad". La proyección por pregunta se recalcula al vuelo, no se persiste |
| Ubicación de la UI | Cuarta pantalla (`screen-stats`) dentro del archivo único | Reutiliza estilos, `TOPICS`, el banco `Q` y los helpers existentes; la portada del sitio no cambia |
| Control de datos | Borrar + exportar/importar JSON | Resuelve el cambio de navegador sin servidor ni token de dispositivo, que era la única ventaja real de leer desde Supabase |
| Momento del registro | En `finish()`, después de pintar el resultado | El histórico jamás retrasa ni condiciona lo que el usuario vino a ver |
| Privacidad | El detalle por pregunta nunca sale del navegador | Mantiene el invariante 7 del spec de Supabase. La exportación es una descarga local que inicia el usuario |

### Fuente única de verdad

El diseño exploratorio contemplaba dos claves: el historial de intentos y un acumulado por
pregunta. Al concretar la importación aparece el problema: dos estados persistidos que pueden
divergir, y contadores por pregunta que se duplicarían al importar dos veces el mismo archivo.

Se resuelve guardando el resultado por pregunta **dentro de cada intento** del historial y
recalculando la proyección por pregunta en memoria. Consecuencias: la importación es idempotente
por `cid`, el borrado es una sola operación, y no existe la clase de bug "las dos claves no
cuadran". Coste: ~1,2 KB por intento del banco completo, ~65 KB en el tope de 50 intentos, frente
a los ~5 MB que ofrece `localStorage`. El recálculo sobre 50 × 145 resultados es de milisegundos y
solo ocurre al abrir la pantalla.

---

## Modelo de datos

Entidad **nueva**, únicamente en el navegador. Clave `lpi-010-160-historial`:

```jsonc
{
  "v": 1,                                  // versión del formato, para migraciones futuras
  "intentos": [                            // orden cronológico ascendente; máx. 50, FIFO
    {
      "cid":        "b3f1c0de-1111-4222-8333-444455556666",  // mismo uuid que usa el registro remoto
      "ts":         1755530000000,         // Date.now() al finalizar
      "modo":       "sim",                 // 'sim' | 'full' (valores del código, no del contrato remoto)
      "total":      40,
      "ok":         26,
      "ko":         3,
      "na":         11,                    // sin responder
      "pct":        65.0,
      "duracion_s": 3600,
      "res": {                             // resultado por pregunta: 'o' acierto, 'x' fallo, '-' en blanco
        "101": "o", "104": "x", "207": "-", "301": "o"
      }
    }
  ]
}
```

Notas de formato:

- `res` contiene **solo** las preguntas de ese intento (40 en simulacro, 145 en banco completo).
  Nunca guarda la opción elegida ni el texto escrito: solo el veredicto.
- El tema y el tipo de cada pregunta no se duplican aquí; se obtienen de `byId(id)` al calcular.
- `pct` es redundante con `ok/total` y se guarda para poder pintar la tendencia sin recorrer `res`.

### Proyección en memoria (no persistida)

```jsonc
{
  "porTema": {
    "103": {
      "dominio":     0.58,   // ponderado por recencia + encogimiento, en [0,1]
      "nCrudo":      96,     // preguntas del tema vistas en todo el historial (conteo real)
      "okCrudo":     52,
      "brecha":      0.07,
      "peso":        0.25,
      "impacto":     0.0175,
      "primeraVez":  0.44,   // acierto en el estreno de cada pregunta del tema
      "nPrimeraVez": 38,
      "tendencia":   "sube", // 'sube' | 'baja' | 'estable' | 'sin_datos'
      "blancos":     14,
      "fallos":      30,
      "estado":      "estudiar"   // 'estudiar' | 'reforzar' | 'repasar' | 'sin_datos'
    }
  },
  "porTipo":   { "single": 0.71, "multi": 0.48, "fill": 0.39 },
  "rebeldes":  [ { "id": 301, "topic": 103, "vistas": 4, "aciertos": 0 } ],
  "resumen":   { "intentos": 8, "preguntasVistas": 412, "notaEstimada": 71.4,
                 "escala": 556, "veredicto": "aprobado", "memorizando": false }
}
```

### Fórmulas

Sea `i` el índice de antigüedad del intento (`i = 0` el más reciente) y `t` el tema:

```
peso_i     = FACTOR_OLVIDO ^ i                     FACTOR_OLVIDO = 0.85
A_t        = Σ_i  peso_i · aciertos_{i,t}
N_t        = Σ_i  peso_i · preguntas_{i,t}
dominio_t  = (A_t + K · P0) / (N_t + K)            K = 5, P0 = 0.5

peso_t     = SIM_PLAN[t] / 40                      → 0.175, 0.20, 0.25, 0.20, 0.175
brecha_t   = max(0, UMBRAL − dominio_t)            UMBRAL = PASS_PCT / 100 = 0.65
impacto_t  = brecha_t × peso_t                     ← criterio de orden, descendente

notaEstimada = 100 × Σ_t (peso_t · dominio_t)
escala       = scaled(notaEstimada)                 función ya existente
```

Desempate al ordenar: mayor `impacto`, luego menor `dominio`, luego menor número de tema.

**Semáforo** (`estado`): `dominio < 0.65` → estudiar · `0.65 ≤ dominio < 0.80` → reforzar ·
`dominio ≥ 0.80` → repasar · `nCrudo = 0` → sin datos.

**Primera vez**: para cada pregunta vista al menos una vez, si acertó en su aparición más antigua.
Es un conteo directo, sin ponderar ni encoger. Sirve de contraste honesto frente al dominio.

**Señal de memorización**: `dominio_t − primeraVez_t > 0.15` con media de apariciones por pregunta
del tema > 2. Global: la misma comparación sobre el agregado.

**Tendencia**: media simple de acierto del tema en los 3 intentos más recientes que contengan
preguntas suyas, frente a los 3 anteriores. `Δ > +5 pp` sube · `Δ < −5 pp` baja · resto estable.
Con menos de 4 intentos con ese tema: `sin_datos`. Se calcula aparte del dominio porque el dominio
ya lleva la recencia dentro y no podría revelar la dirección del cambio.

**Preguntas rebeldes**: `vistas ≥ 2 && aciertos = 0`, o las dos últimas apariciones fallidas.
Máximo 10, orden por `vistas` descendente y luego por tema.

### Invariantes del modelo

1. Solo entran intentos finalizados (`S.finished = true`); los abandonados no se registran.
2. Un `cid` aparece como máximo una vez: importar el mismo archivo dos veces no altera nada.
3. `dominio_t ∈ [0,1]`. Con `N_t = 0` vale `P0` y el tema se marca `sin_datos`, nunca se ordena por impacto.
4. `nCrudo` y `okCrudo` son conteos reales sin ponderar; `dominio` es una media ponderada.
   **El par nunca se presenta como fracción**: mostrar "58 % · 96 preguntas", jamás "52/96 = 58 %".
5. Las preguntas cuyo `id` ya no existe en el banco se ignoran al calcular, pero no se borran del
   historial: un cambio del banco no destruye datos.
6. El historial nunca supera `MAX_HISTORIAL = 50` intentos; se descarta el más antiguo (FIFO).
7. Ningún resultado por pregunta viaja a la red. La exportación es una descarga iniciada por el usuario.
8. Un fallo al leer, escribir o parsear el historial nunca impide usar el examen: la pantalla de
   estadísticas degrada a `sin_datos` y el resto de la app no se entera.

---

## Contratos de API

No hay red. Los contratos son las funciones públicas del módulo.

### `recordAttemptStats(attempt)`

- **Params**: `attempt` — intento finalizado (`S`), con `cid`, `mode`, `elapsedMs` e `items`.
- **Response**: `void`.
- **EFECTO**: añade una entrada al historial en `localStorage`, aplicando el tope FIFO. Si el `cid`
  ya está registrado no hace nada (reentrada segura si `finish()` se invocara dos veces).
- **ERRORES**: ninguno propagado. Cuota agotada o `localStorage` inaccesible se registran en consola
  y se ignoran.

### `computeStats(historial)`

- **Params**: `historial` — objeto del historial ya parseado.
- **Response**: la proyección descrita arriba (`porTema`, `porTipo`, `rebeldes`, `resumen`).
- **EFECTO**: ninguno. Función pura: no lee `localStorage` ni toca el DOM.
- **ERRORES**: con historial vacío devuelve la proyección con `resumen.intentos = 0` y todos los
  temas en `sin_datos`. Nunca lanza.

### `exportProgress()`

- **Params**: ninguno.
- **Response**: `void`.
- **EFECTO**: descarga `lpi-progreso-<AAAAMMDD>.json` con el historial íntegro mediante un `Blob`
  y un enlace temporal.
- **ERRORES**: si no hay intentos, no descarga nada y avisa en la UI.

### `importProgress(texto)`

- **Params**: `texto` — contenido del archivo elegido por el usuario.
- **Response**: `{ ok: boolean, importados: number, ignorados: number, error?: string }`.
- **EFECTO**: fusiona los intentos por `cid` (unión, sin duplicar), reordena por `ts` y aplica el
  tope FIFO. Los intentos ya presentes cuentan como `ignorados`.
- **ERRORES**: JSON inválido, `v` desconocida o estructura que no valida → `ok: false` con `error`,
  y **el historial existente no se toca**.

### `clearProgress()`

- **Params**: ninguno.
- **Response**: `void`.
- **EFECTO**: elimina la clave del historial. No toca el intento en curso, ni el idioma, ni el
  nombre, ni la cola de envío a Supabase.
- **ERRORES**: ninguno.

---

## Generación / lógica especial

### Orden de operaciones al finalizar un intento

1. `finish()` fija `S.finished` y `S.elapsedMs`, y llama a `renderResult()`.
2. `recordAttemptStats(S)` — síncrono, escribe en `localStorage`.
3. `sendCurrentAttempt()` — el envío remoto, que ya existe.

El histórico va **antes** que la red y **después** del render: es local y no puede fallar hacia
fuera, pero tampoco debe retrasar lo que el usuario está esperando ver.

### Recálculo

`computeStats` se ejecuta al abrir la pantalla de estadísticas y tras importar o borrar. No se
cachea: con el tope de 50 intentos el coste es despreciable y una caché volvería a introducir el
problema de los dos estados que pueden divergir.

### Validación al importar

Se acepta el archivo solo si: es JSON, `v === 1`, `intentos` es un array, y cada entrada tiene
`cid` con forma de UUID, `ts` numérico, `modo` en `{'sim','full'}`, contadores enteros no negativos
que suman `total`, y `res` un objeto cuyos valores son `'o' | 'x' | '-'`. Las entradas que no
validan se descartan una a una y se cuentan en `ignorados`; una sola entrada corrupta no invalida
el archivo entero.

---

## Principios SOLID aplicables

| Principio | Aplicación concreta | Riesgo si se viola |
|---|---|---|
| SRP | Tres responsabilidades separadas: persistencia (`loadHistory`/`saveHistory`), cálculo (`computeStats`, pura) y presentación (`renderStats`) | Un cálculo que lee `localStorage` y pinta a la vez es intestable: haría falta un DOM y un navegador para verificar una fórmula |
| OCP | Añadir una métrica nueva significa añadir un campo a la proyección y una columna al render; las fórmulas existentes no se tocan | Métricas calculadas dentro del bucle de render, imposibles de reutilizar en la práctica dirigida que vendrá después |
| DIP | `renderStats` consume el objeto que devuelve `computeStats`, no `localStorage` | La pantalla dejaría de funcionar con datos importados o de prueba, y no se podría verificar sin manipular el almacenamiento del navegador |

LSP e ISP no aplican: no hay jerarquías de tipos ni interfaces con varios consumidores.

---

## Documentación esperada de funciones públicas

```js
/**
 * Registra un intento finalizado en el historial local.
 * Reentrante: si el cid ya está en el historial, no hace nada.
 *
 * @param {object} attempt  Intento finalizado (S), con cid, mode, elapsedMs e items.
 * @returns {void} Los fallos de almacenamiento se registran en consola y no se propagan.
 */
function recordAttemptStats(attempt) {}

/**
 * Calcula el estado de preparación a partir del historial completo.
 * Función pura: no lee almacenamiento, no toca el DOM y no modifica el argumento.
 *
 * @param {object} historial  Historial ya parseado, tal como se guarda en localStorage.
 * @returns {object} Proyección con porTema, porTipo, rebeldes y resumen. Con historial
 *                   vacío devuelve la proyección neutra, nunca lanza.
 */
function computeStats(historial) {}

/**
 * Dominio de un tema: proporción de acierto ponderada por recencia y encogida hacia 0.5
 * para que las muestras pequeñas no parezcan certezas.
 *
 * @param {Array<{peso:number, ok:number, n:number}>} muestras  Una por intento con preguntas del tema.
 * @returns {number} Valor en [0,1]. Devuelve P0 si no hay ninguna muestra.
 */
function topicMastery(muestras) {}

/**
 * Descarga el historial como archivo JSON para trasladarlo a otro navegador.
 *
 * @returns {void} No descarga nada si el historial está vacío.
 */
function exportProgress() {}

/**
 * Fusiona un historial exportado con el actual, sin duplicar intentos.
 *
 * @param {string} texto  Contenido del archivo elegido por el usuario.
 * @returns {{ok:boolean, importados:number, ignorados:number, error?:string}}
 *          Si ok es false, el historial existente queda intacto.
 */
function importProgress(texto) {}

/**
 * Borra todas las estadísticas locales. No afecta al intento en curso, al idioma,
 * al nombre guardado ni a la cola de envío pendiente.
 *
 * @returns {void}
 */
function clearProgress() {}
```

---

## Señales de Clean Code a respetar

- [ ] Sin números mágicos: `FACTOR_OLVIDO = 0.85`, `K_PRIOR = 5`, `P0 = 0.5`, `MAX_HISTORIAL = 50`,
      `UMBRAL_DOMINADO = 0.80`, `MAX_REBELDES = 10`, `VENTANA_TENDENCIA = 3` como constantes nombradas
- [ ] `UMBRAL` se deriva de `PASS_PCT`, nunca se escribe `0.65` a mano: hay un solo umbral en la app
- [ ] El módulo de cálculo no contiene ni una referencia a `document` ni a `localStorage`
- [ ] Los nombres dicen qué representan: `topicMastery`, no `calc2`; `impacto`, no `score`
- [ ] Manejo explícito de errores: cada `JSON.parse` y cada escritura tienen su rama de fallo visible
- [ ] Un solo lugar traduce `id` de pregunta a tema y tipo: `byId()`, que ya existe
- [ ] La tabla se ordena en el cálculo, no en el render: el render solo pinta lo que recibe

---

## Máquina de estados del frontend

### Pantalla de estadísticas

| Estado | Descripción | Transición |
|---|---|---|
| `sin_datos` | Cero intentos registrados. Explica qué verá aquí y ofrece empezar un intento | primer intento finalizado → `con_datos` |
| `muestra_corta` | Menos de 3 intentos, o la mayoría de temas con `nCrudo < 10`. Muestra la tabla con un aviso de que aún no es fiable | más intentos → `con_datos` |
| `con_datos` | Tabla ordenada por impacto, nota estimada, tendencia y preguntas rebeldes | — |
| `confirmando_borrado` | Diálogo de confirmación | confirmar → `sin_datos` · cancelar → estado anterior |
| `importando` | Archivo seleccionado, validándose | válido → `con_datos` con resumen · inválido → `import_error` |
| `import_error` | Mensaje con el motivo; el historial previo intacto | reintentar → `importando` · cerrar → estado anterior |

Transiciones: 7. Estado optimista: no aplica — todo es local y síncrono.

### Navegación

`screen-stats` se alcanza desde un botón en la pantalla de inicio y desde otro en la de resultado.
Ambos vuelven al lugar de origen; la pantalla no interrumpe ningún intento en curso.

---

## Invariantes del sistema

| # | Invariante |
|---|---|
| 1 | Un fallo del histórico nunca impide hacer, terminar, revisar o imprimir un examen |
| 2 | La pantalla de estadísticas es de solo lectura sobre el historial, salvo importar y borrar, que son acciones explícitas del usuario |
| 3 | Ningún dato por pregunta sale del navegador |
| 4 | El orden de la tabla es siempre por impacto de estudio, nunca alfabético ni por número de tema |
| 5 | Todo porcentaje mostrado va acompañado del tamaño de muestra que lo respalda |
| 6 | Un tema sin datos suficientes se marca como tal en vez de mostrar un número engañoso |
| 7 | Borrar las estadísticas no afecta al intento en curso, al idioma, al nombre ni a la cola de envío |
| 8 | El cálculo es determinista: mismo historial, misma proyección, sin depender de la hora actual |

---

## Impacto en archivos existentes

| Archivo | Cambio | Capa |
|---|---|---|
| `lpi_practice_exam/index.html` | modificado: pantalla `screen-stats`, módulo de cálculo, persistencia del historial, botones de acceso, llamada en `finish()` | UI + persistencia local |
| `docs/specs/estadisticas-preparacion-por-tema.spec.md` | NUEVO: este contrato | documentación |
| `index.html` (portada del sitio) | sin cambios | — |
| `supabase/**` | sin cambios | — |

Funciones existentes que se tocan: `finish()` (una llamada más), `showStart()` (botón de acceso) y
el bloque `init()` (nada obligatorio; la pantalla calcula al abrirse).

---

## Fuera de scope (explícito)

- **Modo "practicar mis puntos débiles"**: generar un intento dirigido a partir del impacto. Es el
  destino natural de este feature y merece su propio spec, porque toca el motor de selección de
  preguntas y no la presentación de datos.
- Lectura de intentos desde Supabase y token de dispositivo para sincronizar entre equipos.
- Gráficas de evolución, sparklines y cualquier visualización más allá de la barra por tema que ya
  existe en la pantalla de resultado.
- Repetición espaciada con intervalos tipo Anki.
- Comparación con otros usuarios o percentiles.
- Sincronización automática entre pestañas abiertas del mismo navegador.
- Migración de formatos: `v: 1` es el primero; el campo existe para que un `v: 2` futuro pueda
  migrar, pero no hay migraciones que escribir todavía.

**Riesgo aceptado**: el dominio ponderado por recencia no es una fracción verificable a simple
vista. Un usuario que sume sus aciertos a mano obtendrá otro número. El spec lo mitiga con el
invariante 4 —mostrar el conteo crudo junto al porcentaje y no presentarlos como fracción— pero la
métrica sigue exigiendo confianza en la fórmula. Fue una decisión consciente frente a la
alternativa de conteos crudos.

---

## Próximos pasos del pipeline

1. `/impact` — side-effects en `finish()`, coste de `computeStats` con el historial lleno, consumo
   de cuota de `localStorage` junto a la cola de envío, y comportamiento cuando el banco cambia.
2. `/arch` — dónde vive el módulo de cálculo dentro del archivo único y cómo se aísla del DOM para
   que `/tdd-plan` pueda probarlo.
3. `/tdd-plan` — plan Red/Green/Refactor: fórmula de dominio con muestras extremas, orden por
   impacto, idempotencia de la importación, tope FIFO, tendencia con pocos intentos, preguntas
   inexistentes en el banco.
4. `/why` — documentar el motivo de cada cambio antes de commitear.
