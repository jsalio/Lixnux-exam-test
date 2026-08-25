/**
 * PROTOTIPO — Núcleo del simulador de terminal.
 *
 * Objetivo de este prototipo: medir la fidelidad real frente a coreutils
 * antes de especificar nada. No es la versión final ni tiene interfaz.
 *
 * Reglas que respeta desde el primer día, porque son las que deciden si el
 * código sirve para el proyecto:
 *
 *  - Puro: no toca `document`, `localStorage`, `fetch`, `Date.now` ni
 *    `Math.random`. El instante actual entra como dato (`estado.ahora`), igual
 *    que hizo el examen con su núcleo.
 *  - Mundo cerrado: lo que no está implementado lo dice, no lo inventa. Una
 *    salida plausible y falsa enseña algo incorrecto; un hueco declarado no.
 *  - Una función, una respuesta: `ejecutar(estado, linea)` devuelve
 *    `{salida, error, codigo}`. Eso es lo que hace testable un shell.
 */

/* ===== 1. SISTEMA DE FICHEROS VIRTUAL ===== */

/** Bloques de 4 KiB: es lo que asume `ls -l` al calcular la línea `total`. */
const BLOQUE = 4096;

/**
 * Crea un directorio.
 * @param {object} [attr]  modo, usuario, grupo, mtime, hijos.
 * @returns {object} Nodo de tipo directorio.
 */
export function dir(attr = {}) {
  return {
    tipo: 'd',
    modo: attr.modo ?? 0o755,
    usuario: attr.usuario ?? 'root',
    grupo: attr.grupo ?? 'root',
    mtime: attr.mtime ?? 0,
    hijos: attr.hijos ?? {}
  };
}

/**
 * Crea un fichero regular.
 * @param {string} contenido  Texto del fichero.
 * @param {object} [attr]     modo, usuario, grupo, mtime.
 * @returns {object} Nodo de tipo fichero.
 */
export function fichero(contenido = '', attr = {}) {
  return {
    tipo: 'f',
    modo: attr.modo ?? 0o644,
    usuario: attr.usuario ?? 'root',
    grupo: attr.grupo ?? 'root',
    mtime: attr.mtime ?? 0,
    contenido
  };
}

/**
 * Crea un dispositivo de caracteres. El único que hace falta es `/dev/null`,
 * que se traga lo que se le escribe y devuelve el vacío al leerlo: sin él, la
 * mitad de los idiomas de shell que enseña el examen no se pueden teclear.
 *
 * @param {object} [attr]  modo, usuario, grupo, mtime.
 * @returns {object} Nodo de tipo dispositivo.
 */
export function dispositivo(attr = {}) {
  return {
    tipo: 'c',
    modo: attr.modo ?? 0o666,
    usuario: attr.usuario ?? 'root',
    grupo: attr.grupo ?? 'root',
    mtime: attr.mtime ?? 0,
    contenido: ''
  };
}

/**
 * Crea un enlace simbólico.
 * @param {string} destino  Ruta a la que apunta.
 * @param {object} [attr]   usuario, grupo, mtime.
 * @returns {object} Nodo de tipo enlace.
 */
export function enlace(destino, attr = {}) {
  return {
    tipo: 'l',
    modo: 0o777,
    usuario: attr.usuario ?? 'root',
    grupo: attr.grupo ?? 'root',
    mtime: attr.mtime ?? 0,
    destino
  };
}

/** Tamaño en bytes de un nodo, como lo informaría `stat`. */
export function tamano(nodo) {
  if (nodo.tipo === 'd') return BLOQUE;
  if (nodo.tipo === 'l') return nodo.destino.length;
  if (nodo.tipo === 'c') return 0;
  return nodo.contenido.length;
}

/** Bloques de 1 KiB que `ls -l` suma en la línea `total`. */
function bloques(nodo) {
  if (nodo.tipo === 'l' || nodo.tipo === 'c') return 0;
  if (nodo.tipo === 'd') return 4;
  return Math.ceil(nodo.contenido.length / BLOQUE) * 4;
}

/** Enlaces duros: un directorio cuenta `.`, `..` y cada subdirectorio. */
function enlaces(nodo) {
  if (nodo.tipo !== 'd') return 1;
  return 2 + Object.values(nodo.hijos).filter((h) => h.tipo === 'd').length;
}

/** Copia profunda del estado, para poder deshacer o comparar. */
export function clonar(estado) {
  return {
    ...estado,
    raiz: clonarNodo(estado.raiz),
    entorno: { ...estado.entorno }
  };
}

function clonarNodo(nodo) {
  const copia = { ...nodo };
  if (nodo.tipo === 'd') {
    copia.hijos = {};
    for (const [n, h] of Object.entries(nodo.hijos)) copia.hijos[n] = clonarNodo(h);
  }
  return copia;
}

/* ===== 2. RUTAS ===== */

/** Trocea una ruta en segmentos, descartando los vacíos. */
function segmentos(ruta) {
  return ruta.split('/').filter((s) => s !== '');
}

/** Normaliza una ruta absoluta resolviendo `.` y `..` sin tocar el disco. */
function normalizar(ruta) {
  const pila = [];
  for (const s of segmentos(ruta)) {
    if (s === '.') continue;
    if (s === '..') { pila.pop(); continue; }
    pila.push(s);
  }
  return '/' + pila.join('/');
}

/**
 * Convierte una ruta escrita por el usuario en absoluta.
 * @param {object} estado  Estado del shell (`cwd`, `usuario`).
 * @param {string} ruta    Ruta tal como la escribió el usuario.
 * @returns {string} Ruta absoluta normalizada.
 */
export function absoluta(estado, ruta) {
  if (ruta === '~' || ruta.startsWith('~/')) {
    const casa = estado.usuario === 'root' ? '/root' : `/home/${estado.usuario}`;
    return normalizar(casa + ruta.slice(1));
  }
  if (ruta.startsWith('/')) return normalizar(ruta);
  return normalizar(estado.cwd + '/' + ruta);
}

/**
 * Busca un nodo por ruta, comprobando permisos de travesía por el camino.
 *
 * @param {object} estado  Estado del shell.
 * @param {string} ruta    Ruta a resolver.
 * @returns {{nodo:object|null, padre:object|null, nombre:string, ruta:string, error:string|null}}
 *          `error` es el código errno simbólico: ENOENT, ENOTDIR o EACCES.
 */
export function buscar(estado, ruta, { seguirFinal = true, saltos = 0 } = {}) {
  if (saltos > 40) return { nodo: null, padre: null, nombre: ruta, ruta, error: 'ELOOP' };

  const abs = absoluta(estado, ruta);
  const partes = segmentos(abs);
  let nodo = estado.raiz;
  let padre = null;
  let nombre = '/';
  let recorrido = '';

  for (let i = 0; i < partes.length; i++) {
    if (nodo.tipo !== 'd') return { nodo: null, padre, nombre: partes[i], ruta: abs, error: 'ENOTDIR' };
    if (!puede(estado, nodo, 'x')) return { nodo: null, padre, nombre: partes[i], ruta: abs, error: 'EACCES' };
    padre = nodo;
    nombre = partes[i];
    recorrido += '/' + nombre;
    const hijo = nodo.hijos[nombre];
    if (!hijo) return { nodo: null, padre, nombre, ruta: abs, error: 'ENOENT' };

    // Un enlace se sigue siempre por el camino; en el último tramo depende de
    // quién pregunta: `cat enlace` mira el destino, `ls -l enlace` y `rm` no.
    const ultimo = i === partes.length - 1;
    if (hijo.tipo === 'l' && (!ultimo || seguirFinal)) {
      const destino = hijo.destino.startsWith('/')
        ? hijo.destino
        : recorrido.slice(0, recorrido.lastIndexOf('/')) + '/' + hijo.destino;
      const resto = partes.slice(i + 1).join('/');
      return buscar(estado, resto ? destino + '/' + resto : destino, { seguirFinal, saltos: saltos + 1 });
    }
    nodo = hijo;
  }
  return { nodo, padre, nombre, ruta: abs, error: null };
}

/* ===== 3. PERMISOS ===== */

/**
 * Decide si el usuario del estado puede hacer algo sobre un nodo.
 *
 * Aplica la regla que el examen pregunta una y otra vez: el kernel elige **un
 * solo** bloque de tres bits —dueño, o grupo, o otros— y no acumula.
 *
 * @param {object} estado  Estado del shell (`usuario`, `grupos`).
 * @param {object} nodo    Nodo sobre el que se comprueba.
 * @param {'r'|'w'|'x'} acceso  Acceso pedido.
 * @returns {boolean}
 */
export function puede(estado, nodo, acceso) {
  const bit = { r: 4, w: 2, x: 1 }[acceso];

  if (estado.usuario === 'root') {
    // root se salta lectura y escritura; para ejecutar aún necesita algún bit x.
    if (acceso !== 'x') return true;
    if (nodo.tipo === 'd') return true;
    return (nodo.modo & 0o111) !== 0;
  }

  let tres;
  if (nodo.usuario === estado.usuario) tres = (nodo.modo >> 6) & 7;
  else if ((estado.grupos ?? []).includes(nodo.grupo)) tres = (nodo.modo >> 3) & 7;
  else tres = nodo.modo & 7;

  return (tres & bit) !== 0;
}

/** Los diez caracteres de la primera columna de `ls -l`. */
export function modoTexto(nodo) {
  const TRIOS = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'];
  const m = nodo.modo;
  let s = TRIOS[(m >> 6) & 7] + TRIOS[(m >> 3) & 7] + TRIOS[m & 7];
  const sustituir = (i, ch) => { s = s.slice(0, i) + ch + s.slice(i + 1); };
  if (m & 0o4000) sustituir(2, s[2] === 'x' ? 's' : 'S');
  if (m & 0o2000) sustituir(5, s[5] === 'x' ? 's' : 'S');
  if (m & 0o1000) sustituir(8, s[8] === 'x' ? 't' : 'T');
  const TIPOS = { d: 'd', l: 'l', c: 'c', f: '-' };
  return TIPOS[nodo.tipo] + s;
}

