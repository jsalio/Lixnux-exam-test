# SDD Spec: Simulador de terminal — núcleo y terminal libre

**Feature**: Terminal de Linux simulada en el navegador, con filesystem virtual e intérprete de órdenes, para practicar los comandos de los objetivos 102, 103 y 105.
**User story**: «Quiero ver qué tan factible es crear un simulador de terminal de Linux para practicar comandos» → alcance sin estructuras de control, elegido tras medir el prototipo.
**Estado**: **Implementada** el 2026-08-26 en `linux_terminal/index.html`. Las decisiones y desviaciones están en [terminal-simulador-nucleo.why.md](terminal-simulador-nucleo.why.md).
**Fecha**: 2026-08-21
**Sub-spec**: 1 de 2. La 2 (`terminal-simulador-ejercicios`) depende de esta.

---

## Origen: el prototipo ya medido

Esta spec no parte de una idea sino de un prototipo con la fidelidad medida, en
la rama `feat/terminal-core-prototype` (commit `9e662f6`):

| Medida | Valor |
|---|---|
| Fidelidad sobre lo implementado | 247/247 casos (100 %) |
| Discrepancias silenciosas | 0 |
| Huecos declarados | 10 |
| Núcleo | 1856 líneas, 31 comandos |
| Referencia | Debian 12, coreutils 9.1, bash 5.2, `LC_ALL=C`, `TZ=UTC` |

El prototipo (`prototype/`) es la base de la implementación, no un descarte. Los
cambios que esta spec le impone están en «Deuda del prototipo».

---

## Decisiones fijas

| Decisión | Valor | Motivo |
|---|---|---|
| Mundo cerrado | Lo no implementado responde `simulador: … no está implementado` | Una salida plausible pero falsa enseña algo incorrecto y el alumno no puede notarlo. Un hueco declarado no enseña nada malo |
| Estructuras de control | Fuera. `for`, `while`, `if` se declaran como hueco | Exigen un intérprete de bloques. El objetivo 3.3 ya lo cubre `linux_shell_scripting/` |
| `ls` sin `-l` | El núcleo devuelve una por línea; la presentación reparte en columnas solo en pantalla | Es lo que hace el `ls` real según si su salida es una terminal. Mantiene válido el banco de fidelidad, que compara la salida entubada |
| Enlaces duros | Se modelan inodos: nombre e inodo son cosas distintas | Sin inodos no se puede explicar por qué `ls -l` cuenta 2, ni por qué borrar un nombre no borra el contenido. Está en los objetivos |
| Opciones | Se cierran los 9 huecos de opciones: `ls -t`, `ls -S`, opciones largas, `cut -c`, `head -c`, `sort -k`, `grep -A/-B/-C` | Decisión del usuario. Cada una son unas líneas y un caso más en el banco |
| Estado del árbol | No persiste. Cada carga arranca en el árbol semilla, con orden de reinicio | Un árbol heredado de una sesión anterior hace que el mismo ejercicio dé resultados distintos. El progreso sí persistirá (sub-spec 2) |
| Fichero | `linux_terminal/index.html`, autocontenido, sin build ni dependencias | Convención del proyecto: funciona como `file://` y en GitHub Pages |
| Núcleo | Puro: sin `document`, `localStorage`, `fetch`, `Date.now` ni `Math.random` | Lo exige la guardia `violacionesDePureza` que ya usa el examen, y es lo que permite probarlo con `node --test` |

---

## Modelo de datos

### `Inodo`

Entidad **nueva**. El cambio de fondo frente al prototipo: el contenido y los
atributos viven en el inodo, y los nombres son referencias a él.

```js
/**
 * @typedef {object} Inodo
 * @property {number} id        Identidad. Dos nombres con el mismo id son un enlace duro.
 * @property {'f'|'d'|'l'|'c'} tipo  Fichero, directorio, enlace simbólico o dispositivo.
 * @property {number} modo      Permisos y bits especiales, 0o0000..0o7777.
 * @property {string} usuario   Nombre del dueño.
 * @property {string} grupo     Nombre del grupo.
 * @property {number} mtime     Segundos desde epoch. Nunca lo pone el reloj: lo pone `estado.ahora`.
 * @property {string} [contenido]  Solo tipo 'f'. Texto completo del fichero.
 * @property {string} [destino]    Solo tipo 'l'. Ruta escrita, sin resolver.
 * @property {Record<string, number>} [hijos]  Solo tipo 'd'. Nombre → id de inodo.
 */
```

