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
| `index.html` | Portada: navega a las seis páginas |
| `lpi_practice_exam/index.html` | Simulador de examen bilingüe con banco de 145 preguntas |
| `sample_linux_permissions/index.html` | Guía interactiva de permisos de Linux con calculadora |
| `linux_special_directories/index.html` | Guía interactiva de la jerarquía de directorios |
| `linux_system_files/index.html` | Guía interactiva de los ficheros de configuración de `/etc` |
| `linux_basic_commands/index.html` | Guía breve de comandos y de cómo se encadenan |
| `linux_shell_scripting/index.html` | Guía del objetivo 3.3: de comandos sueltos a script de Bash |
| `docs/specs/registro-intentos-supabase.spec.md` | Especificación SDD (en estado *Draft*, **no implementada**) |

Cada aplicación vive en su propia carpeta con un `index.html`, de modo que su URL
es el directorio. La portada enlaza a todas y todas enlazan de vuelta a la portada.

---

## 1. Simulador de examen — `lpi_practice_exam/index.html`

### Modos

| Modo | Preguntas | Tiempo | Orden |
|---|---|---|---|
| **Simulacro de examen** | 40 aleatorias | 60 min, envío automático al agotarse | Aleatorio |
| **Banco completo (estudio)** | 145 (todas) | Sin límite | Por tema (101 → 105) |

El simulacro respeta el reparto por tema del examen oficial:

| Tema | Título | Banco | Simulacro |
|---|---|---|---|
| 101 | La comunidad Linux y una carrera en Open Source | 18 | 7 |
| 102 | Encontrar tu camino en un sistema Linux | 29 | 8 |
| 103 | El poder de la línea de comandos | 38 | 10 |
| 104 | El sistema operativo Linux | 30 | 8 |
| 105 | Seguridad y permisos de archivos | 30 | 7 |
| | **Total** | **145** | **40** |

### Tipos de pregunta

- **Respuesta única** (133): una sola opción correcta.
- **Selección múltiple** (6): se exige el conjunto exacto; todo o nada, sin puntuación parcial.
- **Escribir el comando** (7): se ignoran mayúsculas/minúsculas y espacios extra; se aceptan variantes equivalentes.

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

## 2. Guía de permisos — `sample_linux_permissions/index.html`

Página explicativa de una sola pieza sobre el modelo de permisos de Linux, con
índice lateral y una calculadora interactiva.

Secciones: anatomía de `ls -l`, significado de `rwx` en ficheros y en directorios,
cómo el kernel elige un único bloque (usuario / grupo / otros), notación octal,
**calculadora de permisos** (octal ↔ simbólico + comando `chmod` resultante y bits
especiales), modo simbólico, dueño y grupo, `setuid` / `setgid` / *sticky bit*,
`umask`, errores típicos y una chuleta final.

La calculadora no guarda estado: es puramente cliente y sin almacenamiento.

---

## 3. Guía de directorios — `linux_special_directories/index.html`

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

## 4. Guía de ficheros del sistema — `linux_system_files/index.html`

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

## 5. Guía de comandos — `linux_basic_commands/index.html`

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

## 6. Guía de scripting — `linux_shell_scripting/index.html`

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

## 7. Especificación pendiente — `docs/specs/`

`registro-intentos-supabase.spec.md` es un contrato SDD para persistir en Supabase
cada intento finalizado (nombre, IP, número de intento, nota y modo).

**Estado: Draft — no hay ninguna línea de código de Supabase en el proyecto.**
El documento define modelo de datos, contratos de la Edge Function
`POST /functions/v1/record-attempt`, invariantes, máquina de estados del frontend
e impacto en ficheros existentes. Los siguientes pasos del pipeline
(`/impact` → `/arch` → `/tdd-plan` → `/why`) están sin ejecutar.

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

### Publicación

El repositorio se sirve con **GitHub Pages** desde la rama `main`, carpeta raíz:

| Página | URL |
|---|---|
| Portada | <https://jsalio.github.io/Lixnux-exam-test/> |
| Examen | <https://jsalio.github.io/Lixnux-exam-test/lpi_practice_exam/> |
| Permisos | <https://jsalio.github.io/Lixnux-exam-test/sample_linux_permissions/> |
| Directorios | <https://jsalio.github.io/Lixnux-exam-test/linux_special_directories/> |
| Ficheros del sistema | <https://jsalio.github.io/Lixnux-exam-test/linux_system_files/> |
| Comandos | <https://jsalio.github.io/Lixnux-exam-test/linux_basic_commands/> |
| Scripting | <https://jsalio.github.io/Lixnux-exam-test/linux_shell_scripting/> |

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
