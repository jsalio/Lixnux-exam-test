# Architecture Decision: Estadísticas de preparación por temario

**Feature**: Agregar los intentos finalizados y ordenar los temas por impacto de estudio.
**Spec de origen**: [estadisticas-preparacion-por-tema.spec.md](estadisticas-preparacion-por-tema.spec.md)
**Análisis previo**: [estadisticas-preparacion-por-tema.impact.md](estadisticas-preparacion-por-tema.impact.md)
**Fecha**: 2026-08-18
**Modo**: Detección (proyecto existente)
**Patrón arquitectónico**: Script monolítico organizado por bandas, sin framework ni build

---

## Patrón detectado

### Descripción

`lpi_practice_exam/index.html` es un archivo único de ~2.290 líneas: HTML, CSS y JavaScript en el
mismo documento, sin bundler, sin módulos ES y sin dependencias externas. No es Clean Architecture
ni Hexagonal, y forzarlas aquí sería un error: **la aplicación tiene que seguir funcionando abierta
como `file://`**, requisito que ya está codificado en el origen `null` de la lista blanca de CORS de
la Edge Function. Los módulos ES no cargan desde `file://` sin servidor, así que partir el archivo
está descartado por diseño, no por comodidad.

Lo que sí existe es una organización real por **bandas de comentarios**, consistente en todo el
archivo:

```
BANCO DE PREGUNTAS      Q, TOPICS — datos inmutables
LOGICA DE LA APLICACION constantes, helpers
  idioma / estado / helpers de pregunta
REGISTRO DEL INTENTO    telemetría: puro + red + UI, ya separados entre sí
pantallas / render / temporizador / finalizar / formulario / eventos / arranque
```

El precedente más limpio del repositorio no está en el HTML, sino en la Edge Function: se dividió
en `validation.ts` (puro, probado con 12 tests) e `index.ts` (transporte). **Este feature aplica la
misma disciplina dentro del archivo único**, con la separación marcada por bandas en vez de por
archivos.

### Estructura de capas

Cuatro bandas con una regla de dependencias explícita. El orden en el archivo es el orden de
dependencia: cada banda solo puede usar lo declarado por encima.

```
┌─ 1. DATOS ────────────────────────────────────────────────┐
│  Q, TOPICS, SIM_PLAN, PASS_PCT                            │
│  Inmutable. No depende de nada.                           │
├─ 2. NÚCLEO PURO ──────────────────────────────────────────┤
│  qIndex, summarizeAttempt, scaled, topicMastery,          │
│  computeStats, buildAttemptPayload, normalizeUserKey,     │
│  validateHistory, mergeHistory                            │
│  PROHIBIDO: document, localStorage, Date.now, fetch       │
├─ 3. ADAPTADORES ──────────────────────────────────────────┤
│  store (localStorage), api (fetch a la Edge Function)     │
│  Traducen fallos a valores de retorno. Sin decisiones.    │
├─ 4. ORQUESTACIÓN + RENDER ────────────────────────────────┤
│  onAttemptFinished, newAttempt, finish, flushAttemptQueue │
│  renderResult, renderStats, renderSync, show, listeners   │
└───────────────────────────────────────────────────────────┘
```

### Regla de dependencias

```
render → orquestación → { núcleo puro, adaptadores } → datos
```

Nunca al revés. En concreto: **el núcleo puro no conoce el almacenamiento ni el DOM**. Es la única
regla que hace falta vigilar, y es verificable de forma mecánica (ver "Frontera verificable").

---

## Mapeo del feature a la arquitectura

| Elemento del spec | Banda | Nombre | Responsabilidad |
|---|---|---|---|
| Historial `v:1` | 3 | `HISTORY_KEY` + `store` | Serializar y persistir; nada más |
| `computeStats(historial)` | 2 | `computeStats` | Proyección completa: porTema, porTipo, rebeldes, resumen |
| Fórmula de dominio | 2 | `topicMastery(muestras)` | Ponderación por recencia + encogimiento |
| Orden por impacto | 2 | dentro de `computeStats` | La tabla llega ordenada al render |
| Tendencia | 2 | `topicTrend(historial, tema)` | Ventana de 3 frente a 3 |
| Preguntas rebeldes | 2 | `leechQuestions(proyeccion)` | Top 10 por apariciones |
| `recordAttemptStats(attempt)` | 4 | orquestación | Construye la entrada y pide al `store` que la escriba |
| `exportProgress()` | 4 | orquestación | Blob + descarga: es efecto, no cálculo |
| `importProgress(texto)` | 2 + 4 | `validateHistory` + `mergeHistory` puros; la escritura en 4 | Validar y fusionar es cálculo; guardar es efecto |
| `clearProgress()` | 3 + 4 | `store.remove` | — |
| Pantalla `screen-stats` | 4 | `renderStats(proyeccion)` | Solo pinta lo que recibe |
| Índice `id → pregunta` | 2 | `qIndex` | Corrige la búsqueda lineal detectada en `/impact` |

