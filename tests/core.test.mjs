/**
 * Pruebas del núcleo puro del examen de práctica.
 * Plan: docs/specs/estadisticas-preparacion-por-tema.tdd-plan.md
 *
 * El núcleo se extrae del HTML porque la aplicación es un archivo único que
 * debe seguir funcionando como file://. Ver el documento de arquitectura.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { generarModuloNucleo, violacionesDePureza } from '../tools/extract-core.mjs';

generarModuloNucleo();
const core = await import('./.core.generated.mjs');
const {
  Q, PASS_PCT, SIM_PLAN, FACTOR_OLVIDO, TOPICS,
  qIndex, byId, isCorrect, isAnswered, summarizeAttempt, scaled,
  normalizeUserKey, buildAttemptPayload, buildHistoryEntry,
  topicMastery, computeStats, topicTrend,
  validateHistory, mergeHistory, MAX_HISTORIAL
} = core;

/* ---------- constructores de escenarios ---------- */

let contador = 0;
/** UUID determinista, para que las pruebas no dependan del azar. */
const cid = () => `00000000-0000-4000-8000-${String(++contador).padStart(12, '0')}`;

const idsDeTema = (tema) => Q.filter((q) => q.topic === tema).map((q) => q.id);

/**
 * Resultados de un tema: las primeras `ok` preguntas acertadas y el resto falladas.
 * @param {number} tema  101..105
 * @param {number} ok    aciertos
 * @param {number} n     preguntas del tema en el intento
 * @param {string} [fallo] marca para las no acertadas: 'x' fallo, '-' en blanco
 */
function resTema(tema, ok, n, fallo = 'x') {
  const ids = idsDeTema(tema).slice(0, n);
  const res = {};
  ids.forEach((id, i) => { res[id] = i < ok ? 'o' : fallo; });
  return res;
}

/** Une varios bloques de resultados en un solo intento. */
function entrada(...bloques) {
  const res = Object.assign({}, ...bloques);
  const valores = Object.values(res);
  const total = valores.length;
  const ok = valores.filter((v) => v === 'o').length;
  const na = valores.filter((v) => v === '-').length;
  return {
    cid: cid(), ts: 1_700_000_000_000 + (contador * 60_000), modo: 'full',
    total, ok, ko: total - ok - na, na,
    pct: total ? Math.round((ok / total) * 10_000) / 100 : 0,
    duracion_s: 600, res
  };
}

/** Historial en orden cronológico ascendente, como lo guarda la aplicación. */
const historialCon = (...intentos) => ({ v: 1, intentos });

/* ================= Iteración 1 — la fórmula de dominio ================= */

test('1.1 dado un tema sin muestras cuando calculo su dominio entonces devuelve el prior', () => {
  assert.equal(topicMastery([]), 0.5);
});

test('1.2 dados dos aciertos de dos preguntas cuando calculo el dominio entonces no llega al cien por cien', () => {
  const d = topicMastery([{ peso: 1, ok: 2, n: 2 }]);
  assert.ok(d < 1, `esperaba < 1 y salió ${d}`);
  assert.ok(Math.abs(d - 0.643) < 0.001, `esperaba ≈0.643 y salió ${d}`);
});

test('1.3 dado un tema con muestra grande cuando calculo el dominio entonces converge a la proporción real', () => {
  const d = topicMastery([{ peso: 1, ok: 180, n: 200 }]);
  assert.ok(Math.abs(d - 0.89) < 0.01, `esperaba ≈0.89 y salió ${d}`);
});

test('1.4 dados los mismos aciertos totales cuando los recientes son mejores entonces el dominio es mayor', () => {
  const recienteBueno = topicMastery([{ peso: 1, ok: 10, n: 10 }, { peso: FACTOR_OLVIDO, ok: 0, n: 10 }]);
  const recienteMalo  = topicMastery([{ peso: 1, ok: 0, n: 10 }, { peso: FACTOR_OLVIDO, ok: 10, n: 10 }]);
  assert.ok(recienteBueno > recienteMalo,
    `la recencia no influye: ${recienteBueno} vs ${recienteMalo}`);
});

test('1.5 dado el factor de olvido cuando pasan cuatro intentos entonces el peso cae a la mitad', () => {
  assert.ok(Math.abs(FACTOR_OLVIDO ** 4 - 0.5) < 0.03, `vida media inesperada: ${FACTOR_OLVIDO ** 4}`);
});

