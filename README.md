# LPI Linux Essentials (010-160) — Material de estudio

Conjunto de aplicaciones web autocontenidas para preparar la certificación
**LPI Linux Essentials 010-160** (objetivos oficiales v1.6).

Todo el proyecto son ficheros HTML estáticos: sin dependencias externas, sin
build, sin backend. Se abren directamente en el navegador y funcionan sin
conexión.

---

## Contenido del repositorio

| Ruta | Qué es |
|---|---|
| `index.html` | Portada: navega a las ocho páginas |
| `lpi_practice_exam/index.html` | Simulador de examen bilingüe con banco de 242 preguntas |
| `linux_terminal/index.html` | Terminal de Linux simulada, con filesystem virtual e intérprete de órdenes |
| `sample_linux_permissions/index.html` | Guía interactiva de permisos de Linux con calculadora |
| `linux_special_directories/index.html` | Guía interactiva de la jerarquía de directorios |
| `linux_system_files/index.html` | Guía interactiva de los ficheros de configuración de `/etc` |
| `linux_basic_commands/index.html` | Guía breve de comandos y de cómo se encadenan |
| `linux_shell_scripting/index.html` | Guía del objetivo 3.3: de comandos sueltos a script de Bash |
| `linux_networking/index.html` | Guía del objetivo 4.4: comandos de red, de `ip a` a `scp` |
| `docs/specs/` | Especificaciones SDD: una implementada y dos en estado *Draft* |
| `tools/` | Extractor del núcleo y banco de fidelidad |
| `tests/` | Pruebas con `node --test`, sin dependencias |

Cada aplicación vive en su propia carpeta con un `index.html`, de modo que su URL
es el directorio. La portada enlaza a todas y todas enlazan de vuelta a la portada.

---

## 1. Simulador de examen — `lpi_practice_exam/index.html`

### Modos

| Modo | Preguntas | Tiempo | Orden |
|---|---|---|---|
| **Simulacro de examen** | 40 aleatorias | 60 min, envío automático al agotarse | Aleatorio |
| **Banco completo (estudio)** | 242 (todas) | Sin límite | Por tema (101 → 105) |

El simulacro respeta el reparto por tema del examen oficial:

| Tema | Título | Banco | Simulacro |
|---|---|---|---|
| 101 | La comunidad Linux y una carrera en Open Source | 39 | 7 |
| 102 | Encontrar tu camino en un sistema Linux | 45 | 8 |
| 103 | El poder de la línea de comandos | 58 | 10 |
| 104 | El sistema operativo Linux | 51 | 8 |
| 105 | Seguridad y permisos de archivos | 49 | 7 |
| | **Total** | **242** | **40** |

### Tipos de pregunta

- **Respuesta única** (216): una sola opción correcta.
- **Selección múltiple** (14): se exige el conjunto exacto; todo o nada, sin puntuación parcial.
- **Escribir el comando** (12): se ignoran mayúsculas/minúsculas y espacios extra; se aceptan variantes equivalentes.

### Calificación

- Umbral de aprobación: **65 %** de respuestas correctas.
- Junto al porcentaje real se muestra una equivalencia aproximada en la escala
  oficial 200–800 (500 = aprobado). LPI no publica su fórmula de conversión, por
  lo que la equivalencia es orientativa: se interpola linealmente el 65 % al valor 500.

### Funcionalidades

- **Bilingüe**: conmutador ES + EN / ES / EN, aplicado a enunciados, opciones y explicaciones.
- **Persistencia local**: el intento en curso se guarda en `localStorage`
  (clave `lpi-010-160-attempt-v1`) y puede reanudarse o descartarse al volver.
- **Marcar preguntas** para revisarlas después, con cuadrícula de navegación que
  distingue respondidas, marcadas y actual.
- **Revisión posterior** con la explicación de cada pregunta y filtros:
  todas / incorrectas / sin responder / marcadas.