---

## Contratos entre capas

### Puerto: `store` (banda 3)

Único punto de acceso a `localStorage` en toda la aplicación. Existe para resolver el side-effect
🔴 nº 1 de `/impact`: hoy hay siete `try{...}catch(e){}` sueltos que se tragan los fallos de cuota.

```js
const store = {
  /** @returns {string|null} null si no existe o si el almacenamiento no está disponible */
  read(key) {},
  /** @returns {boolean} false si la escritura falló (cuota, modo privado, almacenamiento bloqueado) */
  write(key, value) {},
  /** @returns {boolean} */
  remove(key) {}
};
```

**Vive en**: banda 3. **Lo usan**: solo la banda 4. **Regla**: quien llame a `write` está obligado
a mirar el booleano. Un `store.write(...)` cuyo resultado se ignora es un defecto, no un descuido
de estilo.

### DTO: `HistorialV1`

Lo que cruza entre el `store` y el núcleo. Estructura plana, sin métodos, exactamente la del spec.
El núcleo lo recibe **ya parseado**: `JSON.parse` vive en la banda 4, junto a su rama de fallo.

### DTO: `ProyeccionEstadisticas`

Lo que devuelve `computeStats` y consume `renderStats`. Incluye la tabla **ya ordenada** por
impacto y los estados del semáforo ya resueltos. El render no calcula, no ordena y no decide
colores a partir de umbrales: recibe `estado: 'estudiar' | 'reforzar' | 'repasar' | 'sin_datos'`
y lo traduce a clase CSS.

### Función de orquestación: `onAttemptFinished(attempt)`

```js
function onAttemptFinished(attempt) {
  renderResult();            // 1. lo que el usuario espera ver
  recordAttemptStats(attempt); // 2. local, síncrono, puede avisar de fallo de cuota
  sendCurrentAttempt();      // 3. red, asíncrono, con su cola write-ahead
}
```

Cada paso va en su propio `try/catch`: que falle el histórico no puede impedir el envío, y que
falle el envío no puede afectar al histórico. `finish()` recupera su responsabilidad original
—decidir que el intento termina— y delega el después.

---

## Frontera verificable

La regla "el núcleo no toca el DOM ni el almacenamiento" no sirve de nada si nadie la comprueba.
Se hace mecánica con dos marcadores en el archivo:

```js
/* ===== NÚCLEO PURO — INICIO =====
   Sin document, sin localStorage, sin Date.now(), sin fetch.
   Todo lo de aquí se extrae y se prueba con node --test. */
   ...
/* ===== NÚCLEO PURO — FIN ===== */
```

Un extractor (`tools/extract-core.mjs`) toma el banco de preguntas más esa región y produce un
módulo importable por las pruebas. El mismo extractor **falla si encuentra `document`,
`localStorage`, `Date.now` o `fetch` dentro de la región**: la regla arquitectónica se convierte en
una prueba que se rompe sola cuando alguien la viola.

Este mecanismo ya se usó de forma improvisada en esta sesión para validar el payload del cliente
contra el validador real de la Edge Function. Aquí se formaliza.

### Dónde viven las pruebas

```
tools/extract-core.mjs              extrae banco + núcleo desde el HTML
tests/core.test.mjs                 node --test, sin dependencias
supabase/functions/tests/           las 12 pruebas Deno existentes, sin cambios
```

Se elige `node --test` (nativo desde Node 18, ya instalado) frente a añadir un framework: cero
dependencias nuevas y ningún `package.json` que mantener. Y sobre todo, **no se parte el HTML**: la
aplicación publicada sigue siendo un archivo único que funciona con doble clic.

---

## Decisiones arquitectónicas

