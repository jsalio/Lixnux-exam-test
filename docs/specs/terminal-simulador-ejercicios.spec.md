# SDD Spec: Simulador de terminal — ejercicios verificados

**Feature**: Ejercicios sobre la terminal simulada que se corrigen inspeccionando el estado del filesystem virtual, no comparando la orden tecleada.
**User story**: practicar los comandos de los objetivos 102, 103 y 105 con enunciados que admiten cualquier camino correcto.
**Estado**: Draft
**Fecha**: 2026-08-21
**Sub-spec**: 2 de 2. **Depende de** `terminal-simulador-nucleo`: el verificador inspecciona el `Estado` que aquella define.
**Pipeline siguiente**: /impact → /arch → /tdd-plan → /tdd-plan-ui → /why

---

## Por qué esta sub-spec existe aparte

Es el diferenciador del feature y la única parte que ninguna de las seis páginas
del proyecto hace hoy. Ninguna de las seis corrige nada: explican y preguntan de
opción múltiple. Aquí el alumno **hace**, y algo comprueba si lo hizo.

La comprobación se hace sobre el árbol, no sobre el texto. La prueba `E1` del
prototipo demuestra que cuatro caminos distintos dejan `/tmp/logs` en modo 750:

```
mkdir /tmp/logs && chmod 750 /tmp/logs
mkdir -m 750 /tmp/logs
cd /tmp ; mkdir logs ; chmod u=rwx,g=rx,o= logs
umask 027 ; mkdir /tmp/logs
```

Un verificador que comparase cadenas rechazaría tres. Uno que mire el estado
acepta las cuatro, y también la quinta que no se nos ocurrió.

---

## Decisiones fijas

| Decisión | Valor | Motivo |
|---|---|---|
| Criterio de corrección | El estado del filesystem virtual, más `salida` y `codigo` cuando el enunciado los pide | Cualquier camino correcto vale. Comparar la orden tecleada convierte el ejercicio en un examen de memoria de una sola solución |
| Enunciados | En español, sin revelar el comando | Si el enunciado dice «usa `chmod`», el ejercicio ya está resuelto |
| Progreso | En `localStorage`, clave `lpi-010-160-terminal-progreso-v1` | Convención del proyecto: clave propia y versionada, un único punto de acceso |
| Estado del árbol | Cada ejercicio arranca de su propio árbol, montado al empezarlo | Un ejercicio no puede depender de lo que dejó el anterior |
| Pistas | Escalonadas: primero el concepto, luego el comando, luego la orden entera | Dar la orden entera de golpe convierte el ejercicio en copiar y pegar |
| Verificación | Al pulsar «comprobar», no en cada tecla | Verificar en vivo delata la respuesta a base de intentos |
| Objetivos | 102, 103 y 105 | Los que cubre el núcleo. El 104 no tiene procesos simulados |

---

## Modelo de datos

### `Ejercicio`

Entidad **nueva**. Vive en su propio bloque `<script>` del HTML, delimitado por
`<!-- @@EJERCICIOS@@ -->`, separado de la lógica igual que el banco del examen.

```js
/**
 * @typedef {object} Ejercicio
 * @property {string} id           Estable. Sobrevive a reordenaciones del banco.
 * @property {102|103|105} objetivo  Tema del examen al que responde.
 * @property {1|2|3} nivel         1 una orden · 2 varias · 3 encadenadas.
 * @property {string} titulo       Cuatro o cinco palabras, para la lista.
 * @property {string} enunciado    Qué hay que conseguir. Nunca cómo.
 * @property {(estado: Estado) => Estado} [preparar]
 *           Deja el árbol como lo necesita el ejercicio. Si falta, se usa el semilla.
 * @property {(estado: Estado, ultima: Resultado) => Veredicto} verificar
 *           Función PURA. Mira el árbol, no lo que se escribió.
 * @property {string[]} pistas     De menos a más concreta. Al menos dos.
 * @property {string} solucion     Una solución de ejemplo, entre varias posibles.
 * @property {string[]} otrosCaminos  Soluciones alternativas válidas, para las pruebas.
 */
```

### `Veredicto`

```js
/**
 * @typedef {object} Veredicto
 * @property {boolean} cumplido
 * @property {string} detalle   Qué falta, en una frase. Nunca la solución.
 */
```

### `Resultado`

Lo que devolvió `ejecutar()` en la última orden: `{ salida, error, codigo }`. Lo
necesitan los ejercicios cuyo objetivo es una salida concreta o un código de
salida, no un cambio en el árbol.

### `Progreso`