### `Sistema`

```js
/**
 * @typedef {object} Sistema
 * @property {Map<number, Inodo>} inodos  Tabla de inodos, indexada por id.
 * @property {number} raiz                Id del inodo de `/`.
 * @property {number} siguienteId         Próximo id a asignar. Es dato, no contador aleatorio.
 */
```

### `Estado`

```js
/**
 * @typedef {object} Estado
 * @property {Sistema} fs
 * @property {string} cwd            Ruta lógica absoluta. No resuelve enlaces.
 * @property {string} usuario
 * @property {string[]} grupos
 * @property {Record<string, number>} uids
 * @property {Record<string, number>} gids
 * @property {number} umask
 * @property {Record<string, string>} entorno
 * @property {number} ahora          Instante actual en segundos. Entra como dato.
 * @property {number} ultimoCodigo   El `$?` del shell.
 */
```

### Invariantes del modelo

1. Todo inodo de la tabla es alcanzable desde `raiz`, salvo durante la ejecución de una orden.
2. `nlink(inodo)` = número de entradas de directorio que lo referencian; para un directorio, más 2 (`.` y su entrada en el padre).
3. Un inodo con `nlink` 0 se elimina de la tabla: es lo que hace que `rm` del último nombre libere el contenido y `rm` de uno de dos no lo libere.
4. Un directorio no admite enlaces duros: solo lo referencia su nombre en el padre.
5. Un enlace simbólico guarda **texto**. Puede apuntar a algo que no existe y seguir existiendo él.
6. `modo` está en `0o0000..0o7777`. Los bits de tipo no viven en `modo`, viven en `tipo`.
7. `mtime` cambia solo por escritura, creación o `touch`. Leer no lo toca.
8. El núcleo nunca consulta el reloj ni el azar: `ahora` y `siguienteId` son datos del estado.

---

## Contratos de API

No hay HTTP. La superficie pública es el módulo del núcleo; los «errores» son
código de salida más texto en el canal de error, como en un shell.

### `estadoInicial({ ahora, usuario }) → Estado`

- **Params**: `ahora: number` (segundos epoch), `usuario?: string` (por omisión `'jorge'`).
- **Response**: `Estado` con el árbol semilla montado.
- **EFECTO**: ninguno fuera del objeto devuelto.
- **ERRORES**: ninguno. Es una función total.

El árbol semilla debe contener, como mínimo, los casos que rompen la fidelidad:
un fichero de más de seis meses (columna de año en `ls -l`), uno sin permiso de
lectura, uno vacío, un directorio vacío, un directorio ilegible, ficheros
ocultos, bits especiales, `/tmp` en 1777, `/dev/null` y `/etc`.

### `ejecutar(estado, linea) → { salida, error, codigo }`

- **Params**: `estado: Estado`, `linea: string` (lo que el usuario escribió).
- **Response**: `{ salida: string, error: string, codigo: number }`. Los textos llevan sus saltos de línea, como los canales de un shell.
- **EFECTO**: muta `estado` igual que lo haría un shell real. Un `cp` de tres ficheros que falla en el segundo deja el primero copiado. Para deshacer, el llamador clona antes.
- **ERRORES**: no lanza nunca. Toda condición se expresa como texto en `error` y código en `codigo`.

Códigos con significado fijo: `0` bien · `1` fallo del comando · `2` error de uso o de sintaxis · `126` no ejecutable · `127` orden inexistente. `grep` usa `1` para «no hay coincidencias» y `2` para «no pude mirar».

### `enColumnas(nombres, anchoTerminal) → string`

- **Params**: `nombres: string[]`, `anchoTerminal: number` (en caracteres).
- **Response**: las mismas entradas repartidas en columnas, rellenando **hacia abajo** primero, con dos espacios de separación y el ancho de la columna igual al nombre más largo. Es el reparto de GNU `ls`.
- **EFECTO**: ninguno. Función pura, vive en el núcleo aunque sea presentación.
- **ERRORES**: ninguno. Con `anchoTerminal` menor que el nombre más largo, una columna.

