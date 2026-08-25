/**
 * Pruebas del núcleo del simulador de terminal.
 *
 * Reparto de trabajo con `fidelidad.mjs`: allí se comprueba que la salida sea
 * igual a la de coreutils; aquí, lo que ese banco no puede ver —el modelo de
 * permisos con otros usuarios, la umask, el determinismo, y el contrato de que
 * lo no implementado se declara—.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { violacionesDePureza } from '../tools/extract-core.mjs';
import {
  estadoInicial, ejecutar, clonar, buscar, puede, modoTexto, calcularModo,
  breARegex, expandirLlaves, fechaLs, IMPLEMENTADOS
} from './terminal-core.mjs';

const AHORA = 1755000000; // 2025-08-12T12:00:00Z, fijo: el núcleo no mira el reloj.
const nuevo = (opts) => estadoInicial({ ahora: AHORA, ...opts });

/** Ejecuta una línea sobre un estado limpio y devuelve salida + error + código. */
function corre(linea, opts) {
  const estado = nuevo(opts);
  return { ...ejecutar(estado, linea), estado };
}

/* ---------- la regla que hace que el núcleo sirva en este proyecto ---------- */

test('P1 el núcleo no toca el navegador ni el reloj ni el azar', () => {
  const fuente = readFileSync(new URL('./terminal-core.mjs', import.meta.url), 'utf8');
  assert.deepEqual(violacionesDePureza(fuente), []);
});

test('P2 la misma entrada da la misma salida: no hay estado escondido', () => {
  const linea = 'ls -l ; touch x ; ls -l x ; echo $?';
  assert.equal(JSON.stringify(corre(linea)), JSON.stringify(corre(linea)));
});

test('P3 ninguna línea, ni absurda, hace estallar el núcleo', () => {
  const basura = [
    '', '   ', '|', '||', '&&', ';;', '>', '<', '2>', 'ls |', '| ls', 'ls >',
    'echo "sin cerrar', "echo 'sin cerrar", 'ls `', 'echo $(', 'cd ../../../../../..',
    'ls ]', '[', '[ ]', 'ls -', 'ls --', '$', '${', '$?', 'rm -rf /', 'ln -s a a && cat a'
  ];
  for (const linea of basura) {
    const estado = nuevo();
    assert.doesNotThrow(() => ejecutar(estado, linea), `estalló con: ${linea}`);
  }
});

/* ---------- mundo cerrado: lo que no sabe, lo dice ---------- */

test('C1 una opción no implementada se declara en vez de inventarse la salida', () => {
  const r = corre('ls -lt');
  assert.match(r.error, /^simulador: /);
  assert.equal(r.salida, '');
  assert.equal(r.codigo, 2);
});

test('C2 un comando desconocido responde como bash, con 127', () => {
  const r = corre('inventado');
  assert.equal(r.error, 'bash: inventado: command not found\n');
  assert.equal(r.codigo, 127);
});

test('C3 una estructura de control se declara: no se ejecuta `for` como programa', () => {
  const r = corre('for f in *.txt ; do echo $f ; done');
  assert.match(r.error, /^simulador: bash: la estructura de control `for`/);
});

test('C4 el prototipo cubre los comandos del temario que dice cubrir', () => {
  const delTemario = ['cat', 'cd', 'chmod', 'cp', 'cut', 'echo', 'find', 'grep', 'head',
    'id', 'ln', 'ls', 'mkdir', 'mv', 'pwd', 'rm', 'rmdir', 'sort', 'tail', 'test',
    'touch', 'tr', 'type', 'umask', 'uniq', 'wc', 'whoami'];
  const faltan = delTemario.filter((c) => !IMPLEMENTADOS.includes(c));
  assert.deepEqual(faltan, [], `sin implementar: ${faltan.join(', ')}`);
});

/* ---------- permisos: lo que el banco de fidelidad no puede probar ---------- */