```js
/**
 * @typedef {object} Progreso
 * @property {number} version                    1
 * @property {Record<string, EntradaProgreso>} porEjercicio  id → intento
 */

/**
 * @typedef {object} EntradaProgreso
 * @property {number} intentos      Comprobaciones fallidas antes de resolverlo.
 * @property {number} pistasVistas
 * @property {boolean} resuelto
 * @property {number|null} resueltoEn  Segundos epoch, o null.
 */
```

### Invariantes del modelo

1. `verificar` es pura: no muta el estado, no lee el reloj, no toca el navegador.
2. `verificar` no recibe en ningún momento el texto que el alumno escribió. No puede compararlo aunque quiera.
3. Todo ejercicio tiene al menos dos entradas en `otrosCaminos`, y las pruebas comprueban que todas dan `cumplido: true`.
4. `id` es único y estable; el progreso guardado se indexa por él.
5. Un `Progreso` cuya `version` no se reconoce se descarta entero, sin migrar a medias.
6. `resuelto` no se revierte: un ejercicio resuelto sigue resuelto aunque luego se rompa el árbol.
7. `detalle` nunca contiene la solución ni el nombre del comando que falta.

---

## Contratos de API

### `verificar(ejercicio, estado, ultima) → Veredicto`

- **Params**: el ejercicio, el `Estado` tras las órdenes del alumno, y el `Resultado` de la última orden.
- **Response**: `Veredicto`.
- **EFECTO**: ninguno. Es pura.
- **ERRORES**: no lanza. Un verificador que reviente sobre un árbol inesperado devuelve `{cumplido: false, detalle: …}`.

### `montarEjercicio(ejercicio, ahora) → Estado`

- **Params**: el ejercicio y el instante como dato.
- **Response**: `Estado` listo, con `preparar` aplicado sobre el árbol semilla.
- **EFECTO**: ninguno fuera del objeto devuelto.

### `registrarIntento(progreso, id, veredicto, ahora) → Progreso`

- **Params**: progreso actual, id del ejercicio, veredicto, instante.
- **Response**: **nuevo** `Progreso`. No muta el que recibe.
- **EFECTO**: ninguno. La escritura en `localStorage` la hace la capa de orquestación, fuera del núcleo.

### `validarProgreso(texto) → Progreso | null`

- **Params**: el texto crudo leído de `localStorage`.
- **Response**: el progreso, o `null` si está corrupto o su `version` no se reconoce.
- **EFECTO**: ninguno.
- **ERRORES**: nunca lanza. Un `localStorage` manipulado a mano no puede romper la página.

### `resumenProgreso(progreso, ejercicios) → Resumen`

Devuelve resueltos y totales, global y por objetivo, más el siguiente ejercicio
sin resolver del nivel más bajo. Es lo que alimenta la lista y la barra.

---

## Principios SOLID aplicables

| Principio | Aplicación concreta | Riesgo si se viola |
|---|---|---|
| SRP | El ejercicio declara **qué** hay que conseguir; el núcleo ejecuta; la vista pinta. El verificador no ejecuta nada ni pinta nada | Un verificador que además ejecute órdenes acaba comprobando su propio trabajo, y deja de ser una comprobación |
| OCP | Un ejercicio nuevo es una entrada más en el banco. No toca el verificador, ni el núcleo, ni la vista | Si añadir un ejercicio exige tocar la lógica, el banco no crece |
| DIP | `verificar` recibe el estado; no sabe de dónde viene. Por eso se puede probar con un árbol construido a mano | Un verificador que consulte el DOM para saber qué pasó no se puede probar sin navegador |
| LSP | Todos los verificadores cumplen la misma firma y el mismo contrato: puros, sin excepciones, `Veredicto` siempre | Un verificador que lance rompe la página en el ejercicio 14 y en ningún otro |

---

## Documentación esperada de funciones públicas

```js
/**
 * Decide si un ejercicio está resuelto mirando el estado del sistema, no lo que
 * el alumno escribió.
 *
 * Es la regla que hace que el ejercicio admita cualquier camino correcto: crear
 * un directorio con `chmod` después, con `mkdir -m` o ajustando la `umask` antes
 * son tres formas de dejar el mismo árbol, y las tres valen.
 *
 * @param {Ejercicio} ejercicio  El ejercicio a comprobar.
 * @param {Estado} estado        Estado del sistema tras las órdenes del alumno.
 * @param {Resultado} ultima     Salida y código de la última orden ejecutada.
 * @returns {Veredicto} Si está cumplido y, si no, qué falta en una frase.
 */
```