### `clonar(estado) → Estado`

Copia profunda, incluida la tabla de inodos. Es lo que permite deshacer un
intento y lo que usará el verificador de la sub-spec 2.

### `buscar(estado, ruta, { seguirFinal }) → { inodo, padre, nombre, ruta, error }`

- `seguirFinal: true` (por omisión) resuelve el enlace del último tramo: lo que hace `cat`.
- `seguirFinal: false` devuelve el enlace en sí: lo que hacen `ls -l` y `rm`.
- Los tramos intermedios se resuelven siempre.
- `error` es el errno simbólico: `ENOENT`, `ENOTDIR`, `EACCES`, `ELOOP`.

### `puede(estado, inodo, acceso) → boolean`

`acceso` es `'r'`, `'w'` o `'x'`. Aplica **un solo** bloque de tres bits —dueño,
o grupo, o otros— sin acumular. `root` se salta lectura y escritura, pero para
ejecutar sigue necesitando algún bit `x`.

### Auxiliares puros expuestos

`modoTexto(inodo)` · `calcularModo(actual, spec, esDir)` · `fechaLs(mtime, ahora)`
· `breARegex(patron)` · `expandirLlaves(palabra)` · `expandir(estado, palabra)`
· `IMPLEMENTADOS: string[]`.

---

## Lógica especial

### El intérprete, en cuatro pasos

`trocear` → `parsear` → expandir → ejecutar. Cada paso es una función pura sobre
el resultado del anterior:

1. **Trocear**: palabras y operadores, guardando cada palabra como lista de segmentos con su tipo de comilla. El tipo de comilla, y no la palabra entera, es lo que decide qué se expande después: dentro de `'…'` nada, dentro de `"…"` variables pero no comodines, fuera todo. Tratar la palabra como un bloque hace que `echo '$HOME'` imprima la ruta.
2. **Parsear**: `orden → tubería → lista` con `|`, `&&`, `||`, `;` y las redirecciones `>`, `>>`, `<`, `2>`, `2>>`, `2>&1`.
3. **Expandir**: sustitución de órdenes `$( )`, variables, llaves y comodines, en ese orden. Los comodines se resuelven tramo a tramo, porque el patrón puede llevar comodín en medio.
4. **Ejecutar**: las redirecciones de salida se abren **antes** de correr el comando —bash crea o vacía el fichero al abrirlo— y si no se pueden abrir, el comando no llega a ejecutarse.

### Terminal o tubería

El núcleo produce siempre la salida de una tubería: una entrada por línea. La
capa de presentación decide si la reparte en columnas, y solo lo hace cuando esa
salida va a la pantalla y el comando fue `ls` sin `-l`, `-1` ni `-C`. Ese es el
único punto donde presentación y núcleo difieren, y está aquí escrito para que
no se convierta en dos verdades.

### Fidelidad como parte de la definición de terminado

El banco `prototype/fidelidad.mjs` pasa a `tools/fidelidad.mjs` y forma parte de
las pruebas. Reglas:

- **Discrepancias silenciosas: 0.** Cualquier caso cuya salida difiera de la real sin haberse declarado hueco es un fallo, no un aviso.
- Todo comando u opción nuevos entran con su caso en el banco.
- Los casos que el banco no puede medir se declaran en su propia salida, con el motivo.

---

## Principios SOLID aplicables

| Principio | Aplicación concreta | Riesgo si se viola |
|---|---|---|
| SRP | El núcleo dice **qué** contesta el shell; la presentación, **cómo** se ve. El reparto en columnas es lo único a caballo, y por eso `enColumnas` es una función pura a la que llama la vista, no algo que el comando decida | Si `ls` mira el ancho de la pantalla, el banco de fidelidad deja de poder medirlo y la única garantía del proyecto se cae |
| OCP | Los comandos viven en un registro `COMANDOS[nombre] = fn`. Añadir uno no toca el motor, el parser ni la vista | Un `switch` gigante en el motor convierte cada comando nuevo en un riesgo de regresión en todos los demás |
| DIP | El núcleo recibe el instante (`ahora`), el ancho de terminal y el usuario como datos. No conoce reloj, DOM ni `localStorage` | Sin esto el núcleo no es extraíble ni testeable, y el proyecto pierde el patrón que ya usa el examen |
| ISP | Cada comando recibe exactamente `{ estado, argv, entrada }` y devuelve `{ salida, error, codigo }`. Nada más | Comandos que reciben el estado de la vista acaban pintando, y entonces no se pueden probar sin navegador |

