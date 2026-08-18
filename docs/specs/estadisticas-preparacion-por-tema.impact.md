# Impact Analysis: Estadísticas de preparación por temario

**Feature**: Agregar los intentos finalizados y ordenar los temas por impacto de estudio.
**Spec de origen**: [estadisticas-preparacion-por-tema.spec.md](estadisticas-preparacion-por-tema.spec.md)
**Fecha**: 2026-08-18
**Epicentro del cambio**: `lpi_practice_exam/index.html` — nueva clave de `localStorage` y una llamada más en `finish()`
**Tipo de cambio**: Aditivo, con dos modificaciones obligatorias sobre código existente

---

## Resumen ejecutivo

El feature es aditivo y no toca la base de datos ni ningún contrato externo. El riesgo real no
está en lo que añade, sino en **dos puntos de contacto con la telemetría ya implementada**: la
presión sobre la cuota de `localStorage`, que la cola de envío traga en silencio, y los intentos
guardados sin `cid` de versiones anteriores, que rompen el registro remoto al reanudarse. Ninguno
de los dos se ve leyendo solo el spec.

## Mediciones (no estimaciones)

Sobre el banco real de 145 preguntas, en este equipo:

| Magnitud | Valor medido |
|---|---|
| Intento en curso que escribe `save()` (banco completo) | 7.552 B |
| Intento en curso (simulacro) | 2.192 B |
| Entrada de historial, banco completo | 1.597 B |
| Entrada de historial, simulacro | 545 B |
| **Historial lleno (50 intentos completos)** | **78,0 KB** |
| Cola de envío llena (20 payloads) | 8,9 KB |
| **Pico total de la app** | **94,3 KB — 1,84 % de los ~5 MB** |
| `computeStats` sobre historial lleno usando `byId()` | **14,5 ms** (7.250 búsquedas lineales sobre 145) |
| Lo mismo con un índice `Map` | **2,8 ms** (5,2× más rápido) |

---

## Mapa de zonas afectadas

| Archivo / Módulo | Capa | Tipo de cambio | Severidad |
|---|---|---|---|
| `lpi_practice_exam/index.html` → `queueWrite()` (línea 1841) | infraestructura local | revisar: traga `QuotaExceededError` | 🔴 |
| `lpi_practice_exam/index.html` → `loadStored()` (línea 1696) | aplicación | modificado: intentos previos sin `cid` | 🟠 |
| `lpi_practice_exam/index.html` → `show()` (línea 1953) | UI | modificado: lista de pantallas escrita a mano | 🟠 |
| `lpi_practice_exam/index.html` → `byId()` (línea 1646) | dominio | revisar: búsqueda lineal, ahora en un bucle de 7.250 | 🟠 |
| `lpi_practice_exam/index.html` → `finish()` (línea 1869) | aplicación | modificado: una responsabilidad más | 🟡 |
| `lpi_practice_exam/index.html` → `recordAttempt()` (línea 1858) | infraestructura local | revisar: informa "encolado" sin comprobarlo | 🔴 |
| `lpi_practice_exam/index.html` → `@media print` (línea 148) | UI | revisar: la pantalla nueva no está contemplada | 🟢 |
| `lpi_practice_exam/index.html` → módulo de estadísticas | dominio + UI | NUEVO | — |
| `supabase/**` | persistencia remota | sin cambios | — |
| `index.html` (portada) | UI | sin cambios | — |
| `supabase/functions/tests/` | tests | sin cambios: no cubren el cliente | 🟡 |

---

## Side-effects por severidad

### 🔴 Críticos

**1. El historial puede romper en silencio la garantía write-ahead de la cola de envío.**

`queueWrite()` termina en `catch(e){}`: si `localStorage` rechaza la escritura por cuota, el fallo
desaparece. `recordAttempt()` devuelve entonces `{ok:false, encolado:true}` sin haber comprobado
nada, y la UI muestra *"queda en cola para el próximo arranque"* cuando en la cola no hay nada.
El intento se pierde sin rastro.