```js
/**
 * Descarta un progreso guardado que no se pueda interpretar con seguridad.
 *
 * Se prefiere perder el progreso a arrastrar uno a medio migrar: un contador de
 * intentos equivocado es peor que un contador en cero, porque el alumno confía
 * en él.
 *
 * @param {string|null} texto  Lo leído de `localStorage`, tal cual.
 * @returns {Progreso|null} El progreso válido, o `null` si hay que empezar.
 */
```

---

## Señales de Clean Code a respetar

- [ ] El verificador de cada ejercicio se lee como su enunciado: `nodo.modo === 0o750`, no `n.m === 488`.
- [ ] Los modos en octal, nunca en decimal.
- [ ] Un único punto de acceso a `localStorage`, como en el examen.
- [ ] `detalle` en una frase, dicha desde lo que falta y no desde lo que está mal.
- [ ] Sin números mágicos: el número de pistas, el límite del historial y la versión del progreso son constantes nombradas.
- [ ] Ningún verificador toca `estado`: si necesita comparar, clona.

---

## Máquina de estados del frontend

Estados: `enunciado` · `trabajando` · `resuelto` · `fallido`.

| Desde | Evento | Hasta |
|---|---|---|
| `enunciado` | empezar | `trabajando` (se monta el árbol del ejercicio) |
| `trabajando` | comprobar, veredicto cumplido | `resuelto` (se guarda el progreso) |
| `trabajando` | comprobar, veredicto no cumplido | `fallido` (se muestra `detalle`, sube el contador) |
| `fallido` | seguir escribiendo | `trabajando` |
| `fallido` | pedir pista | `fallido` (una pista más, sube el contador) |
| `resuelto` | siguiente | `enunciado` del siguiente |
| cualquiera | reiniciar el ejercicio | `trabajando` (árbol de nuevo, contadores intactos) |

Estado optimista: **no**. El veredicto se conoce al instante y en local; dar por
resuelto antes de comprobar sería mentir sobre lo único que importa aquí.

---

## Invariantes del sistema

| # | Invariante |
|---|---|
| 1 | Ningún verificador recibe el texto tecleado por el alumno |
| 2 | Cada ejercicio tiene probados al menos tres caminos válidos distintos, y todos se dan por buenos |
| 3 | Un `localStorage` corrupto o manipulado no rompe la página: se descarta y se empieza |
| 4 | El enunciado y el `detalle` nunca nombran el comando de la solución |
| 5 | Cada ejercicio arranca de un árbol conocido, independiente del ejercicio anterior |
| 6 | El progreso se guarda solo al resolver o al fallar una comprobación, nunca en cada tecla |

---

## Impacto en archivos existentes

| Archivo | Cambio | Capa |
|---|---|---|
| `linux_terminal/index.html` | modificado: bloque `<!-- @@EJERCICIOS@@ -->`, panel de enunciado, lógica de progreso | UI + dominio |
| `tools/extract-core.mjs` | modificado: extraer también el banco de ejercicios, como hace con el del examen | herramientas |
| `tests/terminal-ejercicios.test.mjs` | NUEVO: por cada ejercicio, todos sus caminos válidos y al menos uno inválido | pruebas |
| `README.md` | modificado: la sección de la terminal menciona los ejercicios y su número | documentación |
| `index.html` | modificado: la tarjeta menciona los ejercicios en sus `facts` | UI |

---

## Fuera de scope (explícito)

- **Puntuación tipo examen**: no hay nota ni escala 200–800. Un ejercicio está resuelto o no lo está.
- **Registro en Supabase**: el progreso es local. `registro-intentos-supabase.spec.md` sigue en Draft y no se toca.
- **Ejercicios del objetivo 104**: no hay procesos simulados.
- **Ejercicios de scripting (3.3)**: sin estructuras de control no se pueden plantear, y los cubre `linux_shell_scripting/`.
- **Corrección parcial**: un ejercicio con tres condiciones se cumple entero o no se cumple. Sin puntos por dos de tres.
- **Límite de tiempo** y **orden obligatorio**: se puede saltar a cualquier ejercicio.
- **Bilingüismo**: solo español, como las cinco guías. El bilingüe es del examen.

---

## Próximos pasos del pipeline

1. `/impact` — cómo convive el panel de ejercicios con la terminal libre de la sub-spec 1
2. `/arch` — dónde vive el banco y dónde el verificador dentro del HTML único
3. `/tdd-plan` — plan por ejercicio: caminos válidos, caminos inválidos, progreso corrupto
4. `/tdd-plan-ui` — plan del panel: enunciado, pistas, veredicto, avance
5. `/why` — motivo de cada decisión, empezando por la de no comparar cadenas