/* ===== 4. FECHAS ===== */

const MESES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * La columna de fecha de `ls -l`, con el criterio de GNU coreutils: hora si el
 * fichero es reciente, año si tiene más de seis meses o está en el futuro.
 *
 * Se calcula en UTC a propósito: el núcleo tiene que ser determinista, así que
 * no puede depender de la zona horaria de quien lo ejecute.
 *
 * @param {number} mtime  Segundos desde epoch.
 * @param {number} ahora  Instante actual en segundos (dato, no reloj).
 * @returns {string} Doce caracteres, en formato de la locale C.
 */
export function fechaLs(mtime, ahora) {
  const d = new Date(mtime * 1000);
  const mes = MESES[d.getUTCMonth()];
  const dia = String(d.getUTCDate()).padStart(2, ' ');
  const SEIS_MESES = 15778476;
  const reciente = mtime <= ahora + 3600 && ahora - mtime <= SEIS_MESES;
  if (!reciente) return `${mes} ${dia}  ${d.getUTCFullYear()}`;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${mes} ${dia} ${hh}:${mm}`;
}

/* ===== 5. TROCEADO Y PARSER ===== */

const OPERADORES = ['2>&1', '2>>', '2>', '>>', '&&', '||', '|', '>', '<', ';'];

/** Palabras reservadas de bash: estructuras de control que este núcleo no interpreta. */
const CLAVES = ['if', 'then', 'elif', 'else', 'fi', 'for', 'while', 'until', 'do', 'done',
  'case', 'esac', 'select', 'function', 'in'];

/**
 * Trocea una línea en palabras y operadores.
 *
 * Cada palabra se guarda como una lista de segmentos con su tipo de comilla,
 * porque de eso —y no de la palabra entera— depende qué se expande después:
 * dentro de `'…'` no se expande nada, dentro de `"…"` se expanden variables
 * pero no comodines, y fuera se expande todo. Tratar la palabra como un bloque
 * único haría que `echo '$HOME'` imprimiera la ruta, que es exactamente el
 * error que el examen pregunta.
 *
 * @param {string} linea
 * @returns {{tokens:Array<object>, error:string|null}}
 */
export function trocear(linea) {
  const tokens = [];
  let segmentos = [];
  let cur = '';
  let tipo = 'plano';
  let comilla = null;
  let abierta = false;

  const cerrarSegmento = () => {
    if (cur !== '' || tipo !== 'plano') segmentos.push({ tipo, texto: cur });
    cur = '';
    tipo = 'plano';
  };
  const cerrarPalabra = () => {
    cerrarSegmento();
    if (abierta) tokens.push({ t: 'palabra', segmentos, v: segmentos.map((g) => g.texto).join('') });
    segmentos = [];
    abierta = false;
  };

  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];

    if (comilla) {
      if (c === comilla) { cerrarSegmento(); comilla = null; continue; }
      cur += c;
      continue;
    }
    if (c === "'" || c === '"') {
      cerrarSegmento();
      comilla = c;
      tipo = c === "'" ? 'simple' : 'doble';
      abierta = true;
      continue;
    }
    if (c === '\\' && i + 1 < linea.length) {
      cerrarSegmento();
      segmentos.push({ tipo: 'simple', texto: linea[++i] });
      abierta = true;
      continue;
    }
    if (c === ' ' || c === '\t') { cerrarPalabra(); continue; }
    if (c === '#' && !abierta) break;

    // Sustitución de órdenes: se traga los operadores que lleve dentro.
    if (c === '$' && linea[i + 1] === '(') {
      let nivel = 0;
      let j = i + 1;
      for (; j < linea.length; j++) {
        if (linea[j] === '(') nivel++;
        else if (linea[j] === ')' && --nivel === 0) break;
      }
      cur += linea.slice(i, j + 1);
      abierta = true;
      i = j;
      continue;
    }
    if (c === '`') {
      const cierre = linea.indexOf('`', i + 1);
      if (cierre < 0) return { tokens, error: 'comilla ` sin cerrar' };
      cur += '$(' + linea.slice(i + 1, cierre) + ')';
      abierta = true;
      i = cierre;
      continue;
    }

    const op = OPERADORES.find((o) => linea.startsWith(o, i));
    if (op) { cerrarPalabra(); tokens.push({ t: 'op', v: op }); i += op.length - 1; continue; }

    cur += c;
    abierta = true;
  }

  if (comilla) return { tokens, error: `comilla ${comilla} sin cerrar` };
  cerrarPalabra();
  return { tokens, error: null };
}

/**
 * Construye el árbol de ejecución a partir de los tokens.
 *
 * Gramática: lista → (tubería (`&&`|`||`|`;`) …); tubería → orden (`|` orden)*.
 *
 * @param {Array<object>} tokens
 * @returns {{lista:Array<object>, error:string|null}}
 */
export function parsear(tokens) {
  const lista = [];
  let tuberia = [];
  let orden = null;
  let union = ';';

  const nuevaOrden = () => ({ palabras: [], redir: [] });

  const cerrarOrden = () => {
    if (orden && orden.palabras.length) tuberia.push(orden);
    else if (orden && orden.redir.length) tuberia.push(orden);
    orden = null;
  };
  const cerrarTuberia = (siguienteUnion) => {
    cerrarOrden();
    if (tuberia.length) lista.push({ union, ordenes: tuberia });
    tuberia = [];
    union = siguienteUnion;
  };

  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];

    if (tk.t === 'palabra') {
      if (!orden) orden = nuevaOrden();
      orden.palabras.push(tk);
      continue;
    }

    if (tk.v === '|') {
      cerrarOrden();
      if (!tuberia.length) return { lista, error: 'error de sintaxis cerca de `|`' };
      continue;
    }
    if (tk.v === '&&' || tk.v === '||' || tk.v === ';') {
      const habia = tuberia.length || (orden && (orden.palabras.length || orden.redir.length));
      if (!habia && tk.v !== ';') return { lista, error: `error de sintaxis cerca de \`${tk.v}\`` };
      cerrarTuberia(tk.v);
      continue;
    }

    if (tk.v === '2>&1') {
      if (!orden) orden = nuevaOrden();
      orden.redir.push({ op: '2>&1' });
      continue;
    }

    // Redirecciones: consumen la palabra siguiente como destino.
    const destino = tokens[i + 1];
    if (!destino || destino.t !== 'palabra') {
      return { lista, error: 'error de sintaxis: falta el fichero de la redirección' };
    }
    if (!orden) orden = nuevaOrden();
    orden.redir.push({ op: tk.v, fichero: destino.v });
    i++;
  }

  cerrarTuberia(';');
  return { lista, error: null };
}

/* ===== 6. COMODINES ===== */

/** Traduce un patrón de shell a expresión regular anclada. */
function patronARegex(patron) {
  let re = '^';
  for (let i = 0; i < patron.length; i++) {
    const c = patron[i];
    if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const cierre = patron.indexOf(']', i + 1);
      if (cierre < 0) { re += '\\['; continue; }
      let clase = patron.slice(i + 1, cierre);
      if (clase.startsWith('!')) clase = '^' + clase.slice(1);
      re += '[' + clase + ']';
      i = cierre;
    } else re += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return new RegExp(re + '$');
}

/** Une un prefijo de ruta con un nombre, sin duplicar barras. */
function unirRuta(base, nombre) {
  if (base === '') return nombre;
  if (base === '/') return '/' + nombre;
  return base + '/' + nombre;
}

/**
 * Expande una palabra con comodines, componente a componente.
 *
 * Va por tramos porque un patrón puede llevar comodín en medio, como en
 * el patrón «asterisco barra asterisco punto sh», y
 * cada tramo se resuelve contra los directorios que sobrevivieron al anterior.
 * Un directorio que no se puede leer se salta en silencio, igual que bash.
 *
 * Sigue la regla de bash con `nullglob` desactivado: si el patrón no encuentra
 * nada, la palabra se pasa literal al comando. De ahí vienen la mitad de los
 * mensajes de error confusos que ve un principiante.
 *
 * @param {object} estado
 * @param {string} palabra
 * @returns {string[]} Coincidencias ordenadas, o `[palabra]` si no hay ninguna.
 */