El spec fija el orden `renderResult() → recordAttemptStats() → sendCurrentAttempt()`, de modo que
**es precisamente la escritura del historial la que puede agotar la cuota justo antes** de que la
cola intente usarla. Es el peor orden posible para este defecto.

Con los números medidos, el pico de la app es del 1,84 % de la cuota, así que este feature por sí
solo no la agota. Pero la cuota **no es de la app**: `jsalio.github.io` es un único origen para
*todos* los GitHub Pages del mismo usuario, y todos comparten los mismos ~5 MB. El defecto es
preexistente; el feature lo hace alcanzable.

*Mitigación*: que `queueWrite()` devuelva `boolean`, que `recordAttempt()` degrade a estado
`fallido` no reintentable cuando no pudo encolar, y que `recordAttemptStats()` capture
`QuotaExceededError`, pode los intentos más antiguos y reintente una vez antes de rendirse.

**2. `recordAttemptStats()` compite con el intento en curso durante el examen.**

`save()` escribe los 7,5 KB del intento completo en *cada respuesta*. Si la cuota está al límite,
el primero en fallar no será el historial sino el guardado del examen —que también termina en
`catch(e){}` (línea 1700)— y el usuario perdería la posibilidad de reanudar sin ningún aviso.
Mismo patrón de fallo silencioso, distinta víctima.

### 🟠 Altos

**3. Intentos guardados sin `cid` al reanudar.**

`loadStored()` devuelve el objeto `S` tal cual estaba en `localStorage`. Los intentos guardados
**antes** del commit de telemetría no tienen el campo `cid`, que se añadió en `newAttempt()`. Un
usuario que tenga un examen a medias cuando se publique este cambio y lo reanude producirá:

- `buildAttemptPayload` → `client_attempt_id: undefined` → la Edge Function responde 400 → el
  intento se descarta como irreparable;
- `recordAttemptStats` → una entrada de historial con `cid: undefined`, que rompe la idempotencia
  por `cid` y puede duplicarse o colisionar con la siguiente.

Afecta ya a la telemetría en producción, no solo a este feature. *Mitigación*: `loadStored()` debe
sellar un `cid` nuevo si falta.

**4. `show()` lleva la lista de pantallas escrita a mano.**

```js
['screen-start','screen-exam','screen-result'].forEach(...)
```

Si no se añade `'screen-stats'`, la pantalla nueva **nunca se oculta**: aparecerá superpuesta bajo
el examen y bajo el resultado. Es un cambio de una línea y justo por eso es fácil de olvidar.
Conviene derivar la lista del DOM (`$$('section[id^=screen-]')`) para que no vuelva a pasar.

**5. `byId()` es una búsqueda lineal y ahora se ejecuta 7.250 veces.**

Medido: 14,5 ms con `Q.find` frente a 2,8 ms con un índice `Map`. En este equipo es tolerable; en
un móvil modesto, cinco o diez veces más lento, son 70-150 ms de bloqueo del hilo principal al
abrir la pantalla. El índice se construye una vez y **también acelera `renderReview()` y `opts()`**,
que hoy hacen 145 búsquedas lineales cada vez que se cambia de filtro.

**6. Las claves de `res` son cadenas; `byId()` compara con `===` sobre números.**

`Object.keys(res)` devuelve `"301"`, y `byId("301")` devuelve `undefined` porque `q.id === "301"`
es falso. Un `Number(id)` olvidado no lanza ninguna excepción: simplemente **todos los temas
quedan en `sin_datos`** y la pantalla se ve vacía sin explicar por qué. Es el fallo silencioso más
probable de toda la implementación.

### 🟡 Medios

**7. `finish()` acumula responsabilidades.** Ya calcula, limpia el guardado, renderiza y envía;
ahora también registra. Cinco pasos en una función que empezó siendo "mostrar el resultado". No
rompe nada, pero `/arch` debería extraer un `onAttemptFinished(S)` que orqueste y deje `finish()`
con la decisión de terminar.