---

## Documentación esperada de funciones públicas

JSDoc en español, como el resto del proyecto. Toda función pública lleva qué
hace —no cómo—, qué representa cada parámetro y qué representa el retorno.

```js
/**
 * Ejecuta una línea completa: tuberías, `&&`, `||` y `;` incluidos.
 *
 * Muta `estado` igual que lo haría un shell de verdad: un `cp` de tres ficheros
 * que falla en el segundo deja el primero copiado. Si hace falta deshacer, el
 * llamador clona antes con `clonar()`.
 *
 * @param {Estado} estado  Estado del shell. Se modifica.
 * @param {string} linea   Lo que el usuario ha escrito, sin el salto final.
 * @returns {{salida:string, error:string, codigo:number}} Los dos canales y el
 *          código de salida de la última orden de la línea.
 */
```

```js
/**
 * Reparte nombres en columnas como lo hace GNU `ls` cuando su salida es una
 * terminal: rellenando hacia abajo primero, con el ancho del nombre más largo.
 *
 * @param {string[]} nombres         Entradas ya ordenadas por el comando.
 * @param {number} anchoTerminal     Ancho disponible, en caracteres.
 * @returns {string} Las entradas en columnas, con salto de línea final.
 */
```

```js
/**
 * Decide si el usuario del estado puede hacer algo sobre un inodo.
 *
 * Aplica la regla que el examen pregunta una y otra vez: el kernel elige un
 * solo bloque de tres bits —dueño, o grupo, o otros— y no los acumula.
 *
 * @param {Estado} estado
 * @param {Inodo} inodo
 * @param {'r'|'w'|'x'} acceso
 * @returns {boolean}
 */
```

---

## Señales de Clean Code a respetar

- [ ] Nombres que expresan intención: `puede(estado, inodo, 'w')`, no `checkPerm(2)`.
- [ ] Cada comando hace una cosa; lo compartido vive en auxiliares (`leerEntradas`, `opciones`, `padreDe`).
- [ ] Sin números mágicos: `BLOQUE`, `SEIS_MESES`, la tabla `ERRNO`, la tabla `TRIOS` de permisos.
- [ ] Los mensajes de error salen de una tabla, no incrustados en cada comando: son parte del contrato de fidelidad.
- [ ] Errores explícitos: ninguna función del núcleo lanza; toda condición viaja en `{error, codigo}`.
- [ ] Ninguna opción se acepta y se ignora. Si no está implementada, se declara.
- [ ] Comentarios que explican **por qué**, no qué: el porqué del orden de apertura de las redirecciones, el porqué de los inodos.

---

## Máquina de estados del frontend

Estados: `listo` · `ejecutando` · `reiniciando`.

| Desde | Evento | Hasta |
|---|---|---|
| `listo` | Enter con línea no vacía | `ejecutando` |
| `listo` | ↑ / ↓ | `listo` (se mueve el índice del historial) |
| `ejecutando` | la orden termina | `listo` (se imprime y se baja el prompt) |
| `listo` | orden de reiniciar | `reiniciando` |
| `reiniciando` | árbol semilla montado | `listo` (pantalla e historial limpios) |

Estado optimista: **no**. Todo es sincrónico y la salida se conoce antes de
pintarla; no hay nada que adelantar.

Detalles de la vista: historial de líneas navegable con ↑/↓, `Ctrl+L` limpia la
pantalla, `Ctrl+C` descarta la línea en curso, el prompt muestra usuario, ruta
lógica abreviada con `~` y `$`. Sin autocompletado con Tab en esta sub-spec.

---

## Invariantes del sistema

