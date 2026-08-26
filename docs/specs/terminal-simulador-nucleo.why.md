# Why: Simulador de terminal — núcleo y terminal libre

**Feature**: Terminal de Linux simulada en el navegador, con filesystem virtual e intérprete de órdenes, para practicar los comandos de los objetivos 102, 103 y 105.
**Pipeline**: [spec](terminal-simulador-nucleo.spec.md) → implementación (los pasos intermedios se saltaron: la spec ya traía modelo de datos, contratos e invariantes, y el prototipo medido hacía de `/impact`)
**Fecha**: 2026-08-26
**Sub-spec**: 1 de 2. La 2 ([ejercicios](terminal-simulador-ejercicios.spec.md)) sigue en Draft.

---

## Por qué este feature

Las seis páginas anteriores explican y preguntan de opción múltiple. Ninguna deja
**hacer**. El examen mide comandos, permisos y redirección, y eso no se aprende
leyendo una tabla: se aprende escribiendo `chmod 750 dir` y viendo qué contesta el
sistema. Sin una máquina Linux delante, la única alternativa es un simulador.

## La decisión que define el feature

**Mundo cerrado: lo que no está implementado se declara.** Cada hueco responde con
un mensaje que empieza por `simulador:` y termina en código 2.

El motivo es pedagógico, no técnico. Un simulador que ante `ls -S` imprime la lista
sin ordenar enseña algo falso, y el alumno **no tiene forma de notarlo**: la salida
es plausible. Un hueco declarado no enseña nada malo. De ahí la única cifra del
proyecto que no puede subir de cero: **discrepancias silenciosas**.

La consecuencia práctica es que ninguna opción se acepta y se ignora. Nueve
opciones que el prototipo aceptaba sin hacerles caso —`-v`, `-i` de varios
comandos, `cat -A`— eran mentiras silenciosas: unas se implementaron y otras
pasaron a ser huecos declarados, pero ninguna quedó a medias.

## Decisiones de implementación

### La tabla de inodos, y no un árbol de nodos anidados

**Qué**: `Sistema` es `{inodos: Map<number, Inodo>, raiz, siguienteId}`, y un
directorio guarda `nombre → id`, no `nombre → nodo`.
**Por qué**: sin separar el nombre del contenido no se puede explicar por qué
`ls -l` cuenta 2, ni por qué `rm` de uno de dos nombres no borra el fichero. Son
materia de examen, y el prototipo no podía con ellas.
**Cómo se decide cuándo muere un inodo**: el recuento de enlaces **se deriva**
recorriendo la tabla (`cuantosNombres`), no se guarda en un campo. Un contador
guardado se desincroniza del árbol en el primer `mv` que se escriba mal; lo
derivado no puede mentir. El árbol es pequeño —decenas de inodos—, así que el
coste no se nota.

### El reparto en columnas vive en el núcleo, aunque sea presentación

**Qué**: `enColumnas(nombres, ancho)` y `lsDePantalla(linea)` son funciones puras
del núcleo; la vista las llama.
**Por qué**: `ls` real imprime una entrada por línea cuando su salida va a una
tubería y en columnas cuando va a una terminal. El banco de fidelidad compara la
salida entubada, así que el núcleo tiene que producir esa. Si además `ls` mirara el
ancho de la pantalla, el banco dejaría de poder medirlo y el proyecto perdería su
única garantía. Poniendo la regla en una función pura hay **una** verdad, escrita
en un sitio, y se puede probar sin navegador (pruebas V1 y V2).

### Ejecutar por ruta se resuelve, pero no se ejecuta

**Qué**: `./nada` da 127, `./notas.txt` da 126 con «Permission denied»,
`./proyectos` da 126 con «Is a directory», y `./script.sh` —que sí se podría
ejecutar— declara el hueco.
**Por qué**: el prototipo contestaba `command not found` a `./script.sh`, que es
**falso**: el fichero está ahí. Los códigos 126 y 127 son materia de examen y la
diferencia entre ellos es justo lo que se pregunta. Ejecutar el script de verdad
exigiría interpretar el fichero entero, con sus `for` y sus `$1`, que están fuera
de alcance.
**Efecto secundario**: el árbol necesitaba `/usr/bin` con los programas y `/bin`
como enlace, porque `type ls` promete `/usr/bin/ls` y antes ese fichero no existía.

### La barra invertida dentro de comillas dobles

**Qué**: `"\$HOME"` imprime `$HOME`, y el carácter escapado pasa a un segmento que
no se expande.
**Por qué**: el troceado guarda cada palabra como segmentos con su tipo de comilla
—la decisión que el prototipo ya había pagado para que `echo '$HOME'` no imprimiera
la ruta—. Faltaba el escape dentro de dobles, que bash sí aplica a `$`, `` ` ``,
`"` y a sí misma. Lo encontró el banco, no la lectura del código.

### Los bytes se cuentan como UTF-8