- **Desglose por tema** en el resultado.
- **Imprimir / PDF** del resultado.
- **Tema claro y oscuro** automático según `prefers-color-scheme`.
- **Atajos de teclado**: `←` / `→` navegar, `1`–`9` seleccionar opción, `M` marcar.

### Estructura interna

El banco de preguntas vive en un `<script>` propio delimitado por el marcador
`<!-- @@BANCO@@ -->`, separado de la lógica de la aplicación. Cada pregunta es un
objeto con la forma:

```js
{ id, topic, type: 'single'|'multi'|'fill',
  q:  [es, en],            // enunciado
  o:  [[es, en], ...],     // opciones (vacío en 'fill')
  a:  [índices correctos],
  ex: [es, en] }           // explicación
```

Las opciones se barajan por intento (`oidx` guarda el orden mostrado), de modo que
la posición correcta cambia en cada ejecución.

---

## 2. Terminal simulada — `linux_terminal/index.html`

Un shell de Linux con su propio sistema de ficheros, para practicar los comandos
de los objetivos **102** (encontrar tu camino), **103** (la línea de comandos) y
**105** (permisos) sin tocar la máquina de verdad.

### El principio: mundo cerrado

Lo que el simulador no sabe hacer **lo declara** con un mensaje que empieza por
`simulador:`; nunca se inventa una salida. Una respuesta plausible pero falsa
enseñaría algo incorrecto sin que el alumno tenga forma de notarlo; un hueco
declarado no enseña nada malo.

### Qué hay dentro

- **31 órdenes**: `ls`, `cd`, `pwd`, `cat`, `head`, `tail`, `wc`, `grep`, `sort`,
  `uniq`, `cut`, `tr`, `find`, `mkdir`, `rmdir`, `touch`, `rm`, `cp`, `mv`,
  `chmod`, `umask`, `ln`, `id`, `whoami`, `type`, `test` / `[`, `echo`, `export`,
  `true`, `false`.
- **Intérprete**: tuberías, `&&`, `||`, `;`, redirecciones `>`, `>>`, `<`, `2>`,
  `2>>`, `2>&1`, comodines, llaves, entrecomillado simple y doble, sustitución de
  órdenes `$( )`, variables y `$?`.
- **Inodos de verdad**: el nombre y el contenido son cosas distintas, así que
  `ln` sin `-s` crea un enlace duro, `ls -l` cuenta 2 y borrar un nombre no borra
  el fichero mientras quede otro.
- **Permisos**: los nueve bits, `setuid`, `setgid`, *sticky*, `umask`, y la regla
  de que el kernel aplica **un solo** bloque de tres bits.
- **Un árbol coherente**: `/home/jorge` con ficheros preparados —uno ilegible,
  uno vacío, uno de hace diez meses, ocultos, un directorio cerrado, un script
  con `setuid`—, `/tmp` en 1777, `/dev/null`, `/etc` y los programas en
  `/usr/bin`, con `/bin` como enlace, igual que en Debian 12.
- **Interfaz**: historial con ↑ / ↓, `Ctrl+L` para limpiar, `Ctrl+C` para
  descartar la línea, y un botón que devuelve el árbol al estado de partida.

### Fuera de alcance, y por qué

| Qué | Por qué |
|---|---|
| `for`, `while`, `if`, `case` | Exigen interpretar bloques, no líneas. El objetivo 3.3 lo cubre la guía de scripting |
| `ps`, `kill`, `top`, `jobs` | No hay procesos. Son objetivo 104 |
| `man` | Habría que escribir el manual, no simularlo |
| `nano`, `vi` | Editar ficheros se practica en la guía de scripting |
| `ping`, `ip`, `ssh` | No hay red. Objetivo 4.4, cubierto por la guía de red |
| `wc -L`, `ls -R`, `ls -C`, `ls -i`, `-v`, `-i` | Opciones sin implementar; se declaran una a una |
| Ejecutar `./script.sh` | El fichero se ve, y con él su `126` o su `127`, pero no se ejecuta: haría falta interpretar el script |