export function expandir(estado, palabra) {
  if (!/[*?[]/.test(palabra)) return [palabra];

  const absoluto = palabra.startsWith('/');
  const tramos = palabra.split('/').filter((t, i) => !(i === 0 && t === ''));
  let actuales = [absoluto ? '/' : ''];

  for (const tramo of tramos) {
    if (!/[*?[]/.test(tramo)) {
      actuales = actuales.map((base) => unirRuta(base, tramo));
      continue;
    }
    const re = patronARegex(tramo);
    const ocultos = tramo.startsWith('.');
    const siguientes = [];
    for (const base of actuales) {
      const { nodo, error } = buscar(estado, base === '' ? '.' : base);
      if (error || nodo.tipo !== 'd' || !puede(estado, nodo, 'r')) continue;
      for (const nombre of Object.keys(nodo.hijos)) {
        if (!ocultos && nombre.startsWith('.')) continue;
        if (re.test(nombre)) siguientes.push(unirRuta(base, nombre));
      }
    }
    actuales = siguientes;
  }

  const validos = actuales.filter((r) => !buscar(estado, r).error).sort();
  return validos.length ? validos : [palabra];
}

/**
 * Expande las llaves: `{1..3}` y `{a,b}`. Ocurre antes que los comodines y no
 * mira el sistema de ficheros, que es justo lo que la distingue de `*`.
 *
 * @param {string} palabra
 * @returns {string[]}
 */
export function expandirLlaves(palabra) {
  const m = palabra.match(/^(.*?)\{([^{}]*)\}(.*)$/);
  if (!m) return [palabra];
  const [, antes, dentro, despues] = m;

  let piezas;
  const rango = dentro.match(/^(-?\d+)\.\.(-?\d+)$/);
  if (rango) {
    const [a, b] = [Number(rango[1]), Number(rango[2])];
    piezas = [];
    for (let v = a; a <= b ? v <= b : v >= b; a <= b ? v++ : v--) piezas.push(String(v));
  } else if (dentro.includes(',')) {
    piezas = dentro.split(',');
  } else {
    return [palabra];
  }

  return piezas.flatMap((pieza) => expandirLlaves(antes + pieza + despues));
}

/** Expande `$VAR`, `${VAR}` y `$?` en una palabra no entrecomillada con `'`. */
function expandirVariables(estado, palabra) {
  return palabra.replace(/\$\{(\w+)\}|\$(\w+)|\$\?/g, (m, a, b) => {
    if (m === '$?') return String(estado.ultimoCodigo ?? 0);
    const nombre = a ?? b;
    return estado.entorno[nombre] ?? '';
  });
}

/* ===== 7. UTILIDADES DE LOS COMANDOS ===== */

/** Texto a líneas, descartando la vacía que deja el salto final. */
function lineas(texto) {
  if (texto === '') return [];
  const l = texto.split('\n');
  if (l[l.length - 1] === '') l.pop();
  return l;
}

/** Líneas a texto, con salto final: así se guardan los ficheros de verdad. */
function texto(l) {
  return l.length ? l.join('\n') + '\n' : '';
}

/** Mensaje de errno tal como lo imprime coreutils en la locale C. */
const ERRNO = {
  ELOOP: 'Too many levels of symbolic links',
  ENOENT: 'No such file or directory',
  ENOTDIR: 'Not a directory',
  EACCES: 'Permission denied',
  EEXIST: 'File exists',
  ENOTEMPTY: 'Directory not empty',
  EISDIR: 'Is a directory'
};

/**
 * Separa opciones cortas de operandos.
 *
 * No acepta opciones largas ni letras desconocidas: devuelve `error` con la
 * opción ofensora para que el comando lo declare en vez de ignorarla.
 *
 * @param {string[]} args
 * @param {string} booleanas  Letras sin valor, p.ej. `'laA1h'`.
 * @param {string} [conValor] Letras con valor, p.ej. `'n'`.
 * @returns {{flags:Set<string>, valores:object, resto:string[], error:string|null}}
 */
function opciones(args, booleanas, conValor = '') {
  const flags = new Set();
  const valores = {};
  const resto = [];
  let finDeOpciones = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (finDeOpciones || a === '-' || a === '' || !a.startsWith('-')) { resto.push(a); continue; }
    if (a === '--') { finDeOpciones = true; continue; }
    if (a.startsWith('--')) return { flags, valores, resto, error: a };

    for (let j = 1; j < a.length; j++) {
      const letra = a[j];
      if (booleanas.includes(letra)) { flags.add(letra); continue; }
      if (conValor.includes(letra)) {
        const valor = a.slice(j + 1) || args[++i];
        if (valor === undefined) return { flags, valores, resto, error: `-${letra}` };
        valores[letra] = valor;
        j = a.length;
        continue;
      }
      return { flags, valores, resto, error: `-${letra}` };
    }
  }
  return { flags, valores, resto, error: null };
}

/** Fallo de comando con el formato de coreutils. */
function fallo(cmd, mensaje, codigo = 1) {
  return { salida: '', error: `${cmd}: ${mensaje}\n`, codigo };
}

/** Opción no implementada. Se declara, no se ignora: ignorarla enseñaría mal. */
function noImplementado(cmd, que) {
  return {
    salida: '',
    error: `simulador: ${cmd}: ${que} no está implementado en este prototipo\n`,
    codigo: 2
  };
}

/**
 * Lee los operandos de fichero de un comando de texto, o la entrada estándar.
 *
 * @returns {{partes:Array<{nombre:string, contenido:string}>, error:string, codigo:number}}
 */
function leerEntradas(ctx, cmd, rutas) {
  const partes = [];
  let error = '';
  let codigo = 0;

  if (!rutas.length) return { partes: [{ nombre: '-', contenido: ctx.entrada }], error, codigo };

  for (const ruta of rutas) {
    if (ruta === '-') { partes.push({ nombre: '-', contenido: ctx.entrada }); continue; }
    const r = buscar(ctx.estado, ruta);
    if (r.error) { error += `${cmd}: ${ruta}: ${ERRNO[r.error]}\n`; codigo = 1; continue; }
    if (r.nodo.tipo === 'd') { error += `${cmd}: ${ruta}: Is a directory\n`; codigo = 1; continue; }
    if (!puede(ctx.estado, r.nodo, 'r')) { error += `${cmd}: ${ruta}: Permission denied\n`; codigo = 1; continue; }
    partes.push({ nombre: ruta, contenido: r.nodo.contenido });
  }
  return { partes, error, codigo };
}

/* ===== 8. COMANDOS ===== */

const COMANDOS = {};

COMANDOS.pwd = (ctx) => ({ salida: ctx.estado.cwd + '\n', error: '', codigo: 0 });

COMANDOS.whoami = (ctx) => ({ salida: ctx.estado.usuario + '\n', error: '', codigo: 0 });

COMANDOS.cd = (ctx) => {
  const est = ctx.estado;
  let destino = ctx.argv[1] ?? '~';
  let anunciar = false;
  if (destino === '-') {
    if (!est.entorno.OLDPWD) return fallo('bash: cd', 'OLDPWD not set');
    destino = est.entorno.OLDPWD;
    anunciar = true;  // `cd -` imprime a dónde ha ido; `cd` normal, no.
  }
  const r = buscar(est, destino);
  if (r.error) return fallo('bash: cd', `${destino}: ${ERRNO[r.error]}`);
  if (anunciar) destino = r.ruta;
  if (r.nodo.tipo !== 'd') return fallo('bash: cd', `${destino}: Not a directory`);
  if (!puede(est, r.nodo, 'x')) return fallo('bash: cd', `${destino}: Permission denied`);
  est.entorno.OLDPWD = est.cwd;
  // `cd` de bash es lógico: guarda la ruta que escribiste, no la resuelta. Por
  // eso tras `cd enlace` el prompt dice el enlace y `cd ..` vuelve al padre del
  // enlace, no al del directorio real.
  est.cwd = absoluta(est, destino);
  return { salida: anunciar ? r.ruta + '\n' : '', error: '', codigo: 0 };
};

COMANDOS.echo = (ctx) => {
  const args = ctx.argv.slice(1);
  const sinSalto = args[0] === '-n';
  const cuerpo = (sinSalto ? args.slice(1) : args).join(' ');
  return { salida: sinSalto ? cuerpo : cuerpo + '\n', error: '', codigo: 0 };
};

COMANDOS.ls = (ctx) => {
  const o = opciones(ctx.argv.slice(1), 'laA1hdrR');
  if (o.error) return noImplementado('ls', `la opción ${o.error}`);
  if (o.flags.has('R')) return noImplementado('ls', 'la opción -R');

  const est = ctx.estado;
  const largo = o.flags.has('l');
  const todos = o.flags.has('a');
  const casiTodos = o.flags.has('A');
  const rutas = o.resto.length ? o.resto : ['.'];

  let salida = '';
  let error = '';
  let codigo = 0;

  const sueltos = [];
  const directorios = [];

  for (const ruta of rutas.slice().sort()) {
    // `ls pd` sigue el enlace y lista el directorio de destino; `ls -l pd`
    // muestra el enlace en sí. El formato largo cambia lo que se pregunta.
    const r = buscar(est, ruta, { seguirFinal: !largo && !o.flags.has('d') });
    if (r.error) { error += `ls: cannot access '${ruta}': ${ERRNO[r.error]}\n`; codigo = 2; continue; }
    if (r.nodo.tipo === 'd' && !o.flags.has('d')) directorios.push({ ruta, nodo: r.nodo, padre: r.padre });
    else sueltos.push({ nombre: ruta, nodo: r.nodo });
  }

  if (sueltos.length) salida += formatear(ctx, sueltos, { largo, humano: o.flags.has('h'), total: false, invertir: o.flags.has('r') });

  const conCabecera = rutas.length > 1;
  directorios.forEach((d, i) => {
    if (!puede(est, d.nodo, 'r')) {
      error += `ls: cannot open directory '${d.ruta}': Permission denied\n`;
      codigo = 2;
      return;
    }
    if (conCabecera || sueltos.length) salida += (salida ? '\n' : '') + `${d.ruta}:\n`;

    const entradas = [];
    if (todos) {
      entradas.push({ nombre: '.', nodo: d.nodo });
      entradas.push({ nombre: '..', nodo: d.padre ?? d.nodo });
    }
    for (const nombre of Object.keys(d.nodo.hijos).sort()) {
      if (!todos && !casiTodos && nombre.startsWith('.')) continue;
      entradas.push({ nombre, nodo: d.nodo.hijos[nombre] });
    }
    entradas.sort((a, b) => (a.nombre < b.nombre ? -1 : a.nombre > b.nombre ? 1 : 0));
    salida += formatear(ctx, entradas, { largo, humano: o.flags.has('h'), total: true, invertir: o.flags.has('r') });
  });

  return { salida, error, codigo };
};

/** Tamaño en el formato de `-h`: la unidad más grande con una cifra decimal. */
function humanizar(bytes) {
  if (bytes < 1024) return String(bytes);
  const UNIDADES = ['K', 'M', 'G', 'T'];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < UNIDADES.length - 1) { v /= 1024; u++; }
  // coreutils redondea hacia arriba y solo pone decimal por debajo de 10.
  const redondeado = v < 10 ? Math.ceil(v * 10) / 10 : Math.ceil(v);
  return (v < 10 ? redondeado.toFixed(1) : String(redondeado)) + UNIDADES[u];
}

/**
 * Pinta una lista de entradas, en corto o en largo.
 *
 * En largo alinea por columnas como GNU `ls`: enlaces y tamaño a la derecha,
 * usuario y grupo a la izquierda, todos al ancho del más largo de la lista.
 */