| # | Decisión | Motivo | Alternativa descartada |
|---|---|---|---|
| 1 | El núcleo puro se delimita con marcadores y se extrae para probarlo | Es la única forma de verificar las fórmulas —encogimiento, orden por impacto, tendencia— sin navegador, manteniendo el archivo único | Partir el JS en módulos ES: rompe `file://`, que es un requisito real de esta app |
| 2 | Un solo adaptador `store` con retorno booleano | Centraliza los siete `catch` mudos y hace imposible el fallo silencioso de cuota que detectó `/impact` | Seguir con `try/catch` por llamada: ya demostró que oculta pérdida de datos |
| 3 | `finish()` delega en `onAttemptFinished(attempt)` | Fija el orden render → histórico → envío como contrato, y aísla los tres fallos entre sí | Encadenar llamadas dentro de `finish()`: cinco responsabilidades en la función que decide terminar |
| 4 | `computeStats` devuelve la tabla ya ordenada y con el semáforo resuelto | El render no puede introducir un criterio de orden distinto al del spec, que es el corazón del feature | Ordenar en el render: el invariante 4 del sistema dejaría de ser verificable sin DOM |
| 5 | `qIndex` (Map) en el núcleo, `byId` pasa a consultarlo | 14,5 ms → 2,8 ms medidos; además acelera `renderReview()`, que hoy hace 145 búsquedas lineales por cambio de filtro | Dejar `Q.find`: 70-150 ms de hilo bloqueado en un móvil modesto |
| 6 | El tiempo entra como parámetro, nunca se lee dentro del núcleo | Sostiene el invariante 8 del spec: mismo historial, misma proyección | `Date.now()` dentro de `computeStats`: cálculo no reproducible ni comprobable |
| 7 | La conversión de claves `res` a número ocurre en la frontera del núcleo | `Object.keys` devuelve cadenas y `byId` compara con `===`: sin esto todos los temas salen vacíos sin error | Convertir en cada uso: el olvido de una sola llamada reproduce el fallo silencioso |

---

## Violaciones detectadas y corregidas

| Violación | Dónde estaba | Corrección aplicada |
|---|---|---|
| Núcleo que lee almacenamiento | `buildAttemptPayload` hace `localStorage.getItem(LANG_KEY)` para resolver `idioma` — código ya en `main` | `idioma` pasa a ser parámetro. La banda 4 lo lee del `store` y lo inyecta. Sin esto, la función no puede vivir dentro de los marcadores del núcleo |
| Errores tragados en la capa de persistencia | `queueWrite`, `save`, `clearSave`, `setLang`, `setNombreState`: cinco `catch(e){}` vacíos | Todos pasan por `store`, que devuelve booleano. `recordAttempt` degrada a `fallido` no reintentable si no pudo encolar |
| Estado no sellado al reanudar | `loadStored()` devuelve intentos sin `cid` guardados antes de la telemetría | `loadStored()` sella un `cid` si falta, antes de devolver el objeto |
| Lista de pantallas escrita a mano | `show()` con `['screen-start','screen-exam','screen-result']` | Derivar de `$$('section[id^="screen-"]')`: añadir una pantalla deja de requerir tocar `show()` |
| Cálculo dentro del render | `renderResult` calculaba conteos y el desglose por tema | Ya corregido al integrar la telemetría: consume `summarizeAttempt`. Se mantiene la regla para `renderStats` |

Las tres primeras afectan a código **ya desplegado en `main`**, no solo al feature nuevo.

---

## Lo que NO debe cruzar capas

- El núcleo puro no importa nada del DOM, del almacenamiento, de la red ni del reloj.
- El render no calcula, no ordena, no aplica umbrales y no lee `localStorage`.
- El `store` no sabe qué significan las claves que guarda: no valida ni migra, solo lee y escribe.
- Los adaptadores no toman decisiones de negocio: traducen fallos a valores de retorno.
- La proyección de estadísticas no vuelve al historial: es de solo lectura y se recalcula, nunca se
  persiste. Una caché reintroduciría los dos estados divergentes que el spec eliminó a propósito.
- Ningún dato por pregunta cruza hacia la banda de red. La banda 3 tiene dos adaptadores y solo el
  `store` ve `res`.

---

## Próximo paso

`/tdd-plan` — plan Red/Green/Refactor sobre el núcleo extraído: fórmula de dominio con muestras
extremas, orden por impacto, idempotencia de la importación, tope FIFO, tendencia con pocos
intentos, y preguntas que ya no existen en el banco.
