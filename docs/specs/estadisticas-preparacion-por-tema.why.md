# Why: Estadísticas de preparación por temario

**Feature**: Sumar todos los intentos y ordenar los temas por dónde rinde más estudiar.
**Pipeline**: [spec](estadisticas-preparacion-por-tema.spec.md) → [impact](estadisticas-preparacion-por-tema.impact.md) → [arch](estadisticas-preparacion-por-tema.arch.md) → [tdd-plan](estadisticas-preparacion-por-tema.tdd-plan.md) → [tdd-plan-ui](estadisticas-preparacion-por-tema.tdd-plan-ui.md) → implementación
**Fecha**: 2026-08-18

---

## Por qué este feature

El simulador ya decía qué habías fallado en *un* intento. No decía qué estudiar. Con un banco de
145 preguntas y cinco temas de peso desigual, saber que sacaste un 62 % no dice si abrir el capítulo
de permisos o el de línea de comandos esta tarde.

## La decisión que define el feature

**Ordenar por impacto de estudio, no por porcentaje.** Los temas no pesan igual en el examen: el 103
son 10 de 40 preguntas y el 101 son 7. Estar flojo en el 103 cuesta más nota que estar flojo en el
101, aunque el porcentaje sea peor en el segundo.

```
impacto_t = max(0, 0.65 − dominio_t) × (SIM_PLAN[t] / 40)
```

Es la diferencia entre un informe y un plan de estudio. El test 2.2 la fija: construye un escenario
donde el tema **mejor** debe aparecer **primero**, y falla si alguien ordena por nota.

## Decisiones de implementación

### Una sola clave de almacenamiento, no dos

**Qué**: el resultado por pregunta vive dentro de cada intento del historial; la proyección se
recalcula en memoria.
**Por qué**: el diseño exploratorio tenía historial y acumulado por pregunta como estados separados.
Al concretar la importación quedó claro que pueden divergir y que los contadores se duplicarían al
importar dos veces el mismo archivo.
**Alternativa descartada**: mantener las dos claves con una rutina de reconciliación. Cuesta más
código y más pruebas que recalcular 7.250 resultados, que tarda 2,8 ms.

### El núcleo puro se delimita con marcadores y se extrae para probarlo

**Qué**: `tools/extract-core.mjs` saca el banco y la región entre marcadores a un módulo que
importan las pruebas, y **se niega a extraer** si esa región usa `document`, `localStorage`, el
reloj, el azar o la red.
**Por qué**: la app tiene que seguir funcionando abierta como `file://` —requisito ya codificado en
el origen `null` de la lista blanca de CORS—, así que no puede usar módulos ES. Sin el extractor, la
única forma de verificar las fórmulas sería a mano en un navegador.
**Alternativa descartada**: partir el JS en archivos. Rompe `file://`.

Funcionó a la primera: la guardia detectó que `buildAttemptPayload` leía `LANG_KEY` de
`localStorage`, código subido esa misma mañana. El idioma pasó a ser parámetro.

### El render devuelve cadenas; solo el controlador escribe

**Qué**: `statsSummaryHtml`, `statsTableHtml` y `leechListHtml` devuelven HTML; `renderStats()` es
lo único que hace `innerHTML =`.
**Por qué**: es la traducción de Smart/Dumb a un proyecto sin componentes. Diez de los dieciocho
tests de pantalla son aserciones sobre texto, sin jsdom ni navegador.

### El almacenamiento informa de sus fallos

**Qué**: un adaptador `store` con retorno booleano sustituye a siete `try/catch` mudos.
**Por qué**: no es limpieza estética. `recordAttempt` respondía siempre "queda en cola para el
próximo arranque" sin comprobarlo, así que con la cuota agotada la interfaz prometía un reintento
imposible y el intento desaparecía sin rastro. Estaba en producción.

## Correcciones a código ya desplegado

Las detectó `/impact` y `/arch` las absorbió como parte del diseño, porque el feature no se podía
construir limpio sin ellas.

| Qué | Por qué importaba |
|---|---|
| `queueWrite` se tragaba `QuotaExceededError` | La cola mentía y se perdían intentos en silencio |
| `loadStored` devolvía intentos sin `cid` | Reanudar un intento anterior a la telemetría producía un 400 y se descartaba |
| `byId` era una búsqueda lineal | 14,5 ms → 2,8 ms en el agregado; también acelera la revisión de preguntas |
| `show()` tenía la lista de pantallas a mano | La pantalla nueva no se habría ocultado nunca |

## Desviaciones del spec

| Desviación | Motivo | Impacto |
|---|---|---|
| `buildAttemptPayload` recibe `idioma` | Leía almacenamiento; no cabía en el núcleo | bajo |
| `computeStats` devuelve también `orden` | Hace verificable el invariante del orden sin DOM | bajo |
| `tests/browser-stub.mjs`, no previsto en `/arch` | Las bandas de adaptadores no se pueden extraer: su razón de ser es hablar con el navegador | bajo |
| 58 tests en vez de los 54 planificados | Contrapuntos positivos que evitan que un valor fijo pase por bueno | bajo |
| La guardia bloquea también `Math.random`, `crypto`, `sessionStorage`, `XMLHttpRequest` | Que `shuffle()` y `uuid()` no puedan colarse en el núcleo | bajo |
| La poda por cuota descarta la mitad más antigua | El spec decía "poda los antiguos" sin concretar | bajo |

## Riesgos aceptados

1. **El dominio ponderado no es verificable a mano.** Quien sume sus aciertos obtendrá otro número.
   Mitigado mostrando siempre el conteo crudo al lado y no presentándolos nunca como fracción,
   pero la métrica exige confianza en la fórmula. Fue una elección consciente frente a los conteos crudos.
2. **Un historial ilegible se descarta.** `loadHistory` avisa por consola y parte de cero; la
   siguiente escritura sobrescribe lo ilegible. Solo se recupera si había un export.
3. **Dos pestañas abiertas pueden perder un intento.** `localStorage` no tiene transacciones.
   Declarado fuera de scope, pero el coste es pérdida de datos, no desorden.

## Deuda técnica

| # | Descripción | Prioridad |
|---|---|---|
| 1 | `almacenamientoDegradado` se enciende pero la interfaz no lo muestra todavía | próximo ciclo |
| 2 | Modo "practicar mis puntos débiles": el destino natural del impacto calculado | su propio spec |
| 3 | El decaimiento indexa por antigüedad global; dejará de valer cuando un intento pueda tocar un solo tema | junto con la deuda 2 |
| 4 | Sin sincronización entre pestañas | cuando alguien se queje |
| 5 | Retención del historial en Supabase (job `pg_cron` a 12 meses) | antes de aplicar el examen a terceros |