function formatear(ctx, entradas, { largo, humano, total, invertir }) {
  const lista = invertir ? entradas.slice().reverse() : entradas;
  // Un directorio vacío listado en largo no imprime nada... salvo su `total 0`.
  if (!lista.length) return largo && total ? 'total 0\n' : '';

  if (!largo) return lista.map((e) => e.nombre).join('\n') + '\n';

  const filas = lista.map((e) => ({
    modo: modoTexto(e.nodo),
    enlaces: String(enlaces(e.nodo)),
    usuario: e.nodo.usuario,
    grupo: e.nodo.grupo,
    tamano: humano ? humanizar(tamano(e.nodo)) : String(tamano(e.nodo)),
    fecha: fechaLs(e.nodo.mtime, ctx.estado.ahora),
    nombre: e.nodo.tipo === 'l' ? `${e.nombre} -> ${e.nodo.destino}` : e.nombre
  }));

  const ancho = (campo) => Math.max(...filas.map((f) => f[campo].length));
  const aE = ancho('enlaces');
  const aU = ancho('usuario');
  const aG = ancho('grupo');
  const aT = ancho('tamano');

  const cuerpo = filas
    .map((f) =>
      `${f.modo} ${f.enlaces.padStart(aE)} ${f.usuario.padEnd(aU)} ${f.grupo.padEnd(aG)} ` +
      `${f.tamano.padStart(aT)} ${f.fecha} ${f.nombre}`
    )
    .join('\n');

  // `ls -lh` humaniza también la línea `total`, que va en KiB.
  const suma = lista.reduce((s, e) => s + bloques(e.nodo), 0);
  const cabecera = total ? `total ${humano ? humanizar(suma * 1024) : suma}\n` : '';
  return cabecera + cuerpo + '\n';
}

COMANDOS.cat = (ctx) => {
  const o = opciones(ctx.argv.slice(1), 'nA');
  if (o.error) return noImplementado('cat', `la opción ${o.error}`);
  const { partes, error, codigo } = leerEntradas(ctx, 'cat', o.resto);
  let salida = partes.map((p) => p.contenido).join('');
  if (o.flags.has('n')) {
    salida = lineas(salida).map((l, i) => `${String(i + 1).padStart(6)}\t${l}`).join('\n');
    salida = salida ? salida + '\n' : '';
  }
  return { salida, error, codigo };
};

/** `-5` es azúcar de `-n 5` en head y tail; hay que aceptarlo aparte. */
function numeroSuelto(args) {
  // Ojo: en `head -n -1` el `-1` es el valor de -n, no un atajo.
  const i = args.findIndex((a, k) => /^-\d+$/.test(a) && args[k - 1] !== '-n');
  if (i < 0) return { args, n: null };
  const copia = args.slice();
  const n = Number(copia.splice(i, 1)[0].slice(1));
  return { args: copia, n };
}

COMANDOS.head = (ctx) => recortar(ctx, 'head');
COMANDOS.tail = (ctx) => recortar(ctx, 'tail');

function recortar(ctx, cmd) {
  const suelto = numeroSuelto(ctx.argv.slice(1));
  const o = opciones(suelto.args, 'qv', 'n');
  if (o.error) return noImplementado(cmd, `la opción ${o.error}`);
  // El signo importa y hay que conservarlo: `head -n -1` es «todas menos la
  // última» y `tail -n +2` es «desde la segunda». Sin el signo, ambos casos
  // acertarían por casualidad en ficheros pequeños y fallarían en el resto.
  const crudo = suelto.n !== null ? String(suelto.n) : (o.valores.n ?? '10');
  const signo = /^[+-]/.test(crudo) ? crudo[0] : '';
  const n = Math.abs(Number(crudo));
  if (!Number.isInteger(n)) return fallo(cmd, `invalid number of lines: '${crudo}'`);

  const { partes, error, codigo } = leerEntradas(ctx, cmd, o.resto);
  const varios = partes.length > 1 && !o.flags.has('q');

  const trozos = partes.map((p) => {
    const l = lineas(p.contenido);
    const elegidas = cmd === 'head'
      ? (signo === '-' ? l.slice(0, Math.max(0, l.length - n)) : l.slice(0, n))
      : (signo === '+' ? l.slice(Math.max(0, n - 1)) : l.slice(Math.max(0, l.length - n)));
    const cuerpo = texto(elegidas);
    return varios ? `==> ${p.nombre} <==\n` + cuerpo : cuerpo;
  });

  return { salida: trozos.join(varios ? '\n' : ''), error, codigo };
}

COMANDOS.wc = (ctx) => {
  const o = opciones(ctx.argv.slice(1), 'lwcm');
  if (o.error) return noImplementado('wc', `la opción ${o.error}`);
  const { partes, error, codigo } = leerEntradas(ctx, 'wc', o.resto);
  const pedidas = o.flags.size ? ['l', 'w', 'c'].filter((f) => o.flags.has(f) || (f === 'c' && o.flags.has('m'))) : ['l', 'w', 'c'];

  const cuentas = partes.map((p) => ({
    nombre: p.nombre === '-' ? '' : p.nombre,
    l: lineas(p.contenido).length,
    w: p.contenido.split(/\s+/).filter(Boolean).length,
    c: p.contenido.length
  }));

  if (!cuentas.length) return { salida: '', error, codigo };

  if (cuentas.length > 1) {
    cuentas.push({
      nombre: 'total',
      l: cuentas.reduce((s, c) => s + c.l, 0),
      w: cuentas.reduce((s, c) => s + c.w, 0),
      c: cuentas.reduce((s, c) => s + c.c, 0)
    });
  }

  // Anchura de columna, tal como la calcula coreutils: sin relleno cuando se
  // pide un solo recuento de un solo fichero, y en el resto de los casos el
  // ancho de los bytes contados —no el del número que se imprime—. Por eso
  // `wc -l f` da «3» pero `wc -lw f` da « 3  6».
  const sinRelleno = pedidas.length === 1 && cuentas.length === 1;
  const ancho = Math.max(...cuentas.map((c) => String(c.c).length));

  const salida = cuentas
    .map((c) => {
      const nums = pedidas.map((f) => (sinRelleno ? String(c[f]) : String(c[f]).padStart(ancho))).join(' ');
      return c.nombre ? `${nums} ${c.nombre}` : nums;
    })
    .join('\n');

  return { salida: salida + '\n', error, codigo };
};

/**
 * Traduce una expresión regular básica (BRE, la de grep sin -E) a RegExp de JS.
 *
 * En BRE `+ ? { } ( ) |` son literales y sus versiones con barra invertida son
 * los operadores: justo lo contrario que en JS. Sin esta traducción el
 * simulador aceptaría patrones que grep rechaza, que es la peor clase de error
 * en algo que se usa para estudiar.
 */
export function breARegex(patron) {
  let re = '';
  for (let i = 0; i < patron.length; i++) {
    const c = patron[i];
    if (c === '\\' && i + 1 < patron.length) {
      const s = patron[++i];
      re += '+?{}()|'.includes(s) ? s : '\\' + s;
      continue;
    }
    re += '+?{}()'.includes(c) ? '\\' + c : c;
  }
  return re;
}

COMANDOS.grep = (ctx) => {
  const o = opciones(ctx.argv.slice(1), 'ivcnEqrlw');
  if (o.error) return noImplementado('grep', `la opción ${o.error}`);
  if (o.flags.has('r')) return noImplementado('grep', 'la opción -r');
  if (!o.resto.length) return { salida: '', error: 'Usage: grep [OPTION]... PATTERNS [FILE]...\n', codigo: 2 };

  const patron = o.resto[0];
  const rutas = o.resto.slice(1);
  let re;
  try {
    const fuente = o.flags.has('E') ? patron : breARegex(patron);
    re = new RegExp(o.flags.has('w') ? `\\b(?:${fuente})\\b` : fuente, o.flags.has('i') ? 'i' : '');
  } catch {
    return { salida: '', error: `grep: ${patron}: expresión regular inválida\n`, codigo: 2 };
  }

  const { partes, error, codigo } = leerEntradas(ctx, 'grep', rutas);
  const prefijo = rutas.length > 1;
  let hallados = 0;
  let salida = '';

  for (const p of partes) {
    const coinciden = lineas(p.contenido)
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => re.test(l) !== o.flags.has('v'));
    hallados += coinciden.length;

    if (o.flags.has('l')) { if (coinciden.length) salida += p.nombre + '\n'; continue; }
    if (o.flags.has('c')) { salida += (prefijo ? `${p.nombre}:` : '') + coinciden.length + '\n'; continue; }
    if (o.flags.has('q')) continue;

    for (const { l, i } of coinciden) {
      salida += (prefijo ? `${p.nombre}:` : '') + (o.flags.has('n') ? `${i + 1}:` : '') + l + '\n';
    }
  }

  // El código de salida de grep es información, no un fallo: 1 significa
  // "no hay coincidencias" y es lo que encadena un `&&` o un `if`.
  const cod = codigo === 1 ? 2 : hallados ? 0 : 1;
  return { salida: o.flags.has('q') ? '' : salida, error, codigo: cod };
};

COMANDOS.sort = (ctx) => {
  const o = opciones(ctx.argv.slice(1), 'nrufb');
  if (o.error) return noImplementado('sort', `la opción ${o.error}`);
  const { partes, error, codigo } = leerEntradas(ctx, 'sort', o.resto);
  let l = partes.flatMap((p) => lineas(p.contenido));

  const clave = (s) => (o.flags.has('f') ? s.toLowerCase() : s);
  // Con -n, las líneas que no empiezan por número valen 0 y quedan empatadas;
  // GNU sort rompe el empate comparando la línea completa. Sin eso, `sort -n`
  // de un CSV con cabecera sale en un orden que no es el de verdad.
  if (o.flags.has('n')) {
    l.sort((a, b) => {
      const d = (parseFloat(a) || 0) - (parseFloat(b) || 0);
      if (d !== 0) return d;
      return clave(a) < clave(b) ? -1 : clave(a) > clave(b) ? 1 : 0;
    });
  }
  else l.sort((a, b) => (clave(a) < clave(b) ? -1 : clave(a) > clave(b) ? 1 : 0));
  if (o.flags.has('r')) l.reverse();
  if (o.flags.has('u')) l = l.filter((v, i) => i === 0 || clave(v) !== clave(l[i - 1]));

  return { salida: texto(l), error, codigo };
};

