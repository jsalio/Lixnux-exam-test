/**
 * Pruebas de las bandas de adaptadores y orquestación.
 * Plan: docs/specs/estadisticas-preparacion-por-tema.tdd-plan.md — iteración 4.
 *
 * Estas no se pueden probar extrayendo el núcleo: su razón de ser es hablar con
 * el navegador. Se cargan sobre el DOM simulado de tests/browser-stub.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cargarApp, almacenFalso } from './browser-stub.mjs';

const HISTORY_KEY = 'lpi-010-160-historial';
const STORE_KEY = 'lpi-010-160-attempt-v1';
const LANG_KEY = 'lpi-010-160-lang';
const NAME_KEY = 'lpi-010-160-nombre';
const QUEUE_KEY = 'lpi-010-160-cola';

let contador = 0;
const cid = () => `00000000-0000-4000-8000-${String(++contador).padStart(12, '0')}`;

/** Intento finalizado con preguntas reales del banco. */
function intentoFinalizado(app, { n = 6, acertadas = 4, identificador = cid() } = {}) {
  const items = app.Q.slice(0, n).map((q, i) => ({
    id: q.id,
    oidx: q.type === 'fill' ? [] : q.o.map((_, k) => k),
    ans: i < acertadas
      ? (q.type === 'fill' ? q.accept[0] : (q.type === 'multi' ? q.a.slice() : q.a[0]))
      : (q.type === 'multi' ? [] : null),
    marked: false
  }));
  return { mode: 'full', cid: identificador, finished: true, limitMs: 0, elapsedMs: 60_000, idx: 0, items };
}

/** Historial serializado con `cuantos` intentos válidos. */
function historialSerializado(app, cuantos) {
  const intentos = [];
  for (let i = 0; i < cuantos; i++) {
    intentos.push(app.buildHistoryEntry(intentoFinalizado(app), 1_700_000_000_000 + i * 60_000));
  }
  return JSON.stringify({ v: 1, intentos });
}

const payloadMinimo = () => ({
  client_attempt_id: cid(), usuario_nombre: 'Jorge', modo: 'completo',
  total_preguntas: 5, limite_minutos: null, correctas: 5, incorrectas: 0, sin_responder: 0,
  porcentaje: 100, puntuacion_escala: 800, duracion_segundos: 10,
  desglose_temas: {}, idioma: 'both', app_version: '1.0.0+bank145'
});

/* ================= Iteración 4 ================= */

test('4.1 dado un almacenamiento que rechaza la escritura cuando guardo entonces el store devuelve falso', () => {
  const app = cargarApp({ almacen: almacenFalso({ fallaEscritura: true }) });
  assert.equal(app.store.write('cualquier-clave', 'valor'), false);

  const sano = cargarApp();
  assert.equal(sano.store.write('cualquier-clave', 'valor'), true);
  assert.equal(sano.store.read('cualquier-clave'), 'valor');
});

test('4.2 dado que la cola no pudo escribirse cuando registro un intento entonces no informa de que quedó encolado', async () => {
  const app = cargarApp({ almacen: almacenFalso({ fallaEscritura: true }) });
  const r = await app.recordAttempt(payloadMinimo());
  assert.equal(r.ok, false);
  assert.equal(r.encolado, false,
    'sin cola no puede prometerse un reintento: el intento se perdería en silencio');
});

test('4.2b dado un almacenamiento sano y la red caída cuando registro un intento entonces queda encolado de verdad', async () => {
  const app = cargarApp();
  const r = await app.recordAttempt(payloadMinimo());
  assert.equal(r.ok, false);
  assert.equal(r.encolado, true);
  assert.equal(app.queueRead().length, 1);
});

test('4.3 dado un intento sin finalizar cuando intento registrarlo entonces no entra en el historial', () => {
  const app = cargarApp();
  const intento = intentoFinalizado(app);
  intento.finished = false;
  app.recordAttemptStats(intento);
  assert.equal(app.loadHistory().intentos.length, 0);
});

test('4.4 dado un intento ya registrado cuando lo registro otra vez entonces el historial no cambia', () => {
  const app = cargarApp();
  const intento = intentoFinalizado(app);
  app.recordAttemptStats(intento);
  const primero = app.almacen.getItem(HISTORY_KEY);
  app.recordAttemptStats(intento);
  assert.equal(app.loadHistory().intentos.length, 1);
  assert.equal(app.almacen.getItem(HISTORY_KEY), primero);
});

