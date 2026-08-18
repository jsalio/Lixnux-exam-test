/**
 * Pruebas de la pantalla de estadísticas.
 * Plan: docs/specs/estadisticas-preparacion-por-tema.tdd-plan-ui.md
 *
 * Las funciones de render devuelven HTML como cadena en vez de escribir en el
 * DOM, así que se prueban con aserciones sobre texto. El controlador se prueba
 * observando lo que escribe y disparando los clics del usuario.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cargarApp, almacenFalso } from './browser-stub.mjs';

const HISTORY_KEY = 'lpi-010-160-historial';
let contador = 0;
const cid = () => `00000000-0000-4000-8000-${String(++contador).padStart(12, '0')}`;

/** Proyección mínima con los cinco temas, ajustable tema a tema. */
function proyeccion(ajustes = {}, resumen = {}) {
  const porTema = {};
  for (const t of ['101', '102', '103', '104', '105']) {
    porTema[t] = {
      dominio: 0.5, nCrudo: 0, okCrudo: 0, fallos: 0, blancos: 0,
      peso: 0.2, brecha: 0, impacto: 0, primeraVez: 0, nPrimeraVez: 0,
      tendencia: 'sin_datos', estado: 'sin_datos', ...(ajustes[t] || {})
    };
  }
  const orden = Object.keys(ajustes).filter((t) => porTema[t].nCrudo > 0);
  return {
    porTema, orden,
    porTipo: { single: null, multi: null, fill: null },
    rebeldes: [],
    resumen: {
      intentos: orden.length ? 5 : 0, preguntasVistas: 0, notaEstimada: 0,
      escala: 200, veredicto: 'no_aprobado', memorizando: false, ...resumen
    }
  };
}

function intentoFinalizado(app, n = 8) {
  const items = app.Q.slice(0, n).map((q, i) => ({
    id: q.id, oidx: q.type === 'fill' ? [] : q.o.map((_, k) => k),
    ans: i % 2 === 0
      ? (q.type === 'fill' ? q.accept[0] : (q.type === 'multi' ? q.a.slice() : q.a[0]))
      : (q.type === 'multi' ? [] : null),
    marked: false
  }));
  return { mode: 'full', cid: cid(), finished: true, limitMs: 0, elapsedMs: 60_000, idx: 0, items };
}

function historialSerializado(app, cuantos) {
  const intentos = [];
  for (let i = 0; i < cuantos; i++) {
    intentos.push(app.buildHistoryEntry(intentoFinalizado(app), 1_700_000_000_000 + i * 60_000));
  }
  return JSON.stringify({ v: 1, intentos });
}

/* ================= statsTableHtml — Dumb ================= */

test('U1.1 dado un tema sin datos cuando pinto la tabla entonces lo marca en vez de mostrar un porcentaje', () => {
  const app = cargarApp();
  const html = app.statsTableHtml(proyeccion());
  assert.match(html, /sin datos/i);
  assert.doesNotMatch(html, /50\s*%/, 'el prior no se muestra como si fuera un resultado');
});

test('U1.2 dada una proyección cuando pinto la tabla entonces las filas salen en el orden recibido', () => {
  const app = cargarApp();
  const p = proyeccion({
    '101': { nCrudo: 18, okCrudo: 10, dominio: 0.5435, estado: 'estudiar', impacto: 0.018 },
    '103': { nCrudo: 38, okCrudo: 21, dominio: 0.5465, estado: 'estudiar', impacto: 0.026 }
  });
  p.orden = ['103', '101'];
  const html = app.statsTableHtml(p);
  assert.ok(html.indexOf('103') < html.indexOf('101'),
    'el render no puede reordenar: pinta en el orden que recibe');
});

test('U1.3 dado un tema con datos cuando pinto la tabla entonces el porcentaje va con su número de preguntas', () => {
  const app = cargarApp();
  const html = app.statsTableHtml(proyeccion({
    '104': { nCrudo: 37, okCrudo: 20, dominio: 0.62, estado: 'estudiar' }
  }));
  assert.match(html, /62\s*%/);
  assert.match(html, /37/, 'el tamaño de muestra nunca puede faltar junto al porcentaje');
});

test('U1.4 dado un tema por encima del umbral de dominado cuando pinto la tabla entonces la acción es repasar', () => {
  const app = cargarApp();
  const html = app.statsTableHtml(proyeccion({
    '102': { nCrudo: 30, okCrudo: 27, dominio: 0.88, estado: 'repasar' },
    '105': { nCrudo: 30, okCrudo: 12, dominio: 0.42, estado: 'estudiar' }
  }));
  assert.match(html, /repasar/i);
  assert.match(html, /estudiar/i);
});

/* ================= statsSummaryHtml — Dumb ================= */

test('U2.1 dado un historial vacío cuando pinto el resumen entonces invita a empezar y no muestra nota', () => {
  const app = cargarApp();
  const html = app.statsSummaryHtml(proyeccion());
  assert.match(html, /todav[ií]a|a[úu]n no|empieza|primer intento/i);
  assert.doesNotMatch(html, /nota estimada/i);
});

test('U2.2 dados menos de tres intentos cuando pinto el resumen entonces avisa de que la muestra es corta', () => {
  const app = cargarApp();
  const html = app.statsSummaryHtml(proyeccion(
    { '101': { nCrudo: 10, okCrudo: 6, dominio: 0.56, estado: 'estudiar' } },
    { intentos: 2, notaEstimada: 56.7, escala: 460 }
  ));
  assert.match(html, /pocos intentos|muestra .*corta|todav[ií]a no es fiable/i);
});