COMANDOS.uniq = (ctx) => {
  const o = opciones(ctx.argv.slice(1), 'cdiu');
  if (o.error) return noImplementado('uniq', `la opción ${o.error}`);
  const { partes, error, codigo } = leerEntradas(ctx, 'uniq', o.resto);

  const grupos = [];
  for (const l of partes.flatMap((p) => lineas(p.contenido))) {
    const igual = o.flags.has('i')
      ? grupos.length && grupos[grupos.length - 1].l.toLowerCase() === l.toLowerCase()
      : grupos.length && grupos[grupos.length - 1].l === l;
    if (igual) grupos[grupos.length - 1].n++;
    else grupos.push({ l, n: 1 });
  }

  let elegidos = grupos;
  if (o.flags.has('d')) elegidos = grupos.filter((g) => g.n > 1);
  if (o.flags.has('u')) elegidos = grupos.filter((g) => g.n === 1);

  const salida = o.flags.has('c')
    ? texto(elegidos.map((g) => `${String(g.n).padStart(7)} ${g.l}`))
    : texto(elegidos.map((g) => g.l));
  return { salida, error, codigo };
};

COMANDOS.cut = (ctx) => {
  const o = opciones(ctx.argv.slice(1), 's', 'df');
  if (o.error) return noImplementado('cut', `la opción ${o.error}`);
  if (o.valores.f === undefined) {
    return { salida: '', error: 'cut: you must specify a list of bytes, characters, or fields\n', codigo: 1 };
  }
  const sep = o.valores.d ?? '\t';
  const campos = o.valores.f.split(',').flatMap((r) => {
    const m = r.match(/^(\d+)-(\d+)$/);
    if (!m) return [Number(r)];
    const out = [];
    for (let i = Number(m[1]); i <= Number(m[2]); i++) out.push(i);
    return out;
  });

  const { partes, error, codigo } = leerEntradas(ctx, 'cut', o.resto);
  const salida = texto(
    partes.flatMap((p) =>
      lineas(p.contenido).map((l) => {
        if (!l.includes(sep)) return o.flags.has('s') ? null : l;
        const trozos = l.split(sep);
        return campos.filter((n) => n >= 1 && n <= trozos.length).map((n) => trozos[n - 1]).join(sep);
      }).filter((v) => v !== null)
    )
  );
  return { salida, error, codigo };
};

COMANDOS.tr = (ctx) => {
  const o = opciones(ctx.argv.slice(1), 'ds');
  if (o.error) return noImplementado('tr', `la opción ${o.error}`);

  /** Expande los rangos `a-z` y las clases que el examen usa. */
  const juego = (s) => {
    const CLASES = {
      '[:upper:]': 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      '[:lower:]': 'abcdefghijklmnopqrstuvwxyz',
      '[:digit:]': '0123456789',
      '[:space:]': ' \t\n'
    };
    for (const [c, v] of Object.entries(CLASES)) s = s.split(c).join(v);
    let out = '';
    for (let i = 0; i < s.length; i++) {
      if (s[i + 1] === '-' && s[i + 2]) {
        for (let c = s.charCodeAt(i); c <= s.charCodeAt(i + 2); c++) out += String.fromCharCode(c);
        i += 2;
      } else out += s[i];
    }
    return out;
  };

  const de = juego(o.resto[0] ?? '');
  if (o.flags.has('d')) {
    const salida = [...ctx.entrada].filter((c) => !de.includes(c)).join('');
    return { salida, error: '', codigo: 0 };
  }
  if (o.resto.length < 2) return { salida: '', error: 'tr: missing operand\n', codigo: 1 };
  const a = juego(o.resto[1]);
  const salida = [...ctx.entrada].map((c) => {
    const i = de.indexOf(c);
    return i < 0 ? c : a[Math.min(i, a.length - 1)];
  }).join('');
  return { salida, error: '', codigo: 0 };
};

/* ---------- comandos que modifican el sistema de ficheros ---------- */

/** Localiza el directorio padre de una ruta nueva y comprueba que se puede escribir. */
function padreDe(estado, ruta, cmd, verbo) {
  const abs = absoluta(estado, ruta);
  const barra = abs.lastIndexOf('/');
  const dirRuta = barra === 0 ? '/' : abs.slice(0, barra);
  const nombre = abs.slice(barra + 1);
  const r = buscar(estado, dirRuta);
  if (r.error) return { error: `${cmd}: ${verbo} '${ruta}': ${ERRNO[r.error]}\n` };
  if (r.nodo.tipo !== 'd') return { error: `${cmd}: ${verbo} '${ruta}': Not a directory\n` };
  if (!puede(estado, r.nodo, 'w')) return { error: `${cmd}: ${verbo} '${ruta}': Permission denied\n` };
  return { padre: r.nodo, nombre, abs };
}

COMANDOS.mkdir = (ctx) => {
  const o = opciones(ctx.argv.slice(1), 'pv', 'm');
  if (o.error) return noImplementado('mkdir', `la opción ${o.error}`);
  if (!o.resto.length) return { salida: '', error: 'mkdir: missing operand\n', codigo: 1 };

  const est = ctx.estado;
  let error = '';
  let codigo = 0;

  // Con -m el modo lo fija la orden y la umask no interviene: es la diferencia
  // entre pedir un permiso y aceptar el que sobre.
  let atributos = () => atributosNuevos(est);
  if (o.valores.m !== undefined) {
    const modo = calcularModo(0o000, o.valores.m, true);
    if (modo === null) return fallo('mkdir', `invalid mode '${o.valores.m}'`);
    atributos = () => ({ ...atributosNuevos(est), modo });
  }

  for (const ruta of o.resto) {
    if (o.flags.has('p')) {
      let nodo = est.raiz;
      let acumulada = '';
      for (const parte of absoluta(est, ruta).split('/').filter(Boolean)) {
        acumulada += '/' + parte;
        if (!nodo.hijos[parte]) {
          if (!puede(est, nodo, 'w')) { error += `mkdir: cannot create directory '${ruta}': Permission denied\n`; codigo = 1; break; }
          nodo.hijos[parte] = dir(atributos());
        }
        if (nodo.hijos[parte].tipo !== 'd') { error += `mkdir: cannot create directory '${acumulada}': File exists\n`; codigo = 1; break; }
        nodo = nodo.hijos[parte];
      }
      continue;
    }
    const p = padreDe(est, ruta, 'mkdir', 'cannot create directory');
    if (p.error) { error += p.error; codigo = 1; continue; }
    if (p.padre.hijos[p.nombre]) { error += `mkdir: cannot create directory '${ruta}': File exists\n`; codigo = 1; continue; }
    p.padre.hijos[p.nombre] = dir(atributos());
  }
  return { salida: '', error, codigo };
};

/** Dueño, grupo, fecha y modo que recibe algo recién creado, con la umask aplicada. */
function atributosNuevos(estado, base = 0o777) {
  return {
    modo: base & ~estado.umask,
    usuario: estado.usuario,
    grupo: estado.usuario,
    mtime: estado.ahora
  };
}

COMANDOS.rmdir = (ctx) => {
  const o = opciones(ctx.argv.slice(1), 'p');
  if (o.error) return noImplementado('rmdir', `la opción ${o.error}`);
  let error = '';
  let codigo = 0;
  for (const ruta of o.resto) {
    const r = buscar(ctx.estado, ruta);
    if (r.error) { error += `rmdir: failed to remove '${ruta}': ${ERRNO[r.error]}\n`; codigo = 1; continue; }
    if (r.nodo.tipo !== 'd') { error += `rmdir: failed to remove '${ruta}': Not a directory\n`; codigo = 1; continue; }
    if (Object.keys(r.nodo.hijos).length) { error += `rmdir: failed to remove '${ruta}': Directory not empty\n`; codigo = 1; continue; }
    delete r.padre.hijos[r.nombre];
  }
  return { salida: '', error, codigo };
};

COMANDOS.touch = (ctx) => {
  const o = opciones(ctx.argv.slice(1), 'ac');
  if (o.error) return noImplementado('touch', `la opción ${o.error}`);
  if (!o.resto.length) return { salida: '', error: 'touch: missing file operand\n', codigo: 1 };

  let error = '';
  let codigo = 0;
  for (const ruta of o.resto) {
    const r = buscar(ctx.estado, ruta);
    if (!r.error) { r.nodo.mtime = ctx.estado.ahora; continue; }
    if (r.error !== 'ENOENT' || o.flags.has('c')) {
      if (r.error !== 'ENOENT') { error += `touch: cannot touch '${ruta}': ${ERRNO[r.error]}\n`; codigo = 1; }
      continue;
    }
    const p = padreDe(ctx.estado, ruta, 'touch', 'cannot touch');
    if (p.error) { error += p.error; codigo = 1; continue; }
    p.padre.hijos[p.nombre] = fichero('', atributosNuevos(ctx.estado, 0o666));
  }
  return { salida: '', error, codigo };
};