test('4.5 dado un historial que no cabe cuando registro un intento entonces poda los antiguos y reintenta', () => {
  const base = cargarApp();
  const previo = historialSerializado(base, 10);
  let fallos = 0;
  const app = cargarApp({
    almacen: almacenFalso({
      inicial: { [HISTORY_KEY]: previo },
      fallaEscritura: (clave) => clave === HISTORY_KEY && ++fallos === 1
    })
  });
  const nuevo = intentoFinalizado(app, { identificador: cid() });
  assert.equal(app.recordAttemptStats(nuevo), true);

  const guardado = app.loadHistory().intentos;
  assert.ok(guardado.length < 11, `esperaba un historial podado y quedaron ${guardado.length}`);
  assert.ok(guardado.some((i) => i.cid === nuevo.cid), 'el intento nuevo debe sobrevivir a la poda');
});

test('4.6 dado un intento guardado sin cid cuando lo reanudo entonces recibe uno nuevo', () => {
  const base = cargarApp();
  const viejo = intentoFinalizado(base);
  delete viejo.cid;
  viejo.finished = false;
  const app = cargarApp({ almacen: almacenFalso({ inicial: { [STORE_KEY]: JSON.stringify(viejo) } }) });

  const recuperado = app.loadStored();
  assert.ok(recuperado, 'el intento guardado debe poder reanudarse');
  assert.match(recuperado.cid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test('4.7 dado un borrado de estadísticas cuando reviso las demás claves entonces siguen intactas', () => {
  const base = cargarApp();
  const app = cargarApp({
    almacen: almacenFalso({
      inicial: {
        [HISTORY_KEY]: historialSerializado(base, 2),
        [STORE_KEY]: '{"intento":"en curso"}',
        [LANG_KEY]: 'es',
        [NAME_KEY]: 'Jorge Rodríguez',
        [QUEUE_KEY]: '[{"pendiente":true}]'
      }
    })
  });
  app.clearProgress();
  assert.equal(app.almacen.getItem(HISTORY_KEY), null);
  assert.equal(app.almacen.getItem(STORE_KEY), '{"intento":"en curso"}');
  assert.equal(app.almacen.getItem(LANG_KEY), 'es');
  assert.equal(app.almacen.getItem(NAME_KEY), 'Jorge Rodríguez');
  assert.equal(app.almacen.getItem(QUEUE_KEY), '[{"pendiente":true}]');
});

test('4.8 dado que el registro del historial falla cuando termino el intento entonces el envío se ejecuta igual', async () => {
  const app = cargarApp({ almacen: almacenFalso({ fallaEscritura: true }) });
  const intento = intentoFinalizado(app);

  assert.doesNotThrow(() => app.onAttemptFinished(intento),
    'ningún fallo de una etapa puede propagarse fuera de la orquestación');
  await new Promise((r) => setImmediate(r));

  assert.equal(app.llamadasFetch.length, 1,
    'el envío debe intentarse aunque el histórico y el render hayan fallado');
});

test('4.9 dado un archivo válido cuando lo importo entonces fusiona sin duplicar y guarda', () => {
  const base = cargarApp();
  const archivo = historialSerializado(base, 3);
  const app = cargarApp();

  const primera = app.importProgress(archivo);
  assert.equal(primera.ok, true);
  assert.equal(primera.importados, 3);
  assert.equal(primera.ignorados, 0);

  const segunda = app.importProgress(archivo);
  assert.equal(segunda.importados, 0);
  assert.equal(segunda.ignorados, 3);
  assert.equal(app.loadHistory().intentos.length, 3);
});

test('4.10 dado un archivo ilegible cuando lo importo entonces el historial existente no se toca', () => {
  const base = cargarApp();
  const app = cargarApp({ almacen: almacenFalso({ inicial: { [HISTORY_KEY]: historialSerializado(base, 2) } }) });
  const antes = app.almacen.getItem(HISTORY_KEY);

  const r = app.importProgress('{ esto no es json valido');
  assert.equal(r.ok, false);
  assert.ok(r.error);
  assert.equal(app.almacen.getItem(HISTORY_KEY), antes);
});