test('1.6 dado un id de pregunta como cadena cuando lo busco en el índice entonces encuentra la pregunta', () => {
  const alguna = Q[0];
  assert.equal(byId(String(alguna.id)), alguna);
  assert.equal(byId(alguna.id), alguna);
  assert.equal(qIndex.size, Q.length);
});

test('1.7 dado un intento resuelto cuando lo resumo entonces los conteos suman el total', () => {
  const items = Q.slice(0, 12).map((q, i) => ({
    id: q.id,
    oidx: q.type === 'fill' ? [] : q.o.map((_, k) => k),
    ans: i % 3 === 0 ? (q.type === 'fill' ? q.accept[0] : (q.type === 'multi' ? q.a.slice() : q.a[0]))
                     : (i % 3 === 1 ? (q.type === 'multi' ? [] : null) : (q.type === 'fill' ? 'mal' : 0)),
    marked: false
  }));
  const s = summarizeAttempt({ items });
  assert.equal(s.ok + s.ko + s.blank, s.total);
  assert.equal(s.total, 12);
});

/* ================= Iteración 2 — computeStats ================= */

test('2.1 dado un historial vacío cuando calculo las estadísticas entonces devuelve la proyección neutra sin lanzar', () => {
  const p = computeStats(historialCon());
  assert.equal(p.resumen.intentos, 0);
  assert.deepEqual(p.orden, []);
  assert.equal(p.rebeldes.length, 0);
  for (const t of Object.keys(SIM_PLAN)) assert.equal(p.porTema[t].estado, 'sin_datos');
});

test('2.2 dado un tema flojo de poco peso y otro menos flojo de mucho peso cuando ordeno por impacto entonces gana el de mucho peso', () => {
  const p = computeStats(historialCon(entrada(resTema(101, 10, 18), resTema(103, 21, 38))));
  assert.ok(p.porTema['103'].dominio > p.porTema['101'].dominio,
    'el escenario exige que 103 tenga MEJOR dominio que 101');
  assert.equal(p.orden[0], '103',
    `el orden debe ser por impacto, no por dominio: salió ${JSON.stringify(p.orden)}`);
});

test('2.3 dado un tema sin preguntas vistas cuando calculo las estadísticas entonces no entra en el ranking de impacto', () => {
  const p = computeStats(historialCon(entrada(resTema(101, 5, 10))));
  assert.equal(p.porTema['104'].estado, 'sin_datos');
  assert.ok(!p.orden.includes('104'));
  assert.equal(p.porTema['104'].dominio, 0.5);
});

test('2.4 dado el mismo dominio en todos los temas cuando estimo la nota entonces coincide con ese dominio', () => {
  const p = computeStats(historialCon(entrada(
    resTema(101, 6, 10), resTema(102, 6, 10), resTema(103, 6, 10),
    resTema(104, 6, 10), resTema(105, 6, 10)
  )));
  const esperado = 100 * (8.5 / 15);
  assert.ok(Math.abs(p.resumen.notaEstimada - esperado) < 0.01,
    `esperaba ≈${esperado.toFixed(2)} y salió ${p.resumen.notaEstimada}`);
  const sumaPesos = Object.values(p.porTema).reduce((a, t) => a + t.peso, 0);
  assert.ok(Math.abs(sumaPesos - 1) < 1e-9, `los pesos deben sumar 1 y suman ${sumaPesos}`);
});

test('2.5 dado el mismo historial cuando calculo dos veces entonces las proyecciones son idénticas', () => {
  const h = historialCon(entrada(resTema(102, 4, 9)), entrada(resTema(104, 7, 12)));
  assert.equal(JSON.stringify(computeStats(h)), JSON.stringify(computeStats(h)));
});

test('2.6 dada una pregunta acertada al estrenarla y fallada después cuando calculo primera vez entonces cuenta como acierto', () => {
  const p = computeStats(historialCon(
    entrada(resTema(105, 1, 1)),
    entrada(resTema(105, 0, 1)),
    entrada(resTema(105, 0, 1))
  ));
  assert.equal(p.porTema['105'].primeraVez, 1);
  assert.ok(p.porTema['105'].dominio < 0.5, 'el dominio debe reflejar los fallos posteriores');
});

test('2.7 dado un dominio muy por encima del acierto en primera vez cuando calculo el resumen entonces marca memorización', () => {
  const p = computeStats(historialCon(
    entrada(resTema(103, 0, 10)),
    entrada(resTema(103, 10, 10)),
    entrada(resTema(103, 10, 10)),
    entrada(resTema(103, 10, 10))
  ));
  assert.equal(p.porTema['103'].primeraVez, 0);
  assert.equal(p.resumen.memorizando, true);
});