COMANDOS.rm = (ctx) => {
  const o = opciones(ctx.argv.slice(1), 'rRfiv');
  if (o.error) return noImplementado('rm', `la opción ${o.error}`);
  const recursivo = o.flags.has('r') || o.flags.has('R');
  const forzar = o.flags.has('f');
  if (!o.resto.length && !forzar) return { salida: '', error: 'rm: missing operand\n', codigo: 1 };

  let error = '';
  let codigo = 0;
  for (const ruta of o.resto) {
    if (absoluta(ctx.estado, ruta) === '/') {
      error += "rm: it is dangerous to operate recursively on '/'\n" +
               'rm: use --no-preserve-root to override this failsafe\n';
      codigo = 1;
      continue;
    }
    const base = ruta.replace(/\/+$/, '').split('/').pop();
    if (base === '.' || base === '..') {
      error += `rm: refusing to remove '.' or '..' directory: skipping '${ruta}'\n`;
      codigo = 1;
      continue;
    }
    const r = buscar(ctx.estado, ruta, { seguirFinal: false });
    if (r.error) {
      if (!forzar) { error += `rm: cannot remove '${ruta}': ${ERRNO[r.error]}\n`; codigo = 1; }
      continue;
    }
    if (r.nodo.tipo === 'd' && !recursivo) { error += `rm: cannot remove '${ruta}': Is a directory\n`; codigo = 1; continue; }
    if (!puede(ctx.estado, r.padre, 'w')) { error += `rm: cannot remove '${ruta}': Permission denied\n`; codigo = 1; continue; }
    delete r.padre.hijos[r.nombre];
  }
  return { salida: '', error, codigo };
};

COMANDOS.cp = (ctx) => copiarOmover(ctx, 'cp');
COMANDOS.mv = (ctx) => copiarOmover(ctx, 'mv');

function copiarOmover(ctx, cmd) {
  const o = opciones(ctx.argv.slice(1), 'rRfivnp');
  if (o.error) return noImplementado(cmd, `la opción ${o.error}`);
  if (o.resto.length < 2) {
    const falta = o.resto.length === 1 ? `missing destination file operand after '${o.resto[0]}'` : 'missing file operand';
    return { salida: '', error: `${cmd}: ${falta}\n`, codigo: 1 };
  }

  const est = ctx.estado;
  const recursivo = cmd === 'mv' || o.flags.has('r') || o.flags.has('R');
  const origenes = o.resto.slice(0, -1);
  const destinoRuta = o.resto[o.resto.length - 1];
  const dst = buscar(est, destinoRuta);
  const aDirectorio = !dst.error && dst.nodo.tipo === 'd';

  if (origenes.length > 1 && !aDirectorio) {
    return { salida: '', error: `${cmd}: target '${destinoRuta}' is not a directory\n`, codigo: 1 };
  }

  let error = '';
  let codigo = 0;

  for (const origen of origenes) {
    const src = buscar(est, origen);
    if (src.error) {
      error += `${cmd}: cannot stat '${origen}': ${ERRNO[src.error]}\n`;
      codigo = 1;
      continue;
    }
    if (src.nodo.tipo === 'd' && !recursivo) {
      error += `cp: -r not specified; omitting directory '${origen}'\n`;
      codigo = 1;
      continue;
    }
    if (!puede(est, src.nodo, 'r')) {
      error += `${cmd}: cannot open '${origen}' for reading: Permission denied\n`;
      codigo = 1;
      continue;
    }
    const destinoFinal = aDirectorio
      ? absoluta(est, destinoRuta) + '/' + origen.split('/').filter(Boolean).pop()
      : absoluta(est, destinoRuta);
    if (src.nodo.tipo === 'd' && (destinoFinal + '/').startsWith(src.ruta + '/')) {
      error += `${cmd}: cannot copy a directory, '${origen}', into itself, '${destinoRuta}'\n`;
      codigo = 1;
      continue;
    }
    if (src.ruta === destinoFinal) {
      error += `${cmd}: '${origen}' and '${destinoRuta}' are the same file\n`;
      codigo = 1;
      continue;
    }

    let padre;
    let nombre;
    if (aDirectorio) {
      padre = dst.nodo;
      nombre = origen.split('/').filter(Boolean).pop();
    } else {
      const p = padreDe(est, destinoRuta, cmd, 'cannot create regular file');
      if (p.error) { error += p.error; codigo = 1; continue; }
      padre = p.padre;
      nombre = p.nombre;
    }
    if (!puede(est, padre, 'w')) {
      error += `${cmd}: cannot create '${destinoRuta}': Permission denied\n`;
      codigo = 1;
      continue;
    }

    if (cmd === 'mv') {
      padre.hijos[nombre] = src.nodo;
      delete src.padre.hijos[src.nombre];
    } else {
      const copia = clonarNodo(src.nodo);
      copia.mtime = est.ahora;
      if (!o.flags.has('p')) { copia.usuario = est.usuario; copia.grupo = est.usuario; }
      padre.hijos[nombre] = copia;
    }
  }
  return { salida: '', error, codigo };
}

COMANDOS.find = (ctx) => {
  const args = ctx.argv.slice(1);
  const rutas = [];
  let i = 0;
  while (i < args.length && !args[i].startsWith('-')) rutas.push(args[i++]);
  if (!rutas.length) rutas.push('.');

  const pruebas = [];
  let profundidadMax = Infinity;
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === '-name' || a === '-iname') {
      const re = patronARegex(args[++i] ?? '');
      pruebas.push((nombre) => (a === '-iname' ? patronARegex((args[i] ?? '').toLowerCase()).test(nombre.toLowerCase()) : re.test(nombre)));
      continue;
    }
    if (a === '-type') {
      const t = args[++i];
      pruebas.push((_n, nodo) => nodo.tipo === t);
      continue;
    }
    if (a === '-maxdepth') { profundidadMax = Number(args[++i]); continue; }
    return noImplementado('find', `el predicado ${a}`);
  }

  const est = ctx.estado;
  let salida = '';
  let error = '';
  let codigo = 0;

  /** Recorre en el mismo orden en que se creó cada entrada, como hace find. */
  const recorrer = (ruta, nodo, profundidad) => {
    const nombre = ruta.split('/').filter(Boolean).pop() ?? ruta;
    if (pruebas.every((p) => p(nombre, nodo, profundidad))) salida += ruta + '\n';
    if (nodo.tipo !== 'd') return;
    // `-maxdepth` corta antes de entrar: por eso no da «Permission denied» de
    // un directorio ilegible que quedaba fuera del límite.
    if (profundidad >= profundidadMax) return;
    if (!puede(est, nodo, 'r')) {
      error += `find: '${ruta}': Permission denied\n`;
      codigo = 1;
      return;
    }
    for (const [n, h] of Object.entries(nodo.hijos)) {
      recorrer(ruta === '/' ? '/' + n : `${ruta}/${n}`, h, profundidad + 1);
    }
  };

  for (const ruta of rutas) {
    const r = buscar(est, ruta);
    if (r.error) {
      error += `find: '${ruta}': ${ERRNO[r.error]}\n`;
      codigo = 1;
      continue;
    }
    recorrer(ruta.replace(/\/$/, '') || '/', r.nodo, 0);
  }
  return { salida, error, codigo };
};

COMANDOS.chmod = (ctx) => {
  const o = opciones(ctx.argv.slice(1), 'Rv');
  if (o.error) return noImplementado('chmod', `la opción ${o.error}`);
  if (o.resto.length < 2) {
    return { salida: '', error: `chmod: missing operand${o.resto.length ? ` after '${o.resto[0]}'` : ''}\n`, codigo: 1 };
  }

  const spec = o.resto[0];
  const est = ctx.estado;
  let error = '';
  let codigo = 0;

  const aplicar = (nodo, ruta) => {
    if (nodo.usuario !== est.usuario && est.usuario !== 'root') {
      error += `chmod: changing permissions of '${ruta}': Operation not permitted\n`;
      codigo = 1;
      return;
    }
    const nuevo = calcularModo(nodo.modo, spec, nodo.tipo === 'd');
    if (nuevo === null) { error += `chmod: invalid mode: '${spec}'\n`; codigo = 1; return; }
    nodo.modo = nuevo;
    if (o.flags.has('R') && nodo.tipo === 'd') {
      for (const [n, h] of Object.entries(nodo.hijos)) aplicar(h, `${ruta}/${n}`);
    }
  };

  for (const ruta of o.resto.slice(1)) {
    const r = buscar(est, ruta);
    if (r.error) { error += `chmod: cannot access '${ruta}': ${ERRNO[r.error]}\n`; codigo = 1; continue; }
    aplicar(r.nodo, ruta);
  }
  return { salida: '', error, codigo };
};

/**
 * Calcula el modo resultante, en octal o en simbólico.
 *
 * @param {number} actual  Modo previo.
 * @param {string} spec    `755`, `u+x`, `go-w`, `a=r`, `+x`…
 * @param {boolean} esDir  `X` mayúscula solo afecta a directorios y a lo ya ejecutable.
 * @returns {number|null} Modo nuevo, o `null` si la especificación es inválida.
 */
export function calcularModo(actual, spec, esDir) {
  if (/^[0-7]{1,4}$/.test(spec)) return parseInt(spec, 8);

  let modo = actual;
  for (const clausula of spec.split(',')) {
    const m = clausula.match(/^([ugoa]*)([+\-=])([rwxXst]*)$/);
    if (!m) return null;
    const quien = m[1] || 'a';
    const op = m[2];
    const que = m[3];

    let bits = 0;
    if (que.includes('r')) bits |= 4;
    if (que.includes('w')) bits |= 2;
    if (que.includes('x')) bits |= 1;
    if (que.includes('X') && (esDir || actual & 0o111)) bits |= 1;

    const triadas = [];
    if (quien.includes('u') || quien.includes('a')) triadas.push(6);
    if (quien.includes('g') || quien.includes('a')) triadas.push(3);
    if (quien.includes('o') || quien.includes('a')) triadas.push(0);

    for (const t of triadas) {
      if (op === '+') modo |= bits << t;
      else if (op === '-') modo &= ~(bits << t);
      else modo = (modo & ~(7 << t)) | (bits << t);
    }
    if (que.includes('s')) {
      if (quien.includes('u') || quien.includes('a')) modo = op === '-' ? modo & ~0o4000 : modo | 0o4000;
      if (quien.includes('g') || quien.includes('a')) modo = op === '-' ? modo & ~0o2000 : modo | 0o2000;
    }
    if (que.includes('t')) modo = op === '-' ? modo & ~0o1000 : modo | 0o1000;
  }
  return modo;
}