test('U2.3 dado que la proyección detecta memorización cuando pinto el resumen entonces lo advierte', () => {
  const app = cargarApp();
  const html = app.statsSummaryHtml(proyeccion(
    { '103': { nCrudo: 40, okCrudo: 36, dominio: 0.88, estado: 'repasar', primeraVez: 0.4 } },
    { intentos: 6, notaEstimada: 82, escala: 660, memorizando: true }
  ));
  assert.match(html, /memoriz/i);
});

test('U2.4 dada una nota estimada cuando pinto el resumen entonces muestra su equivalencia en la escala oficial', () => {
  const app = cargarApp();
  const html = app.statsSummaryHtml(proyeccion(
    { '101': { nCrudo: 20, okCrudo: 15, dominio: 0.71, estado: 'reforzar' } },
    { intentos: 5, notaEstimada: 71.4, escala: 556 }
  ));
  assert.match(html, /71[.,]4/);
  assert.match(html, /556/);
});

/* ================= leechListHtml — Dumb ================= */

test('U3.1 dado que no hay preguntas rebeldes cuando pinto la lista entonces no aparece la sección', () => {
  const app = cargarApp();
  assert.equal(app.leechListHtml([]).trim(), '');
});

test('U3.2 dadas preguntas rebeldes cuando pinto la lista entonces cada una indica su tema y sus apariciones', () => {
  const app = cargarApp();
  const html = app.leechListHtml([{ id: app.Q[0].id, topic: app.Q[0].topic, vistas: 4, aciertos: 0 }]);
  assert.match(html, new RegExp(String(app.Q[0].topic)));
  assert.match(html, /4/);
});

/* ================= renderStats — Smart ================= */

test('U4.1 dado un historial con intentos cuando abro la pantalla entonces pinta los cinco temas', () => {
  const base = cargarApp();
  const app = cargarApp({ almacen: almacenFalso({ inicial: { [HISTORY_KEY]: historialSerializado(base, 4) } }) });
  app.renderStats();
  const tabla = app.escrito['#statsRows'] || '';
  for (const t of ['101', '102', '103', '104', '105']) assert.match(tabla, new RegExp(t));
  assert.match(app.escrito['#statsSummary'] || '', /4/);
});

test('U4.2 dado un historial vacío cuando abro la pantalla entonces muestra el estado sin datos', () => {
  const app = cargarApp();
  app.renderStats();
  assert.match(app.escrito['#statsSummary'] || '', /todav[ií]a|a[úu]n no|empieza|primer intento/i);
});

test('U4.3 dado un historial ilegible cuando abro la pantalla entonces degrada a sin datos sin lanzar', () => {
  const app = cargarApp({ almacen: almacenFalso({ inicial: { [HISTORY_KEY]: '{{{ roto' } }) });
  assert.doesNotThrow(() => app.renderStats());
  assert.match(app.escrito['#statsSummary'] || '', /todav[ií]a|a[úu]n no|empieza|primer intento/i);
});

/* ================= Controles de datos — Smart ================= */

test('U5.1 cuando el usuario pide borrar entonces primero pide confirmación y no borra nada', () => {
  const base = cargarApp();
  const app = cargarApp({
    almacen: almacenFalso({ inicial: { [HISTORY_KEY]: historialSerializado(base, 2) } }),
    confirmar: false
  });
  app.disparar('#btnClearStats');
  assert.notEqual(app.almacen.getItem(HISTORY_KEY), null,
    'sin confirmación explícita el historial no se toca');
});

test('U5.2 cuando el usuario confirma el borrado entonces el historial desaparece', () => {
  const base = cargarApp();
  const app = cargarApp({
    almacen: almacenFalso({ inicial: { [HISTORY_KEY]: historialSerializado(base, 2) } }),
    confirmar: true
  });
  app.disparar('#btnClearStats');
  assert.equal(app.almacen.getItem(HISTORY_KEY), null);
  assert.match(app.escrito['#statsSummary'] || '', /todav[ií]a|a[úu]n no|empieza|primer intento/i);
});

test('U5.3 cuando importo un archivo válido entonces informa de cuántos entraron y repinta', () => {
  const base = cargarApp();
  const app = cargarApp();
  const r = app.importProgress(historialSerializado(base, 3));
  assert.equal(r.ok, true);
  app.renderStats();
  assert.match(app.escrito['#statsSummary'] || '', /3/);
});

test('U5.4 cuando importo un archivo ilegible entonces muestra el error y conserva el historial', () => {
  const base = cargarApp();
  const app = cargarApp({ almacen: almacenFalso({ inicial: { [HISTORY_KEY]: historialSerializado(base, 2) } }) });
  const antes = app.almacen.getItem(HISTORY_KEY);
  const r = app.importProgress('no soy json');
  assert.equal(r.ok, false);
  assert.equal(app.almacen.getItem(HISTORY_KEY), antes);
});

/* ================= Integración ================= */

test('U6.1 dado un intento recién terminado cuando abro las estadísticas entonces aparece contado', () => {
  const app = cargarApp();
  app.renderStats();
  assert.match(app.escrito['#statsSummary'] || '', /todav[ií]a|a[úu]n no|empieza|primer intento/i);

  app.onAttemptFinished(intentoFinalizado(app));
  app.renderStats();

  const resumen = app.escrito['#statsSummary'] || '';
  assert.match(resumen, /nota estimada/i, 'con un intento ya hay algo que estimar');
  assert.equal(app.loadHistory().intentos.length, 1);
});