test('2.8 dada una pregunta vista tres veces y nunca acertada cuando busco las rebeldes entonces aparece en la lista', () => {
  const p = computeStats(historialCon(
    entrada(resTema(102, 1, 2)), entrada(resTema(102, 1, 2)), entrada(resTema(102, 1, 2))
  ));
  const ids = p.rebeldes.map((r) => r.id);
  const [acertada, fallada] = idsDeTema(102);
  assert.ok(ids.includes(fallada), 'la fallada siempre debe aparecer');
  assert.ok(!ids.includes(acertada), 'la acertada no es rebelde');
});

test('2.9 dado un historial con preguntas que ya no existen en el banco cuando calculo entonces las ignora sin lanzar', () => {
  const e = entrada(resTema(101, 3, 5));
  e.res['9999'] = 'o';
  const h = historialCon(e);
  const p = computeStats(h);
  assert.equal(p.porTema['101'].nCrudo, 5, 'la pregunta inexistente no debe sumar');
  assert.equal(h.intentos[0].res['9999'], 'o', 'el historial no se modifica');
});

test('2.10 dados tres intentos recientes mejores que los tres anteriores cuando calculo la tendencia entonces devuelve sube', () => {
  const h = historialCon(
    entrada(resTema(104, 1, 10)), entrada(resTema(104, 1, 10)), entrada(resTema(104, 2, 10)),
    entrada(resTema(104, 9, 10)), entrada(resTema(104, 9, 10)), entrada(resTema(104, 10, 10))
  );
  assert.equal(topicTrend(h, 104), 'sube');
});

test('2.11 dado un historial con menos de cuatro intentos cuando calculo la tendencia entonces devuelve sin datos', () => {
  const h = historialCon(entrada(resTema(104, 5, 10)), entrada(resTema(104, 6, 10)));
  assert.equal(topicTrend(h, 104), 'sin_datos');
});

test('2.12 dado un historial ponderado cuando leo el conteo crudo entonces no está ponderado', () => {
  const p = computeStats(historialCon(
    entrada(resTema(101, 2, 10)),
    entrada(resTema(101, 9, 10))
  ));
  const t = p.porTema['101'];
  assert.equal(t.nCrudo, 20);
  assert.equal(t.okCrudo, 11);
  assert.ok(Number.isInteger(t.nCrudo) && Number.isInteger(t.okCrudo));
  assert.notEqual(t.dominio, t.okCrudo / t.nCrudo);
});

test('2.13 dado un intento con preguntas de los tres tipos cuando agrego por tipo entonces separa single multi y fill', () => {
  const uno = (tipo) => Q.find((q) => q.type === tipo);
  const res = {};
  res[uno('single').id] = 'o';
  res[uno('multi').id] = 'x';
  res[uno('fill').id] = 'x';
  const p = computeStats(historialCon(entrada(res)));
  assert.equal(p.porTipo.single, 1);
  assert.equal(p.porTipo.multi, 0);
  assert.equal(p.porTipo.fill, 0);
});

/* ================= Iteración 3 — historial ================= */