COMANDOS.umask = (ctx) => {
  const arg = ctx.argv[1];
  if (arg === undefined) return { salida: '0' + ctx.estado.umask.toString(8).padStart(3, '0') + '\n', error: '', codigo: 0 };
  if (!/^[0-7]{1,4}$/.test(arg)) return fallo('bash: umask', `${arg}: invalid symbolic mode operator`);
  ctx.estado.umask = parseInt(arg, 8);
  return { salida: '', error: '', codigo: 0 };
};

COMANDOS.id = (ctx) => {
  const est = ctx.estado;
  const u = est.uids[est.usuario];
  if (u === undefined) return fallo('id', `${est.usuario}: no such user`);
  const grupos = (est.grupos ?? []).map((g) => `${est.gids[g]}(${g})`).join(',');
  return {
    salida: `uid=${u}(${est.usuario}) gid=${est.gids[est.usuario]}(${est.usuario}) groups=${grupos}\n`,
    error: '',
    codigo: 0
  };
};

COMANDOS.type = (ctx) => {
  const nombre = ctx.argv[1];
  if (!nombre) return { salida: '', error: '', codigo: 0 };
  if (['cd', 'echo', 'pwd', 'umask', 'type', 'exit'].includes(nombre)) {
    return { salida: `${nombre} is a shell builtin\n`, error: '', codigo: 0 };
  }
  if (COMANDOS[nombre]) return { salida: `${nombre} is /usr/bin/${nombre}\n`, error: '', codigo: 0 };
  return { salida: '', error: `bash: type: ${nombre}: not found\n`, codigo: 1 };
};

COMANDOS.ln = (ctx) => {
  const o = opciones(ctx.argv.slice(1), 'sfnv');
  if (o.error) return noImplementado('ln', `la opción ${o.error}`);
  if (!o.flags.has('s')) return noImplementado('ln', 'el enlace duro (sin -s)');
  if (o.resto.length < 2) return { salida: '', error: `ln: missing operand after '${o.resto[0] ?? ''}'\n`, codigo: 1 };

  const est = ctx.estado;
  const destino = o.resto[0];
  const nombreEnlace = o.resto[1];
  const dst = buscar(est, nombreEnlace, { seguirFinal: false });

  let padre;
  let nombre;
  if (!dst.error && dst.nodo.tipo === 'd') {
    padre = dst.nodo;
    nombre = destino.split('/').filter(Boolean).pop();
  } else {
    const pd = padreDe(est, nombreEnlace, 'ln', 'failed to create symbolic link');
    if (pd.error) return { salida: '', error: pd.error, codigo: 1 };
    padre = pd.padre;
    nombre = pd.nombre;
  }
  if (padre.hijos[nombre] && !o.flags.has('f')) {
    return { salida: '', error: `ln: failed to create symbolic link '${nombreEnlace}': File exists\n`, codigo: 1 };
  }
  // Un enlace simbólico guarda el texto de la ruta, no el nodo: por eso puede
  // apuntar a algo que no existe y seguir existiendo él.
  padre.hijos[nombre] = enlace(destino, { usuario: est.usuario, grupo: est.usuario, mtime: est.ahora });
  return { salida: '', error: '', codigo: 0 };
};

COMANDOS.export = (ctx) => {
  for (const a of ctx.argv.slice(1)) {
    const i = a.indexOf('=');
    if (i > 0) ctx.estado.entorno[a.slice(0, i)] = a.slice(i + 1);
  }
  return { salida: '', error: '', codigo: 0 };
};

/**
 * `test` y `[` son el mismo programa, y son un **comando**, no una sintaxis.
 * De ahí las dos cosas que el examen pregunta: que `[` exija espacios a los
 * lados porque es el nombre de un ejecutable, y que su respuesta sea un código
 * de salida y no un texto.
 */
function probar(ctx, a) {
  const est = ctx.estado;
  const verdad = (b) => ({ salida: '', error: '', codigo: b ? 0 : 1 });

  if (a[0] === '!' && a.length > 1) {
    const r = probar(ctx, a.slice(1));
    return { ...r, codigo: r.codigo === 0 ? 1 : 0 };
  }
  if (a.length === 0) return verdad(false);
  if (a.length === 1) return verdad(a[0] !== '');

  if (a.length === 2) {
    const [op, x] = a;
    if (op === '-z') return verdad(x === '');
    if (op === '-n') return verdad(x !== '');
    const r = buscar(est, x);
    const existe = !r.error;
    if (op === '-e') return verdad(existe);
    if (op === '-f') return verdad(existe && r.nodo.tipo === 'f');
    if (op === '-d') return verdad(existe && r.nodo.tipo === 'd');
    if (op === '-s') return verdad(existe && tamano(r.nodo) > 0);
    if (op === '-r') return verdad(existe && puede(est, r.nodo, 'r'));
    if (op === '-w') return verdad(existe && puede(est, r.nodo, 'w'));
    if (op === '-x') return verdad(existe && puede(est, r.nodo, 'x'));
    return { salida: '', error: `bash: test: ${op}: unary operator expected\n`, codigo: 2 };
  }

  if (a.length === 3) {
    const [x, op, y] = a;
    if (op === '=' || op === '==') return verdad(x === y);
    if (op === '!=') return verdad(x !== y);
    const numericos = {
      '-eq': (p, q) => p === q, '-ne': (p, q) => p !== q,
      '-lt': (p, q) => p < q, '-le': (p, q) => p <= q,
      '-gt': (p, q) => p > q, '-ge': (p, q) => p >= q
    };
    if (numericos[op]) return verdad(numericos[op](Number(x), Number(y)));
    return { salida: '', error: `bash: test: ${op}: binary operator expected\n`, codigo: 2 };
  }
  return { salida: '', error: 'bash: test: too many arguments\n', codigo: 2 };
}

COMANDOS.test = (ctx) => probar(ctx, ctx.argv.slice(1));

COMANDOS['['] = (ctx) => {
  const args = ctx.argv.slice(1);
  if (args[args.length - 1] !== ']') return { salida: '', error: "bash: [: missing `]'\n", codigo: 2 };
  return probar(ctx, args.slice(0, -1));
};

COMANDOS.true = () => ({ salida: '', error: '', codigo: 0 });
COMANDOS.false = () => ({ salida: '', error: '', codigo: 1 });

/* ===== 9. MOTOR ===== */

/**
 * Aplica las redirecciones de una orden y la ejecuta.
 *
 * @param {object} estado
 * @param {object} orden    Nodo del parser: `{palabras, redir}`.
 * @param {string} entrada  Lo que llega por la tubería.
 * @returns {{salida:string, error:string, codigo:number}}
 */
function ejecutarOrden(estado, orden, entrada) {
  const argv = orden.palabras.flatMap((p) => expandirPalabra(estado, p));

  // Las redirecciones de salida se abren ANTES de ejecutar nada: bash crea o
  // vacía el fichero al abrirlo, y si no puede, el comando no llega a
  // ejecutarse. Por eso `chmod 400 f && echo x > f` no imprime la x en ningún
  // sitio, ni siquiera por pantalla.
  for (const r of orden.redir) {
    if (r.op !== '>' && r.op !== '>>' && r.op !== '2>' && r.op !== '2>>') continue;
    const err = abrir(estado, r.fichero, r.op === '>' || r.op === '2>');
    if (err) return { salida: '', error: err, codigo: 1 };
  }

  // Una orden que solo redirige ya ha hecho su trabajo al abrir: `> vacio`.
  if (!argv.length) return { salida: '', error: '', codigo: 0 };

  let stdin = entrada;
  for (const r of orden.redir.filter((x) => x.op === '<')) {
    const b = buscar(estado, r.fichero);
    if (b.error) return { salida: '', error: `bash: ${r.fichero}: ${ERRNO[b.error]}\n`, codigo: 1 };
    if (b.nodo.tipo === 'd') return { salida: '', error: `bash: ${r.fichero}: Is a directory\n`, codigo: 1 };
    if (!puede(estado, b.nodo, 'r')) return { salida: '', error: `bash: ${r.fichero}: Permission denied\n`, codigo: 1 };
    stdin = b.nodo.contenido;
  }

  // Estructuras de control: bash las entiende, este núcleo todavía no. Se
  // declara en vez de intentar ejecutar `for` como si fuera un programa, que
  // es lo que daría una cascada de errores inventados.
  if (CLAVES.includes(argv[0])) return noImplementado('bash', `la estructura de control \`${argv[0]}\``);

  // Asignaciones delante de la orden. Solas, se quedan en el entorno del shell;
  // delante de un comando, valen solo para ese comando.
  const asignaciones = [];
  while (argv.length && /^[A-Za-z_]\w*=/.test(argv[0])) asignaciones.push(argv.shift());
  if (!argv.length) {
    for (const a of asignaciones) {
      const i = a.indexOf('=');
      estado.entorno[a.slice(0, i)] = a.slice(i + 1);
    }
    return { salida: '', error: '', codigo: 0 };
  }
  const previos = asignaciones.map((a) => {
    const i = a.indexOf('=');
    const nombre = a.slice(0, i);
    const anterior = estado.entorno[nombre];
    estado.entorno[nombre] = a.slice(i + 1);
    return { nombre, anterior };
  });

  const cmd = COMANDOS[argv[0]];
  if (!cmd) {
    for (const { nombre, anterior } of previos) estado.entorno[nombre] = anterior;
    return { salida: '', error: `bash: ${argv[0]}: command not found\n`, codigo: 127 };
  }

  let res = cmd({ estado, argv, entrada: stdin });
  for (const { nombre, anterior } of previos) {
    if (anterior === undefined) delete estado.entorno[nombre];
    else estado.entorno[nombre] = anterior;
  }

  for (const r of orden.redir) {
    // `2>&1` no escribe en ningún fichero: manda el error por la misma tubería
    // que la salida, y por eso `ls nope 2>&1 | wc -l` cuenta una línea.
    if (r.op === '2>&1') { res = { ...res, salida: res.salida + res.error, error: '' }; continue; }
    // El fichero ya está abierto y vaciado: aquí solo se añade.
    if (r.op === '>' || r.op === '>>') {
      escribir(estado, r.fichero, res.salida, true);
      res = { ...res, salida: '' };
    }
    if (r.op === '2>' || r.op === '2>>') {
      escribir(estado, r.fichero, res.error, true);
      res = { ...res, error: '' };
    }
  }
  return res;
}