test('R1 el kernel elige un solo bloque de permisos y no los acumula', () => {
  const estado = nuevo();
  const nodo = { tipo: 'f', modo: 0o604, usuario: 'jorge', grupo: 'jorge', mtime: 0, contenido: '' };
  // El dueño tiene rw- y "otros" tienen r--; el grupo, en medio, no tiene nada.
  assert.equal(puede({ ...estado, usuario: 'jorge', grupos: ['jorge'] }, nodo, 'w'), true);
  assert.equal(puede({ ...estado, usuario: 'ana', grupos: ['jorge'] }, nodo, 'r'), false,
    'ser del grupo no da los permisos de "otros" aunque sean mayores');
  assert.equal(puede({ ...estado, usuario: 'ana', grupos: ['ana'] }, nodo, 'r'), true);
});

test('R2 root se salta lectura y escritura, pero no ejecuta lo que no es ejecutable', () => {
  const estado = { ...nuevo(), usuario: 'root', grupos: ['root'] };
  const sinPermisos = { tipo: 'f', modo: 0o000, usuario: 'jorge', grupo: 'jorge', mtime: 0, contenido: 'x' };
  assert.equal(puede(estado, sinPermisos, 'r'), true);
  assert.equal(puede(estado, sinPermisos, 'w'), true);
  assert.equal(puede(estado, sinPermisos, 'x'), false);
});

test('R3 root lee un fichero que su dueño no puede leer', () => {
  assert.equal(corre('cat secreto.txt').codigo, 1);
  const comoRoot = nuevo();
  comoRoot.usuario = 'root';
  comoRoot.grupos = ['root'];
  const r = ejecutar(comoRoot, 'cat secreto.txt');
  assert.equal(r.codigo, 0);
  assert.equal(r.salida, 'no deberias poder leer esto\n');
});

test('R4 sin permiso de ejecución en el directorio no se llega a lo de dentro', () => {
  const r = corre('cat cerrado/dentro.txt');
  assert.equal(r.error, 'cat: cerrado/dentro.txt: Permission denied\n');
});

test('R5 la umask decide el modo de lo que se crea, restando permisos', () => {
  const conUmask = (valor, orden) => {
    const estado = nuevo();
    ejecutar(estado, `umask ${valor}`);
    ejecutar(estado, orden);
    return estado;
  };
  assert.equal(buscar(conUmask('022', 'mkdir d'), 'd').nodo.modo, 0o755);
  assert.equal(buscar(conUmask('077', 'mkdir d'), 'd').nodo.modo, 0o700);
  assert.equal(buscar(conUmask('022', 'touch f'), 'f').nodo.modo, 0o644,
    'un fichero nace sin x aunque la umask lo permita');
  assert.equal(buscar(conUmask('002', 'touch f'), 'f').nodo.modo, 0o664);
});

/* ---------- piezas puras ---------- */

test('M1 la columna de modo de ls -l, con los bits especiales', () => {
  const f = (modo, tipo = 'f') => modoTexto({ tipo, modo });
  assert.equal(f(0o644), '-rw-r--r--');
  assert.equal(f(0o755, 'd'), 'drwxr-xr-x');
  assert.equal(f(0o4755), '-rwsr-xr-x', 'setuid sobre una x da s minúscula');
  assert.equal(f(0o4644), '-rwSr--r--', 'setuid sin x da S mayúscula: el bit no sirve de nada');
  assert.equal(f(0o2755, 'd'), 'drwxr-sr-x');
  assert.equal(f(0o1777, 'd'), 'drwxrwxrwt', 'el sticky de /tmp');
  assert.equal(f(0o1666, 'd'), 'drw-rw-rwT', 'sticky sin x en otros: T mayúscula');
});

test('M2 chmod simbólico y octal calculan el mismo modo', () => {
  assert.equal(calcularModo(0o000, '755', true), 0o755);
  assert.equal(calcularModo(0o644, 'u+x', false), 0o744);
  assert.equal(calcularModo(0o644, 'go-r', false), 0o600);
  assert.equal(calcularModo(0o777, 'a=r', false), 0o444);
  assert.equal(calcularModo(0o644, '+x', false), 0o755, 'sin quién, el destinatario es "a"');
  assert.equal(calcularModo(0o755, 'u+s', false), 0o4755);
  assert.equal(calcularModo(0o755, 'u+x,g-w,o=', false), 0o750);
  assert.equal(calcularModo(0o644, 'X', false), null, 'especificación inválida: null, no un modo inventado');
  assert.equal(calcularModo(0o644, '+X', false), 0o644, 'X no da x a un fichero que no era ejecutable');
  assert.equal(calcularModo(0o644, '+X', true), 0o755, '…pero sí a un directorio');
});

