/**
 * Extrae el banco de preguntas y el núcleo puro de la aplicación del examen
 * para poder probarlos con `node --test`, sin navegador y sin partir el HTML.
 *
 * La aplicación es un archivo único a propósito: tiene que funcionar abierta
 * como file://, así que no puede usar módulos ES. Este extractor es el precio
 * de esa decisión, y a cambio convierte la regla arquitectónica "el núcleo no
 * toca el navegador" en algo que se comprueba solo.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = resolve(RAIZ, 'lpi_practice_exam/index.html');
const GENERADO = resolve(RAIZ, 'tests/.core.generated.mjs');

const MARCA_INICIO = '/* ===== NUCLEO PURO — INICIO';
const MARCA_FIN = '/* ===== NUCLEO PURO — FIN';

/** Identificadores que el núcleo no puede tocar sin dejar de ser puro. */
const PROHIBIDOS = ['document', 'localStorage', 'sessionStorage', 'fetch', 'XMLHttpRequest', 'Date.now', 'Math.random', 'crypto'];

/**
 * Elimina comentarios para que la guardia de pureza no se dispare con las
 * explicaciones que precisamente nombran lo que está prohibido.
 *
 * @param {string} src  Código JavaScript.
 * @returns {string} El mismo código con los comentarios sustituidos por espacios.
 */
function sinComentarios(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/**
 * Separa los bloques <script> del HTML.
 *
 * @param {string} html  Contenido completo del archivo de la aplicación.
 * @returns {string[]} El contenido de cada bloque, en orden de aparición.
 */
function bloquesScript(html) {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

/**
 * Localiza la región del núcleo puro entre sus marcadores.
 *
 * @param {string} js  Código del bloque de lógica.
 * @returns {string} El código comprendido entre los marcadores, sin incluirlos.
 * @throws {Error} Si falta alguno de los dos marcadores.
 */
function regionNucleo(js) {
  const i = js.indexOf(MARCA_INICIO);
  const f = js.indexOf(MARCA_FIN);
  if (i < 0) throw new Error(`No se encontró el marcador de inicio del núcleo: ${MARCA_INICIO}`);
  if (f < 0) throw new Error(`No se encontró el marcador de fin del núcleo: ${MARCA_FIN}`);
  if (f < i) throw new Error('El marcador de fin del núcleo aparece antes que el de inicio');
  return js.slice(js.indexOf('*/', i) + 2, f);
}

/**
 * Comprueba que el núcleo no depende del navegador.
 *
 * @param {string} nucleo  Código de la región del núcleo.
 * @returns {string[]} Identificadores prohibidos encontrados; vacío si está limpio.
 */
export function violacionesDePureza(nucleo) {
  const limpio = sinComentarios(nucleo);
  return PROHIBIDOS.filter((id) => {
    const patron = id.includes('.')
      ? new RegExp(id.replace('.', '\\s*\\.\\s*'))
      : new RegExp(`\\b${id}\\b`);
    return patron.test(limpio);
  });
}

/**
 * Nombres declarados en el primer nivel de la región, para exportarlos.
 *
 * @param {string} nucleo  Código de la región del núcleo.
 * @returns {string[]} Nombres de funciones y constantes de primer nivel.
 */
function nombresExportables(nucleo) {
  const nombres = new Set();
  for (const m of nucleo.matchAll(/^function\s+([A-Za-z_$][\w$]*)/gm)) nombres.add(m[1]);
  for (const m of nucleo.matchAll(/^const\s+([A-Za-z_$][\w$]*)\s*=/gm)) nombres.add(m[1]);
  return [...nombres];
}

/**
 * Genera el módulo con el banco de preguntas y el núcleo, listo para importar.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.escribir=true]  Si debe volcar el módulo a disco.
 * @returns {{ruta:string, fuente:string, exportados:string[]}} Módulo generado.
 * @throws {Error} Si faltan los marcadores o el núcleo viola la regla de pureza.
 */
export function generarModuloNucleo({ escribir = true } = {}) {
  const html = readFileSync(HTML, 'utf8');
  const bloques = bloquesScript(html);
  const logica = bloques[bloques.length - 1];
  const banco = bloques.slice(0, -1).join('\n');
  const nucleo = regionNucleo(logica);

  const violaciones = violacionesDePureza(nucleo);
  if (violaciones.length) {
    throw new Error(
      `El núcleo puro no puede usar: ${violaciones.join(', ')}. ` +
      'Pasa esos valores como parámetros desde la capa de orquestación.'
    );
  }

  // Q vive en los bloques del banco, fuera de la región, pero las pruebas lo
  // necesitan para construir historiales con preguntas reales.
  const exportados = ['Q', ...nombresExportables(nucleo)];
  const fuente = [
    '// GENERADO por tools/extract-core.mjs — no editar a mano.',
    banco,
    nucleo,
    `export { ${exportados.join(', ')} };`,
    ''
  ].join('\n');

  if (escribir) writeFileSync(GENERADO, fuente, 'utf8');
  return { ruta: GENERADO, fuente, exportados };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { ruta, exportados } = generarModuloNucleo();
  console.log(`núcleo extraído → ${ruta}`);
  console.log(`exporta ${exportados.length} símbolos: ${exportados.join(', ')}`);
}