### Fidelidad medida, no prometida

El banco `tools/fidelidad.mjs` monta el mismo árbol dos veces —uno virtual y uno
real en un directorio temporal, con los mismos modos y las mismas fechas—,
ejecuta la misma línea en los dos y compara salida, error y código de salida
carácter a carácter:

```bash
node tools/fidelidad.mjs        # resumen
node tools/fidelidad.mjs -v     # el detalle de cada discrepancia
node tools/fidelidad.mjs grep   # solo un grupo de casos
```

Medido contra Debian 12, coreutils 9.1 y bash 5.2, con `LC_ALL=C` y `TZ=UTC`:

```
Fidelidad sobre lo implementado: 360/360 (100.0%)
Cobertura del banco:             360/387 (93.0%)
Huecos declarados:               27   ·   Discrepancias silenciosas: 0
```

Las dos cifras miden cosas distintas: **fidelidad** es cuánto de lo que el
simulador dice saber hacer coincide con el sistema real; **cobertura** es cuánto
del banco sabe hacer. La diferencia son huecos declarados. **Discrepancias
silenciosas: 0** es la única cifra que no puede subir de cero.

El banco declara también lo que no puede medir (los números de inodo reales, el
dueño de `..`, el `/dev/null` del anfitrión, el reparto en columnas), para que no
se confunda con éxito.

### Estructura interna

El núcleo vive dentro del HTML, entre los marcadores `NUCLEO PURO`, y no toca
`document`, el almacenamiento, la red, el reloj ni el azar: el instante actual
entra como dato (`estado.ahora`) y los identificadores de inodo son un contador
del estado. `tools/extract-core.mjs` lo extrae a un módulo ES para poder probarlo
con `node --test`, y falla si alguien mete una dependencia del navegador dentro
de la región.

```bash
node --test tests/               # 105 pruebas: núcleo del examen, núcleo del shell y vista
node tools/extract-core.mjs      # extrae los núcleos de las dos páginas
```

La única diferencia entre lo que dice el núcleo y lo que se ve en pantalla es el
reparto de `ls` en columnas: el núcleo entrega siempre una entrada por línea
—como `ls` real cuando su salida va a una tubería— y la vista lo reparte con
`enColumnas()` cuando la orden era un `ls` sin opciones de formato.

---

## 3. Guía de permisos — `sample_linux_permissions/index.html`

Página explicativa de una sola pieza sobre el modelo de permisos de Linux, con
índice lateral y una calculadora interactiva.

Secciones: anatomía de `ls -l`, significado de `rwx` en ficheros y en directorios,
cómo el kernel elige un único bloque (usuario / grupo / otros), notación octal,
**calculadora de permisos** (octal ↔ simbólico + comando `chmod` resultante y bits
especiales), modo simbólico, dueño y grupo, `setuid` / `setgid` / *sticky bit*,
`umask`, errores típicos y una chuleta final.

La calculadora no guarda estado: es puramente cliente y sin almacenamiento.

---

## 4. Guía de directorios — `linux_special_directories/index.html`

Página sobre la jerarquía del sistema de archivos (FHS) y, sobre todo, sobre los
directorios que no viven en ningún disco.

- **Explorador de la raíz**: los 18 directorios de `/`, filtrables por naturaleza
  (en disco / generado en memoria / enlace simbólico). Cada uno muestra qué
  guarda, sus permisos reales, si sobrevive a un reinicio y los comandos que lo abren.
- **Visor de ficheros virtuales**: `/proc/uptime`, `/proc/meminfo`, `/proc/cpuinfo`,
  `/proc/1/cmdline`, `/proc/mounts`, `/sys/class/net/…/operstate` y otros, con la
  salida real capturada en una Debian con kernel 6.1 y una nota de qué significa.
- **Permisos de los directorios especiales**: qué decisión codifica el modo de
  `/tmp` (1777), `/root` (700), `/proc` (555), `/dev/sda` (`root:disk`) o
  `/etc/shadow` (`root:shadow`). Enlaza con la guía de permisos.