**8. Dos pestañas abiertas pierden un intento.** Ambas leen el historial, añaden su entrada y
escriben: la última gana y borra la del otro. `localStorage` no ofrece transacciones. El spec
declara la sincronización entre pestañas fuera de scope, lo cual es razonable, pero conviene
saber que el riesgo es pérdida de datos y no solo desorden. Releer justo antes de escribir reduce
la ventana; no la cierra.

**9. El tope FIFO debe aplicarse después de fusionar al importar.** Un archivo con 200 intentos
—propio de alguien que exportó desde otro navegador y volvió a importar— desbordaría el tope si
el recorte se hiciera solo al registrar.

**10. No hay infraestructura de tests para el cliente.** Las 12 pruebas Deno cubren la Edge
Function; el código del navegador solo se ha verificado extrayendo funciones puras con un arnés
temporal. `computeStats` es pura por diseño precisamente para poder probarla, pero **hoy no existe
dónde ponerla**. `/tdd-plan` tendrá que decidir si se crea un directorio de pruebas para el cliente
o se reutiliza el arnés de extracción.

### 🟢 Bajos

**11. `@media print` oculta `button`, así que los controles de exportar, importar y borrar no se
imprimen** — que es lo correcto. La pantalla usa `.hidden` como las demás, así que no aparece al
imprimir el resultado. Sin acción, solo verificado.

**12. El decaimiento indexa por antigüedad global, no por tema.** Hoy es equivalente porque los dos
modos cubren siempre los cinco temas. Dejará de serlo en cuanto exista el modo de práctica dirigida,
donde un intento puede tocar un solo tema: ahí `0.85^i` penalizaría temas que simplemente no
salieron. Anotarlo como entrada para ese spec.

---

## Base de datos

- **Migración necesaria**: no.
- **Datos existentes en riesgo**: no en Postgres. En el navegador, sí: ver side-effect 3 (intentos
  reanudados sin `cid`) y 1 (cuota).
- **Detalle**: el feature no lee ni escribe en Supabase. `telemetry.exam_attempts` queda intacta y
  los dos specs siguen siendo independientes.

## Contratos que cambian

Ninguno externo. Internos:

- `show(id)` — la lista de pantallas deja de ser de tres elementos.
- `finish(auto)` — su orden de operaciones pasa a ser parte del contrato: render, historial, envío.
- `queueWrite(q)` — pasa de `void` a `boolean` si se aplica la mitigación del side-effect 1.
- `loadStored()` — pasa a garantizar que el objeto devuelto tiene `cid`.
- Formato de `localStorage`: clave nueva `lpi-010-160-historial` con campo `v` para migraciones.

## Puntos ciegos (verificación manual requerida)

- [ ] Cuota real disponible en `jsalio.github.io`: la comparten todos los proyectos del usuario en
      GitHub Pages y no se puede medir desde aquí.
- [ ] Safari con ITP purga `localStorage` de sitios sin interacción a los 7 días: el historial
      podría desaparecer solo. Afecta al valor del feature, no a su corrección.
- [ ] Modo incógnito: cuota muy reducida o nula según el navegador.
- [ ] Rendimiento real de `computeStats` en el móvil del usuario.
- [ ] Comportamiento con dos pestañas del examen abiertas a la vez.

## Checklist antes de implementar

- [ ] `queueWrite()` informa si la escritura falló y `recordAttempt()` lo refleja en la UI
- [ ] `recordAttemptStats()` maneja `QuotaExceededError` podando el historial
- [ ] `loadStored()` sella un `cid` cuando el intento guardado no lo tiene
- [ ] `show()` contempla `screen-stats`, preferiblemente derivando la lista del DOM
- [ ] Existe un índice `id → pregunta` y `byId()` lo usa
- [ ] Toda conversión de clave de `res` pasa por `Number()`
- [ ] El tope FIFO se aplica después de fusionar en la importación
- [ ] Está decidido dónde viven las pruebas de `computeStats`

---

## Próximo paso

`/arch` — definir dónde vive el módulo de cálculo dentro del archivo único, cómo se aísla del DOM
y de `localStorage` para que sea verificable, y si `finish()` cede la orquestación a un
`onAttemptFinished(S)`.