**Qué**: `bytesDe()` en lugar de `cadena.length` para `ls -l`, `wc -c` y `wc -m`.
**Por qué**: `ls -l` informa bytes. Con la longitud de la cadena de JavaScript, en
cuanto alguien escribiera `echo añón > f` el tamaño saldría mal. `cut -c` y
`head -c` declaran el hueco si el texto no es ASCII: recortar por bytes partiría un
carácter por la mitad, y eso no se puede representar en una cadena de JavaScript.

## Lo que encontró el banco de fidelidad

Ninguno de estos fallos se ve leyendo el código, y todos habrían enseñado algo
falso. Van además de los trece que ya encontró el prototipo.

| Hallazgo | Por qué importaba |
|---|---|
| `cp` aplica la umask al modo del original | `cp` de un fichero en 777 con `umask 022` da 755, no 777 |
| `ln` no dereferencia | Un enlace duro a un enlace simbólico enlaza **el enlace**, no su destino |
| `rm -r` de un directorio ilegible **vacío** funciona | Basta quitar el nombre; solo falla si hay algo dentro que enumerar |
| `cut -f1` se rechazaba por un `Number('') === 0` | Un rango sin extremo no es el campo cero |
| En `head -c -20` el número es el valor de `-c` | Se estaba leyendo como el atajo `-5` de `-n` |
| `mv` de un enlace simbólico mueve el enlace | El prototipo movía el destino |
| Un enlace roto sí lo encuentra un comodín | `echo r*` lo lista; el prototipo lo escondía |
| `--` separa grupos de contexto también entre ficheros | Y el separador de una línea de contexto es `-`, no `:` |
| El ancho de `wc` lo fija el recuento de bytes | Ya estaba, pero `-m` y `-c` son dos columnas, no una |

## Desviaciones del spec

| Desviación | Motivo | Impacto |
|---|---|---|
| `-v` (verbose) e `-i` (interactive) pasan a huecos declarados | El prototipo los aceptaba y no hacía nada: `rm -v` no imprimía `removed 'f'` y `rm -i` borraba sin preguntar. No se pueden simular preguntas sin terminal interactiva | bajo |
| Se implementan además `cat -A/-E/-T`, `echo -e/-E`, `tr -s`, `rmdir -p`, `cp -n/-p`, `sort -b`, `head/tail -v`, `wc -m` | Todas estaban aceptadas y no hacían nada. Cerrarlas era la única alternativa a declararlas | bajo |
| `/usr/bin`, `/usr/local/bin` y `/bin` (enlace) en el árbol semilla | `type ls` prometía un fichero que no existía; ver la decisión de ejecutar por ruta | bajo |
| `ls -C` sigue siendo hueco, aunque la spec lo nombre al hablar de columnas | GNU `ls -C` rellena con **tabuladores**, no con espacios; implementarlo sin modelar el tabulado sería una discrepancia silenciosa. La regla de la vista sigue escrita tal cual | bajo |
| Las pruebas se parten en `tests/terminal.test.mjs` y `tests/terminal-ui.test.mjs` | La vista no se puede extraer: su razón de ser es hablar con el navegador. Es el mismo patrón que `tests/browser-stub.mjs` en el examen | bajo |
| 42 pruebas nuevas en vez de un solo archivo previsto | Los inodos, el reparto en columnas y la máquina de estados de la vista no estaban cubiertos por nada | bajo |
| El banco pasa de 257 a 387 casos | Toda opción nueva entra con su caso, y los huecos entran también para que se declaren | bajo |

## Riesgos aceptados

1. **Una sola distribución de referencia.** Debian 12, coreutils 9.1, bash 5.2,
   `LC_ALL=C`, `TZ=UTC`. Otra versión de coreutils podría diferir en algún mensaje,
   y el banco solo sabe medir contra la máquina donde se ejecuta.
2. **El mundo no tiene procesos ni red.** Un alumno que escriba `ps` recibe un
   hueco declarado. Es objetivo 104 y está fuera de esta spec, pero la primera
   reacción de quien abre una terminal puede ser precisamente eso.
3. **El árbol no persiste.** Es deliberado —dos alumnos con la misma orden tienen
   que ver lo mismo—, pero significa que recargar la pestaña por accidente borra
   el trabajo. El botón de reiniciar lo hace explícito; el accidente, no.
4. **`ls -C` y `ls -R` son huecos** en la orden que más se teclea. Se declaran,
   así que nadie aprende nada falso, pero es la fricción más probable.

## Deuda técnica

| # | Descripción | Prioridad |
|---|---|---|
| 1 | Ejercicios verificados sobre el árbol: es la sub-spec 2, y el diferenciador real del feature | su propio spec, ya escrito |
| 2 | `ls -C` con tabulado, `ls -R` y `ls -i` | cuando haya un caso de banco que los mida |
| 3 | Autocompletado con Tab | siguiente ciclo de la vista |
| 4 | Ejecutar scripts del árbol; exige el intérprete de bloques, que es también lo que falta para `for` e `if` | junto con el objetivo 3.3 |
| 5 | El banco tarda ~40 s porque materializa el árbol en disco una vez por caso | cuando estorbe |