- **Qué sobrevive a un reinicio** y por qué `/tmp` y `/var/tmp` no son lo mismo.
- **Ocho preguntas** de autoevaluación con opciones barajadas y explicación.

---

## 5. Guía de ficheros del sistema — `linux_system_files/index.html`

Los ficheros de configuración que el examen da por conocidos, leídos campo a campo.
Cubre los temas 104 y 105 en la parte que no son permisos sino formato: quién eres,
a qué grupos perteneces, qué se monta y cómo se resuelve un nombre.

- **Disector de líneas** (interactivo): ocho ficheros con una línea real troceada
  campo a campo —`/etc/passwd`, `/etc/shadow`, `/etc/group`, `/etc/gshadow`,
  `/etc/fstab`, `/etc/hosts`, `/etc/crontab` y `/etc/sudoers`—. Cada campo se pulsa
  y se resalta a la vez en la línea y en la leyenda, con lo que significa y por qué
  está ahí. Los campos vacíos se muestran como tales, porque en estos ficheros
  «vacío» significa «sin límite».
- **Por qué passwd y shadow son dos ficheros**: la obligación de que `/etc/passwd`
  sea legible por todos, los cuatro valores posibles del campo de contraseña
  (`$6$…`, `!`, `*`, vacío) y los rangos de UID con su origen en `/etc/login.defs`.
- **Explorador de ficheros** (interactivo): 23 rutas filtrables por tema
  (cuentas / red / sistema / entorno / registros), cada una con sus permisos
  reales, su formato y las órdenes que la consultan.
- **Grupos**: la diferencia entre primario (cuarto campo de `passwd`) y secundarios
  (cuarto campo de `group`), y por qué tu nombre no aparece en la línea de tu propio
  grupo. Tabla de los grupos que conceden privilegios: `adm`, `disk`, `sudo`,
  `shadow`, `docker`.
- **Visor de consultas** (interactivo): doce órdenes con su salida real capturada en
  una Debian 12 —`id`, `getent`, `chage -l`, `passwd -S`, `awk -F:`, `sudo -l`—
  incluida la de `wc -l /etc/shadow` fallando con *Permission denied*.
- **No los edites con nano**: `vipw`, `vigr`, `visudo`, `gpasswd`, `chage`,
  `mount -a`, y el error clásico de `usermod -G` frente a `-aG`.
- **Doce preguntas** de autoevaluación con opciones barajadas y explicación.
- **Chuleta** final.

El hash de contraseña que aparece en el disector es inventado; el resto de las
líneas y todas las salidas del visor son reales.

---

## 6. Guía de comandos — `linux_basic_commands/index.html`

Guía deliberadamente breve: siete secciones cortas en lugar de un manual.
El foco no es la lista de comandos sino cómo se combinan.

- **Anatomía de una orden** (interactivo): 10 órdenes reales troceadas en
  comando / opciones / argumentos / tubería, con qué aporta cada pieza y por qué
  esa línea se escribe así. Incluye los casos que rompen la regla, como `find`.
- **Moverse y mirar**, **crear y borrar**, **buscar**: tablas de comando, para qué
  sirve y cómo se usa en la práctica, no la lista completa de sus opciones.
- **Tuberías y redirección**: `|`, `>`, `>>`, `2>`, `<` y el idioma
  `sort | uniq -c | sort -nr | head`.
- **Procesos** y **ayuda** (`man`, `--help`, `apropos`, `type`).
- **Chuleta** con los atajos de teclado del shell.

---

## 7. Guía de scripting — `linux_shell_scripting/index.html`

El objetivo **3.3 «Turning Commands into a Script»**, que con peso 4 es el de mayor
puntuación individual del examen. Va de no saber qué es un script a leer uno de
veintiocho líneas y saber qué imprime y con qué código termina.

Trece secciones, cinco de ellas interactivas:

- **Qué es un script**: el shell como intérprete, la misma orden a mano y en un
  fichero, y los cuatro pasos (escribir → declarar → permitir → ejecutar).
- **nano y vi** (interactivo): **simulador de `vi`** con sus modos. Teclear en modo
  normal no escribe nada, `:q` con cambios pendientes se niega con `E37`, y al salir
  con `:q!` un `cat` muestra qué se perdió. Tablas de teclas de ambos editores.
- **El shebang**: por qué lo lee el kernel y no el shell, `#!/bin/bash` frente a
  `#!/bin/sh` (que en Debian es `dash`) y `#!/usr/bin/env bash`.
- **Ejecutarlo** (interactivo): `bash s.sh`, `./s.sh` y `source s.sh` comparados, y
  **seis sesiones de terminal** con los finales reales — sin `chmod` (126), sin `./`
  (127), con `^M` de Windows, y `source` frente a `./`.
- **Variables y `echo`**: la asignación sin espacios, las tres formas de entrecomillar
  y qué cambia, `$( )`, `$(( ))`, `export` y las variables de entorno habituales.
- **Argumentos** (interactivo): **simulador** con la línea de comandos editable; trocea
  la entrada como lo haría el shell y muestra `$0`, `$1`…, `$#`, `"$@"` y `"$*"`.
  Quitar las comillas parte un argumento en dos, a la vista.
- **Bucles `for`** (interactivo): seis bucles con lo que el shell expande *antes* de
  iterar — lista literal, comodín, `{1..5}`, `$( )`, `"$@"` y un contador.
- **`if` y `test`**: por qué `if` ejecuta un comando en vez de evaluar una expresión,
  por qué `[` exige espacios, y la tabla de operadores de fichero, texto y número.
- **Estado de salida**: la convención del 0, la tabla de códigos (1, 2, 126, 127, 130),
  por qué `$?` caduca con el comando siguiente, `exit N`, `&&` y `||`.
- **Un script entero** (interactivo): `copia-logs.sh`, 28 líneas con validación,
  bucle y contador; **cada línea se pulsa** y explica qué aporta y por qué se escribe así.
- **Los ocho errores de siempre**: cada mensaje de error real, su causa y su arreglo.
- **Doce preguntas** de autoevaluación con opciones barajadas y explicación.
- **Chuleta** final.

## 8. Guía de red — `linux_networking/index.html`

El objetivo **4.4 «Your Computer on the Network»**, montado alrededor de la idea de
que una máquina conectada solo necesita cuatro datos: dirección, puerta de enlace,
DNS y nombre. Todo lo demás son formas de leerlos.

Nueve secciones, una de ellas interactiva:

- **Cuatro datos**: qué comando muestra cada uno y en qué fichero vive.
- **Explorador de comandos** (interactivo): los 19 comandos de la tabla del objetivo
  —`ip addr`, `ip a`, `ip link`, `ip route`, `ip neigh`, `ifconfig`, `hostname`,
  `hostname -I`, `ss`, `ping`, `traceroute`, `tracepath`, `dig`, `host`, `nslookup`,
  `curl`, `wget`, `ssh`, `scp`— con **su salida real**, en qué fijarse de ella y las
  variantes que se usan a diario. Filtro por familia: direcciones, rutas, DNS,
  diagnóstico y remoto.
- **Leer `ip a` campo a campo**: `inet`, el prefijo `/24`, `brd`, `scope`, las banderas
  `UP` y `LOWER_UP`, `link/ether`, `valid_lft` y por qué `lo` no cuenta.
- **`ifconfig` frente a `ip`**: net-tools contra iproute2, tabla de equivalencias
  completa (`route -n` → `ip r`, `arp -a` → `ip n`, `netstat -tuln` → `ss -tuln`),
  la misma interfaz contada por los dos, y qué significa «ifconfig: no se encontró
  la orden».
