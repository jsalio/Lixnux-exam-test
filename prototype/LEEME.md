# Prototipo del núcleo del simulador de terminal

Prototipo para **medir la fidelidad real** antes de especificar nada. No tiene
interfaz y no es la versión final: es la respuesta a la pregunta «¿se puede
simular un shell con la suficiente exactitud como para estudiar con él?».

| Fichero | Qué es | Líneas |
|---|---|---|
| `terminal-core.mjs` | El núcleo: VFS, permisos, shell y 31 comandos | 1856 |
| `fidelidad.mjs` | Banco que compara contra coreutils y bash reales | 343 |
| `terminal-core.test.mjs` | Pruebas de lo que el banco no puede ver | 213 |

```bash
node prototype/fidelidad.mjs        # medir la fidelidad
node prototype/fidelidad.mjs -v     # con el detalle de cada discrepancia
node --test prototype/              # pruebas unitarias
```

---

## Resultado

Medido contra Debian 12, coreutils 9.1 y bash 5.2, con `LC_ALL=C` y `TZ=UTC`:

```
Fidelidad sobre lo implementado: 247/247 (100.0%)
Cobertura del banco:             247/257 (96.1%)
Huecos declarados:               10   ·   Discrepancias silenciosas: 0
```

Las dos cifras miden cosas distintas y no hay que mezclarlas:

- **Fidelidad**: de lo que el simulador dice saber hacer, cuánto coincide
  carácter a carácter con el sistema real —salida, error y código de salida—.
- **Cobertura**: cuánto del banco sabe hacer. Los 10 casos que faltan son
  **huecos declarados**: el simulador responde `simulador: … no está
  implementado` en vez de inventarse una salida.

La distinción es el criterio de diseño de todo el prototipo. Una salida
plausible pero falsa enseña algo incorrecto y el alumno no tiene forma de
saberlo; un hueco declarado no enseña nada malo. Por eso **discrepancias
silenciosas: 0** es la única cifra que no puede subir de cero.

### Método

El banco monta el mismo árbol de ficheros dos veces —uno virtual y uno real en
un directorio temporal, con los mismos modos y las mismas fechas—, ejecuta la
misma línea en los dos y compara. Cada caso parte de un árbol limpio, así que
los que modifican ficheros no se contaminan entre sí.

257 casos en 28 grupos, de los cuales cuatro grupos (`duras-*`) están escritos
para romper el simulador, no para lucirlo.

---

## Lo que encontró el banco

Esta es la parte que justifica el esfuerzo: ninguno de estos fallos se ve
leyendo el código, y todos habrían enseñado algo falso.

| Hallazgo | Por qué importa |
|---|---|
| Las comillas simples expandían variables | `echo '$HOME'` imprimía la ruta. El entrecomillado es materia de examen: era la mentira más grave del prototipo |
| `wc` alinea columnas al ancho de los **bytes** contados, no del número impreso | `wc -l f` da `3` pero `wc -lw f` da ` 3  6`. Nadie lo adivina |
| `ls -lh` humaniza también la línea `total` | `total 36K`, no `total 36` |
| `ls -l` de un directorio vacío imprime `total 0` | Parecía que no debía imprimir nada |
| La redirección se abre **antes** de ejecutar | `chmod 400 f && echo x > f` no imprime la `x` en ningún sitio. El simulador la imprimía por pantalla |
| `head -n -1` y `tail -n +2` | Acertaban por casualidad en ficheros de tres líneas y fallaban en el resto |
| `sort -n` rompe empates comparando la línea entera | Un CSV con cabecera salía en un orden que no era el real |
| `find -maxdepth` corta antes de bajar | Daba un `Permission denied` que el `find` real no da |
| `cd` es lógico, no resuelve enlaces | Tras `cd enlace`, `pwd` dice el enlace |
| `ls pd` sigue el enlace, `ls -l pd` no | El formato largo cambia qué se pregunta |
| En BRE, `+` `?` `|` son literales | `grep 'o+'` busca una `o` y un `+`. Con RegExp de JS habría buscado otra cosa |
| `mkdir -m 750` se ignoraba en silencio | Aceptaba la opción y creaba el directorio con la umask. Lo encontró una prueba unitaria, no el banco |
| `rm -rf /` reventaba el núcleo | Excepción de JavaScript al desreferenciar el padre de la raíz |

---

## Huecos declarados

Lo que el prototipo sabe que no sabe:

- **Estructuras de control**: `for`, `while`, `if`/`then`/`fi`. Se detectan como
  palabras reservadas y se declaran. `test` y `[` sí están, porque son comandos.
- **Opciones**: `ls -lt`, `ls -S`, `ls --all` (opciones largas), `cut -c`,
  `sort -k`, `grep -A/-B/-C`, `wc -L`, `head -c`.
- **Enlaces duros** (`ln` sin `-s`).

### Lo que esto significa para el alcance

Las estructuras de control son el hueco caro, y son justo el objetivo **3.3
«Turning Commands into a Script»**, que con peso 4 es el de mayor puntuación
individual del examen. Todo lo demás del prototipo —VFS, permisos, tuberías,
redirección, comodines, códigos de salida— ha salido a coste bajo y con
fidelidad completa. Añadir `for` e `if` es pasar de interpretar líneas a
interpretar un lenguaje con bloques, y es una decisión de alcance, no un
detalle: la página de scripting ya existente necesita exactamente eso.

Las opciones que faltan son baratas y aditivas: cada una es un caso más en el
banco y unas líneas en su comando.

---

## Lo que el banco no puede medir

Declarado en la propia salida del programa, para que no se confunda con éxito:

- **`ls -la` en la raíz del sandbox**: el dueño de `..` es `root` en el mundo
  virtual y no se puede reproducir sin ser root.
- **`cd / && pwd`**: la raíz real no es la del sandbox.
- **`ls -l /dev/null`** y **`id`**: dependen del sistema anfitrión.
- **Nada que requiera root**: el banco corre como usuario normal.
- **La disposición en columnas de `ls`**: se compara la salida por tubería, que
  va a una línea por fichero. En una terminal de verdad `ls` imprime en
  columnas. Es una decisión pendiente de la interfaz, no del núcleo.
- **Una sola distribución**: Debian 12 / coreutils 9.1 / bash 5.2. Otra versión
  de coreutils podría diferir en algún mensaje.

---

## Encaje con el proyecto

- **El núcleo es puro** según la guardia que ya usa el examen: la prueba `P1`
  importa `violacionesDePureza` de `tools/extract-core.mjs` y comprueba que el
  núcleo no toca `document`, `localStorage`, `fetch`, `Date.now` ni
  `Math.random`. El instante actual entra como dato (`estado.ahora`), igual que
  en el núcleo del examen. Eso es lo que permitirá inlinarlo en un HTML de una
  sola pieza que funcione como `file://`.
- **Pendiente**: `tools/extract-core.mjs:16` tiene la ruta
  `lpi_practice_exam/index.html` fija. Para extraer y probar el núcleo de una
  página nueva hay que parametrizarla.
- **Los ejercicios se pueden corregir sobre el árbol**, no sobre el texto
  tecleado. La prueba `E1` lo demuestra: cuatro formas distintas de crear
  `/tmp/logs` con modo 750 —`chmod` octal, `mkdir -m`, `chmod` simbólico y
  `umask`— dejan el mismo estado y las cuatro se dan por buenas. Un verificador
  que comparase cadenas rechazaría tres de ellas.