/**
 * Expande una palabra completa, en el orden en que lo hace bash y respetando
 * el tipo de comilla de cada segmento: sustitución de órdenes y variables en lo
 * que no va entre comillas simples, y llaves y comodines solo en lo que no va
 * entre comillas de ninguna clase.
 *
 * @param {object} estado
 * @param {object} palabra  Token de palabra con sus segmentos.
 * @returns {string[]} Una palabra, o varias si hubo llaves o comodines.
 */
function expandirPalabra(estado, palabra) {
  let texto = '';
  let sinComillas = true;

  for (const seg of palabra.segmentos) {
    if (seg.tipo === 'simple') { texto += seg.texto; sinComillas = false; continue; }
    if (seg.tipo === 'doble') sinComillas = false;
    texto += expandirVariables(estado, sustituirOrdenes(estado, seg.texto));
  }

  if (!sinComillas) return [texto];
  return expandirLlaves(texto).flatMap((t) => expandir(estado, t));
}

/**
 * Resuelve `$( … )` ejecutando lo de dentro y quedándose con su salida sin los
 * saltos finales.
 *
 * Comparte el sistema de ficheros con el shell padre —un `$(touch x)` crea el
 * fichero de verdad— pero devuelve el directorio de trabajo a donde estaba,
 * porque una subshell no arrastra el `cd` de su padre.
 */
function sustituirOrdenes(estado, texto) {
  if (!texto.includes('$(')) return texto;
  let out = '';

  for (let i = 0; i < texto.length; i++) {
    if (texto[i] === '$' && texto[i + 1] === '(') {
      let nivel = 0;
      let j = i + 1;
      for (; j < texto.length; j++) {
        if (texto[j] === '(') nivel++;
        else if (texto[j] === ')' && --nivel === 0) break;
      }
      const cwdAntes = estado.cwd;
      const r = ejecutar(estado, texto.slice(i + 2, j));
      estado.cwd = cwdAntes;
      out += r.salida.replace(/\n+$/, '');
      i = j;
      continue;
    }
    out += texto[i];
  }
  return out;
}

/**
 * Abre un fichero para escritura, creándolo o vaciándolo según el operador.
 * Devuelve el mensaje de error, o '' si se pudo abrir.
 */
function abrir(estado, ruta, truncar) {
  const b = buscar(estado, ruta);
  if (!b.error) {
    if (b.nodo.tipo === 'd') return `bash: ${ruta}: Is a directory\n`;
    if (!puede(estado, b.nodo, 'w')) return `bash: ${ruta}: Permission denied\n`;
    if (b.nodo.tipo !== 'c' && truncar) { b.nodo.contenido = ''; b.nodo.mtime = estado.ahora; }
    return '';
  }
  if (b.error !== 'ENOENT') return `bash: ${ruta}: ${ERRNO[b.error]}\n`;
  const p = padreDe(estado, ruta, 'bash', '');
  if (p.error) return `bash: ${ruta}: ${p.error.includes('Permission') ? 'Permission denied' : 'No such file or directory'}\n`;
  p.padre.hijos[p.nombre] = fichero('', atributosNuevos(estado, 0o666));
  return '';
}

/** Escribe (o añade) en un fichero del VFS. Devuelve el mensaje de error, o ''. */
function escribir(estado, ruta, contenido, anadir) {
  const b = buscar(estado, ruta);
  if (!b.error) {
    if (b.nodo.tipo === 'd') return `bash: ${ruta}: Is a directory\n`;
    if (!puede(estado, b.nodo, 'w')) return `bash: ${ruta}: Permission denied\n`;
    if (b.nodo.tipo === 'c') return '';  // /dev/null
    b.nodo.contenido = anadir ? b.nodo.contenido + contenido : contenido;
    b.nodo.mtime = estado.ahora;
    return '';
  }
  if (b.error !== 'ENOENT') return `bash: ${ruta}: ${ERRNO[b.error]}\n`;
  const p = padreDe(estado, ruta, 'bash', '');
  if (p.error) return `bash: ${ruta}: ${p.error.includes('Permission') ? 'Permission denied' : 'No such file or directory'}\n`;
  p.padre.hijos[p.nombre] = fichero(contenido, atributosNuevos(estado, 0o666));
  return '';
}

/**
 * Ejecuta una línea completa: tuberías, `&&`, `||` y `;` incluidos.
 *
 * Muta `estado` igual que lo haría un shell de verdad —un `cp` de tres ficheros
 * que falla en el segundo deja el primero copiado—. Si hace falta deshacer,
 * el llamador clona antes con `clonar()`.
 *
 * @param {object} estado  Estado del shell.
 * @param {string} linea   Lo que el usuario ha escrito.
 * @returns {{salida:string, error:string, codigo:number}}
 */
export function ejecutar(estado, linea) {
  const t = trocear(linea);
  if (t.error) return { salida: '', error: `bash: ${t.error}\n`, codigo: 2 };
  const p = parsear(t.tokens);
  if (p.error) return { salida: '', error: `bash: ${p.error}\n`, codigo: 2 };

  let salida = '';
  let error = '';
  let codigo = estado.ultimoCodigo ?? 0;
  let primera = true;

  for (const grupo of p.lista) {
    if (!primera) {
      if (grupo.union === '&&' && codigo !== 0) continue;
      if (grupo.union === '||' && codigo === 0) continue;
    }
    primera = false;

    let tuberia = '';
    for (const orden of grupo.ordenes) {
      const res = ejecutarOrden(estado, orden, tuberia);
      tuberia = res.salida;
      error += res.error;
      codigo = res.codigo;
      estado.ultimoCodigo = codigo;
    }
    salida += tuberia;
  }

  estado.ultimoCodigo = codigo;
  return { salida, error, codigo };
}

/** Los comandos que este prototipo conoce, para poder listarlos en las pruebas. */
export const IMPLEMENTADOS = Object.keys(COMANDOS).sort();

/* ===== 10. ÁRBOL DE PARTIDA ===== */

/**
 * Estado inicial del shell, con un árbol pequeño pero suficiente para ejercitar
 * los casos que rompen la fidelidad: nombres que ordenan raro, un fichero
 * antiguo (columna de año en `ls -l`), uno sin permiso de lectura, un
 * directorio vacío, ficheros ocultos y bits especiales.
 *
 * @param {object} opts
 * @param {number} opts.ahora    Instante actual en segundos. Es un dato, no un reloj.
 * @param {string} [opts.usuario]
 * @returns {object} Estado listo para `ejecutar()`.
 */
export function estadoInicial({ ahora, usuario = 'jorge' } = {}) {
  const dia = 86400;
  const attr = (mtime, modo) => ({ usuario, grupo: usuario, mtime, modo });

  const casa = dir({
    ...attr(ahora - 2 * dia, 0o755),
    hijos: {
      'notas.txt': fichero('comprar pan\nrevisar permisos\nestudiar find\n', attr(ahora - 3 * dia, 0o644)),
      'informe.log': fichero(
        'INFO arranque\nWARN disco al 81%\nERROR fallo de red\nINFO reintento\nERROR fallo de red\n',
        attr(ahora - dia, 0o644)
      ),
      'datos.csv': fichero('nombre,edad,ciudad\nana,34,vigo\nluis,29,leon\nmar,41,vigo\n', attr(ahora - 5 * dia, 0o644)),
      'antiguo.txt': fichero('de la era anterior\n', attr(ahora - 300 * dia, 0o644)),
      'secreto.txt': fichero('no deberias poder leer esto\n', attr(ahora - dia, 0o000)),
      'vacio.txt': fichero('', attr(ahora - dia, 0o644)),
      'script.sh': fichero('#!/bin/bash\necho hola\n', attr(ahora - dia, 0o755)),
      '.bashrc': fichero('export EDITOR=vi\n', attr(ahora - 100 * dia, 0o644)),
      '.perfil': fichero('oculto\n', attr(ahora - 100 * dia, 0o644)),
      proyectos: dir({
        ...attr(ahora - dia, 0o755),
        hijos: {
          'a.sh': fichero('echo a\n', attr(ahora - dia, 0o755)),
          'b.sh': fichero('echo b\n', attr(ahora - dia, 0o644)),
          'leeme.md': fichero('# proyectos\n', attr(ahora - dia, 0o644)),
          interno: dir({ ...attr(ahora - dia, 0o755), hijos: { 'c.sh': fichero('echo c\n', attr(ahora - dia, 0o755)) } })
        }
      }),
      vacio: dir(attr(ahora - dia, 0o755)),
      cerrado: dir({ ...attr(ahora - dia, 0o000), hijos: { 'dentro.txt': fichero('invisible\n', attr(ahora - dia, 0o644)) } })
    }
  });

  return {
    raiz: dir({
      modo: 0o755,
      hijos: {
        home: dir({ modo: 0o755, hijos: { [usuario]: casa } }),
        tmp: dir({ modo: 0o1777 }),
        dev: dir({ modo: 0o755, hijos: { null: dispositivo(), zero: dispositivo() } }),
        etc: dir({ modo: 0o755, hijos: { hostname: fichero('debian\n', { mtime: ahora - 400 * dia }) } }),
        root: dir({ modo: 0o700 })
      }
    }),
    cwd: `/home/${usuario}`,
    usuario,
    grupos: [usuario],
    uids: { [usuario]: 1000, root: 0 },
    gids: { [usuario]: 1000, root: 0 },
    umask: 0o022,
    entorno: { HOME: `/home/${usuario}`, USER: usuario, SHELL: '/bin/bash', PATH: '/usr/local/bin:/usr/bin:/bin' },
    ahora,
    ultimoCodigo: 0
  };
}