test('3.1 dado un json sin campo de versión cuando lo valido entonces lo rechaza entero', () => {
  const r = validateHistory(JSON.stringify({ intentos: [] }));
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

test('3.2 dado un archivo con una entrada corrupta cuando lo valido entonces descarta solo esa entrada', () => {
  const buena = entrada(resTema(101, 3, 5));
  const mala = { ...entrada(resTema(101, 3, 5)), cid: 'no-es-uuid' };
  const r = validateHistory(JSON.stringify({ v: 1, intentos: [buena, mala] }));
  assert.equal(r.ok, true);
  assert.equal(r.intentos.length, 1);
  assert.equal(r.invalidos, 1);
});

test('3.3 dado un archivo con intentos que ya existen cuando lo fusiono entonces no los duplica', () => {
  const a = entrada(resTema(101, 3, 5));
  const b = entrada(resTema(102, 4, 6));
  const r = mergeHistory([a, b], [a]);
  assert.equal(r.intentos.length, 2);
  assert.equal(r.duplicados, 1);
  assert.equal(new Set(r.intentos.map((i) => i.cid)).size, 2);
});

test('3.4 dado el mismo archivo importado dos veces cuando comparo el historial entonces es idéntico', () => {
  const previos = [entrada(resTema(101, 3, 5))];
  const archivo = [entrada(resTema(103, 5, 9)), entrada(resTema(104, 2, 7))];
  const una = mergeHistory(previos, archivo).intentos;
  const dos = mergeHistory(una, archivo).intentos;
  assert.equal(JSON.stringify(una), JSON.stringify(dos));
});

test('3.5 dado un archivo con sesenta intentos cuando lo fusiono entonces conserva los cincuenta más recientes', () => {
  const muchos = Array.from({ length: 60 }, () => entrada(resTema(101, 1, 2)));
  const r = mergeHistory([], muchos);
  assert.equal(r.intentos.length, MAX_HISTORIAL);
  const tsMinimoConservado = Math.min(...r.intentos.map((i) => i.ts));
  const descartados = muchos.filter((i) => i.ts < tsMinimoConservado);
  assert.equal(descartados.length, 60 - MAX_HISTORIAL);
});

test('3.6 dado un archivo con intentos desordenados cuando lo fusiono entonces quedan en orden cronológico', () => {
  const a = entrada(resTema(101, 1, 2));
  const b = entrada(resTema(101, 1, 2));
  const r = mergeHistory([], [b, a]);
  assert.deepEqual(r.intentos.map((i) => i.ts), [a.ts, b.ts].sort((x, y) => x - y));
});

/* ================= Iteración 5 — guardia arquitectónica ================= */

test('5.1 dado el núcleo puro del html cuando lo extraigo entonces no contiene document localStorage datenow ni fetch', () => {
  const { fuente } = generarModuloNucleo({ escribir: false });
  assert.ok(fuente.length > 0);
  assert.deepEqual(violacionesDePureza('function f(){ return localStorage.getItem("x"); }'), ['localStorage'],
    'la guardia debe detectar una violación real');
});

test('5.2 dado un intento con resultados por pregunta cuando construyo el payload remoto entonces no incluye ninguna clave de pregunta', () => {
  const items = Q.slice(0, 40).map((q) => ({
    id: q.id, oidx: q.type === 'fill' ? [] : q.o.map((_, k) => k),
    ans: q.type === 'fill' ? q.accept[0] : (q.type === 'multi' ? q.a.slice() : q.a[0]), marked: false
  }));
  const attempt = { mode: 'sim', cid: cid(), finished: true, limitMs: 3_600_000, elapsedMs: 3_600_000, items };
  const payload = buildAttemptPayload(attempt, 'Jorge Rodríguez', 'both');

  assert.deepEqual(Object.keys(payload).sort(), [
    'app_version', 'client_attempt_id', 'correctas', 'desglose_temas', 'duracion_segundos',
    'idioma', 'incorrectas', 'limite_minutos', 'modo', 'porcentaje', 'puntuacion_escala',
    'sin_responder', 'total_preguntas', 'usuario_nombre'
  ]);
  // El único objeto anidado admisible es el desglose por tema. Si alguien colara
  // el mapa por pregunta, aparecerían claves que no son temas oficiales.
  const temas = Object.keys(payload.desglose_temas);
  assert.ok(temas.length > 0);
  for (const t of temas) assert.ok(t in TOPICS, `"${t}" no es un tema oficial`);

  // Los ids de pregunta que no coinciden con un número de tema no pueden aparecer.
  // (los temas van del 101 al 105 y las primeras preguntas comparten esos números)
  const serializado = JSON.stringify(payload);
  const idsDistinguibles = items.map((q) => q.id).filter((id) => !(String(id) in TOPICS));
  assert.ok(idsDistinguibles.length > 20, 'el escenario necesita ids que no se confundan con temas');
  for (const id of idsDistinguibles) {
    assert.ok(!serializado.includes(`"${id}"`), `el id de pregunta ${id} no puede viajar en el payload`);
  }
});

test('5.2b dado un intento finalizado cuando construyo la entrada del historial entonces el tiempo entra por parámetro', () => {
  const items = Q.slice(0, 5).map((q) => ({
    id: q.id, oidx: q.type === 'fill' ? [] : q.o.map((_, k) => k), ans: null, marked: false
  }));
  const e = buildHistoryEntry({ mode: 'full', cid: cid(), finished: true, limitMs: 0, elapsedMs: 12_345, items }, 999);
  assert.equal(e.ts, 999);
  assert.equal(e.na, 5);
  assert.equal(e.duracion_s, 12);
});
