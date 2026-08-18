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
| `index.html` | Portada: navega a las dos aplicaciones |
| `lpi_practice_exam/index.html` | Simulador de examen bilingüe con banco de 145 preguntas |
| `sample_linux_permissions/index.html` | Guía interactiva de permisos de Linux con calculadora |
| `docs/specs/registro-intentos-supabase.spec.md` | Especificación SDD (en estado *Draft*, **no implementada**) |

Cada aplicación vive en su propia carpeta con un `index.html`, de modo que su URL
es el directorio. La portada enlaza a ambas y ambas enlazan de vuelta a la portada.

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

## 3. Especificación pendiente — `docs/specs/`

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
