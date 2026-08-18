/**
 * Carga la aplicación del examen en Node con un navegador simulado.
 *
 * El núcleo puro se prueba extrayéndolo (ver tools/extract-core.mjs). Las
 * bandas de adaptadores y orquestación no se pueden extraer porque su razón
 * de ser es hablar con el navegador, así que se prueban cargando la app entera
 * sobre un DOM de mentira y un almacenamiento que sabe fallar a voluntad.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = resolve(RAIZ, 'lpi_practice_exam/index.html');

/**
 * Documento simulado que recuerda lo que se escribe en cada selector y los
 * escuchadores registrados, para poder observar el render y disparar clics.
 */
function documentoObservable() {
  const escrito = {};
  const escuchas = {};
  const nodos = {};

  const crear = (sel) => {
    if (nodos[sel]) return nodos[sel];
    const nodo = {
      get innerHTML() { return escrito[sel] || ''; },
      set innerHTML(v) { escrito[sel] = String(v); },
      textContent: '', value: '', className: '', disabled: false,
      id: String(sel).replace('#', ''),
      classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
      dataset: {}, style: {},
      addEventListener(ev, fn) {
        escuchas[sel] = escuchas[sel] || {};
        (escuchas[sel][ev] = escuchas[sel][ev] || []).push(fn);
      },
      appendChild() {}, removeChild() {}, remove() {},
      click() {}, focus() {}, setAttribute() {}, dispatchEvent() {}
    };
    nodos[sel] = nodo;
    return nodo;
  };

  return {
    escrito,
    documento: {
      querySelector: crear,
      querySelectorAll: () => [],
      createElement: () => crear('__creado__'),
      addEventListener() {},
      body: crear('body')
    },
    /** Ejecuta los escuchadores registrados para un selector y evento. */
    disparar(sel, ev = 'click', evento = { preventDefault() {}, target: crear(sel) }) {
      const fns = (escuchas[sel] || {})[ev] || [];
      if (!fns.length) throw new Error(`no hay escuchadores de "${ev}" en ${sel}`);
      return fns.map((fn) => fn(evento));
    }
  };
}

/** Nodo que acepta cualquier operación del DOM sin romperse. */
function nodoFalso() {
  const nodo = new Proxy(function () {}, {
    get(_t, p) {
      if (p === 'classList') return { toggle() {}, add() {}, remove() {}, contains: () => false };
      if (p === 'dataset') return {};
      if (p === 'style') return {};
      if (['textContent', 'innerHTML', 'value', 'className', 'id'].includes(p)) return '';
      if (p === 'tagName') return 'DIV';
      if (p === Symbol.toPrimitive) return () => '';
      return nodo;
    },
    set: () => true,
    apply: () => nodo
  });
  return nodo;
}

/**
 * Almacenamiento controlable.
 *
 * @param {object} [opts]
 * @param {object} [opts.inicial]   Contenido de partida, clave → valor.
 * @param {function|boolean} [opts.fallaEscritura]  true para fallar siempre, o
 *        una función (clave, intento) → boolean para decidir caso por caso.
 */
export function almacenFalso({ inicial = {}, fallaEscritura = false } = {}) {
  const datos = { ...inicial };
  let escrituras = 0;
  const debeFallar = (clave) => {
    escrituras++;
    if (typeof fallaEscritura === 'function') return fallaEscritura(clave, escrituras);
    return Boolean(fallaEscritura);
  };
  return {
    datos,
    get escrituras() { return escrituras; },
    getItem: (k) => (k in datos ? datos[k] : null),
    setItem(k, v) {
      if (debeFallar(k)) {
        const e = new Error('cuota agotada');
        e.name = 'QuotaExceededError';
        throw e;
      }
      datos[k] = String(v);
    },
    removeItem(k) { delete datos[k]; }
  };
}

/**
 * Evalúa la aplicación completa y devuelve sus funciones internas.
 *
 * @param {object} [opts]
 * @param {object} [opts.almacen]  Almacenamiento a inyectar; por defecto uno vacío que funciona.
 * @param {function} [opts.fetchImpl]  Implementación de fetch; por defecto falla como si no hubiera red.
 * @returns {object} Las funciones de la app más `almacen` y `llamadasFetch`.
 */
export function cargarApp({ almacen = almacenFalso(), fetchImpl, confirmar = true } = {}) {
  const html = readFileSync(HTML, 'utf8');
  const js = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');

  const llamadasFetch = [];
  // El navegador entra como parámetros, no como globales: así cada app cargada
  // tiene su propio almacenamiento y dos instancias no se pisan entre sí.
  const observable = documentoObservable();
  const documento = observable.documento;
  const ventana = {
    addEventListener() {},
    scrollTo() {},
    crypto: globalThis.crypto,
    URL: { createObjectURL: () => 'blob:falso', revokeObjectURL() {} }
  };
  const fetchFalso = fetchImpl || (async (url, opciones) => {
    llamadasFetch.push({ url, opciones });
    throw new Error('sin red');
  });

  const exportar = [
    'store', 'loadHistory', 'saveHistory', 'recordAttemptStats', 'onAttemptFinished',
    'importProgress', 'exportProgress', 'clearProgress', 'loadStored', 'show', 'recordAttempt',
    'queueRead', 'buildHistoryEntry', 'computeStats', 'byId', 'Q',
    'statsSummaryHtml', 'statsTableHtml', 'leechListHtml', 'renderStats', 'showStats',
    'HISTORY_KEY', 'STORE_KEY', 'LANG_KEY', 'NAME_KEY', 'QUEUE_KEY', 'MAX_HISTORIAL', 'HISTORY_V'
  ];
  const fabrica = new Function(
    'document', 'window', 'localStorage', 'fetch', 'alert', 'confirm',
    `${js}\n;return { ${exportar.join(', ')} };`
  );
  const app = fabrica(documento, ventana, almacen, fetchFalso, () => {}, () => confirmar);

  return {
    ...app, almacen, llamadasFetch, documento, ventana,
    escrito: observable.escrito,
    disparar: observable.disparar
  };
}