test('M3 en BRE los operadores llevan barra invertida y sin ella son literales', () => {
  assert.equal(breARegex('o+'), 'o\\+', 'el + de BRE es una suma literal');
  assert.equal(breARegex('o\\+'), 'o+', 'con barra, es el operador');
  assert.equal(breARegex('ERROR\\|WARN'), 'ERROR|WARN');
  assert.equal(breARegex('^a.c$'), '^a.c$');
  assert.equal(breARegex('s\\{2\\}'), 's{2}');
});

test('M4 las llaves se expanden sin mirar el disco', () => {
  assert.deepEqual(expandirLlaves('{1..3}'), ['1', '2', '3']);
  assert.deepEqual(expandirLlaves('f{a,b}.txt'), ['fa.txt', 'fb.txt']);
  assert.deepEqual(expandirLlaves('{3..1}'), ['3', '2', '1']);
  assert.deepEqual(expandirLlaves('{a}'), ['{a}'], 'sin coma ni rango, no es una expansión');
  assert.deepEqual(expandirLlaves('sinllaves'), ['sinllaves']);
});

test('M5 la fecha de ls -l cambia de hora a año a los seis meses', () => {
  const dia = 86400;
  assert.equal(fechaLs(AHORA - dia, AHORA), 'Aug 11 12:00');
  assert.equal(fechaLs(AHORA - 300 * dia, AHORA), 'Oct 16  2024');
  assert.equal(fechaLs(AHORA + 10 * dia, AHORA), 'Aug 22  2025', 'el futuro también se muestra con año');
  assert.equal(fechaLs(AHORA - 1 * dia, AHORA).length, 12);
  assert.equal(fechaLs(AHORA - 300 * dia, AHORA).length, 12, 'las dos formas ocupan lo mismo');
});

/* ---------- lo que hace posible corregir ejercicios ---------- */

test('E1 el resultado de un ejercicio se comprueba en el árbol, no en lo que se teclee', () => {
  const caminos = [
    'mkdir /tmp/logs && chmod 750 /tmp/logs',
    'mkdir -m 750 /tmp/logs',
    'cd /tmp ; mkdir logs ; chmod u=rwx,g=rx,o= logs',
    'umask 027 ; mkdir /tmp/logs'
  ];
  for (const camino of caminos) {
    const estado = nuevo();
    ejecutar(estado, camino);
    const { nodo, error } = buscar(estado, '/tmp/logs');
    assert.equal(error, null, `no creó el directorio: ${camino}`);
    assert.equal(nodo.tipo, 'd', camino);
    assert.equal(nodo.modo, 0o750, `modo incorrecto por el camino: ${camino}`);
  }
});

test('E2 clonar aísla el estado: se puede deshacer un intento', () => {
  const antes = nuevo();
  const copia = clonar(antes);
  ejecutar(copia, 'rm -r proyectos');
  assert.equal(buscar(copia, 'proyectos').error, 'ENOENT');
  assert.equal(buscar(antes, 'proyectos').error, null, 'el original no se ha tocado');
});

test('E3 el código de salida es dato del ejercicio: distingue no encontrar de no poder', () => {
  assert.equal(corre('grep ERROR informe.log').codigo, 0);
  assert.equal(corre('grep nada informe.log').codigo, 1, '1 es "no hay coincidencias"');
  assert.equal(corre('grep ERROR nofichero').codigo, 2, '2 es "no pude mirar"');
  assert.equal(corre('ls nofichero').codigo, 2);
  assert.equal(corre('cat nofichero').codigo, 1);
  assert.equal(corre('inventado').codigo, 127);
});