| # | Invariante |
|---|---|
| 1 | El banco de fidelidad termina con **cero** discrepancias silenciosas. Una sola es un fallo de la suite |
| 2 | Todo lo no implementado responde con un mensaje que empieza por `simulador: ` |
| 3 | El núcleo pasa la guardia `violacionesDePureza`: ni navegador, ni reloj, ni azar |
| 4 | La página funciona abierta como `file://`, sin red |
| 5 | Cada carga arranca en el mismo árbol semilla: dos alumnos con la misma orden ven lo mismo |
| 6 | Ninguna entrada del usuario, por absurda que sea, lanza una excepción |
| 7 | Todos los enlaces internos son relativos: la publicación cuelga de `/Lixnux-exam-test/` |

---

## Impacto en archivos existentes

| Archivo | Cambio | Capa |
|---|---|---|
| `linux_terminal/index.html` | NUEVO | UI + núcleo |
| `tools/fidelidad.mjs` | NUEVO (viene de `prototype/fidelidad.mjs`) | pruebas |
| `tests/terminal.test.mjs` | NUEVO (viene de `prototype/terminal-core.test.mjs`) | pruebas |
| `tools/extract-core.mjs` | modificado: la ruta `lpi_practice_exam/index.html` está fija en la línea 16 y hay que parametrizarla para poder extraer el núcleo de una segunda página | herramientas |
| `index.html` | modificado: tarjeta nueva con `data-kind="term"` y su color en `:root` y en los dos bloques de tema oscuro | UI |
| `README.md` | modificado: sección nueva y fila en la tabla de contenido y en la de publicación | documentación |
| `prototype/` | se elimina al integrarse: su contenido pasa a `linux_terminal/`, `tools/` y `tests/` | — |

**Riesgo de conflicto**: la rama `docs/system-files` está sin fusionar en `main` y
toca los mismos dos ficheros compartidos —`index.html` (tarjeta y token `--files`
en `:root` y en los dos bloques de tema oscuro) y `README.md`—. Conviene
fusionarla antes de empezar, o resolver el conflicto a mano en esas dos zonas.

---

## Deuda del prototipo que esta spec liquida

| Qué | Por qué |
|---|---|
| Nodos anidados → tabla de inodos | Sin inodos no hay enlaces duros ni `nlink` de verdad |
| `ls` en columnas en la presentación | Decisión tomada: realismo en pantalla, fidelidad medible en la tubería |
| Nueve opciones que hoy son hueco | `ls -t`, `ls -S`, opciones largas, `cut -c`, `head -c`, `sort -k`, `grep -A/-B/-C` |
| `tools/extract-core.mjs` con la ruta fija | Impide extraer el núcleo de una segunda página |
| El núcleo es un `.mjs` suelto | Tiene que acabar dentro del HTML, entre los marcadores `NUCLEO PURO`, con el extractor generando el módulo de pruebas |

---

## Fuera de scope (explícito)

- **Estructuras de control**: `for`, `while`, `until`, `if`, `case`. Se detectan como palabras reservadas y se declaran como hueco. `test` y `[` sí están, porque son comandos y no sintaxis.
- **`wc -L`**: único hueco de opción que se mantiene.
- **Procesos**: `ps`, `top`, `kill`, `jobs`, `&`. Son objetivo 104, y este simulador cubre 102, 103 y 105.
- **`man` y las páginas de manual**: exigirían escribir un manual, no simularlo.
- **Heredocs (`<<`), alias, `su`, `sudo`, `export -p`, sustitución de procesos.**
- **Autocompletado con Tab.**
- **Edición de ficheros**: `nano` y `vi` los cubre ya `linux_shell_scripting/`.
- **Varios usuarios simultáneos**: hay un usuario y `root`, sin cambiar de sesión.
- **Ejercicios, verificación y progreso**: son la sub-spec 2, `terminal-simulador-ejercicios`.
- **Red**: nada de `ping`, `ip`, `ssh`, `curl`.

---

## Próximos pasos del pipeline

1. `/impact` — zonas afectadas por el cambio a inodos y por parametrizar el extractor
2. `/arch` — dónde vive cada capa dentro de un único HTML, y los marcadores del núcleo
3. `/tdd-plan` — plan Red/Green/Refactor del núcleo, con el banco de fidelidad como red
4. `/tdd-plan-ui` — plan de la terminal: prompt, historial, columnas, reinicio
5. `/why` — motivo de cada cambio relevante