- **La tabla de rutas**: `default via`, `dev`, `proto`, `src`, `metric` y `ip route get`.
- **Nombres y DNS**: `/etc/hosts`, `/etc/resolv.conf`, `/etc/nsswitch.conf` y los tres
  comandos que preguntan lo mismo (`host`, `dig`, `nslookup`).
- **Escalera de diagnóstico**: cinco pasos de dentro hacia fuera y qué significa que
  falle cada uno, más una tabla de síntoma → sospechoso.
- **Diez preguntas** de autoevaluación con opciones barajadas y explicación.
- **Chuleta** final.

Los comandos que modifican la red (`ip link set`, `ip addr add`, `ip route add`)
aparecen señalados aparte: requieren root y se pierden al reiniciar.

## 9. Especificaciones — `docs/specs/`

| Spec | Estado |
|---|---|
| `terminal-simulador-nucleo.spec.md` | **Implementada** en `linux_terminal/index.html` |
| `terminal-simulador-ejercicios.spec.md` | Draft: ejercicios corregidos sobre el árbol |
| `registro-intentos-supabase.spec.md` | Draft: registro de intentos en Supabase |
| `estadisticas-preparacion-por-tema.*` | Implementada en el simulador de examen |

`terminal-simulador-ejercicios.spec.md` es la segunda mitad del simulador de
terminal: enunciados que se corrigen **inspeccionando el árbol**, no comparando
la orden tecleada, de modo que cualquier camino correcto valga. Depende del
núcleo que ya está implementado, y de él usa `clonar()` y el `Estado`.

`registro-intentos-supabase.spec.md` es un contrato SDD para persistir en Supabase
cada intento finalizado (nombre, IP, número de intento, nota y modo). **No hay
ninguna línea de código de Supabase en el proyecto.**

---

## Uso

No requiere instalación. Basta con abrir la portada:

```bash
xdg-open index.html
```

Si prefieres servirlo por HTTP:

```bash
python3 -m http.server 8000
# http://localhost:8000/
```

Las páginas no necesitan Node; las pruebas y el banco de fidelidad, sí (Node 18
o superior, y un Linux con coreutils y bash para el banco):

```bash
node --test tests/          # pruebas del examen, del shell simulado y de su vista
node tools/fidelidad.mjs    # fidelidad del shell frente a coreutils y bash reales
```

### Publicación

El repositorio se sirve con **GitHub Pages** desde la rama `main`, carpeta raíz:

| Página | URL |
|---|---|
| Portada | <https://jsalio.github.io/Lixnux-exam-test/> |
| Examen | <https://jsalio.github.io/Lixnux-exam-test/lpi_practice_exam/> |
| Terminal | <https://jsalio.github.io/Lixnux-exam-test/linux_terminal/> |
| Permisos | <https://jsalio.github.io/Lixnux-exam-test/sample_linux_permissions/> |
| Directorios | <https://jsalio.github.io/Lixnux-exam-test/linux_special_directories/> |
| Ficheros del sistema | <https://jsalio.github.io/Lixnux-exam-test/linux_system_files/> |
| Comandos | <https://jsalio.github.io/Lixnux-exam-test/linux_basic_commands/> |
| Scripting | <https://jsalio.github.io/Lixnux-exam-test/linux_shell_scripting/> |
| Red | <https://jsalio.github.io/Lixnux-exam-test/linux_networking/> |

Al ser un *project site*, el sitio cuelga de `/Lixnux-exam-test/` y no de la raíz
del dominio. Por eso **todos los enlaces internos son relativos**: una ruta que
empiece por `/` apuntaría fuera del proyecto y daría 404. El fichero `.nojekyll`
desactiva el procesado Jekyll, que no aporta nada aquí y solo añade reglas
sorpresa sobre nombres de fichero.

---

## Aviso

Las preguntas de este banco **no son oficiales**: están redactadas a partir de los
objetivos públicos de la versión 1.6 del examen. El examen real consta de 40
preguntas en 60 minutos, con puntuación de 200 a 800 y 500 puntos para aprobar.
