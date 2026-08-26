/**
 * Pruebas del núcleo del simulador de terminal.
 *
 * Reparto de trabajo con `tools/fidelidad.mjs`: allí se comprueba que la salida
 * sea igual a la de coreutils; aquí, lo que ese banco no puede ver —el modelo de
 * inodos, los permisos con otros usuarios, la umask, el determinismo, el
 * reparto en columnas y el contrato de que lo no implementado se declara—.
 *
 * El núcleo se extrae del HTML porque la página es un archivo único que debe
 * seguir funcionando como file://. Ver docs/specs/terminal-simulador-nucleo.spec.md.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { generarModuloNucleo, violacionesDePureza } from '../tools/extract-core.mjs';

const { fuente } = generarModuloNucleo({ pagina: 'terminal' });
const {
  estadoInicial, ejecutar, clonar, buscar, puede, modoTexto, calcularModo,
  breARegex, expandirLlaves, fechaLs, enColumnas, lsDePantalla, enlaces,
  inodoDe, cuantosNombres, IMPLEMENTADOS
} = await import('./.terminal.generated.mjs');

const AHORA = 1755000000; // 2025-08-12T12:00:00Z, fijo: el núcleo no mira el reloj.
const nuevo = (opts) => estadoInicial({ ahora: AHORA, ...opts });

/** Ejecuta una línea sobre un estado limpio y devuelve salida + error + código. */
function corre(linea, opts) {
  const estado = nuevo(opts);
  return { ...ejecutar(estado, linea), estado };
}

/** El inodo que hay en una ruta, o null. */
const en = (estado, ruta) => buscar(estado, ruta, { seguirFinal: false }).inodo;

/* ---------- la regla que hace que el núcleo sirva en este proyecto ---------- */

test('P1 el núcleo no toca el navegador ni el reloj ni el azar', () => {
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
    'ls ]', '[', '[ ]', 'ls -', 'ls --', '$', '${', '$?', 'rm -rf /', 'ln -s a a && cat a',
    'ln a a', 'cut -c', 'sort -k', 'grep -A', 'head -c', 'ls -1 --', 'rmdir -p /', 'mv . .'
  ];
  for (const linea of basura) {
    const estado = nuevo();
    assert.doesNotThrow(() => ejecutar(estado, linea), `estalló con: ${linea}`);
  }
});

test('P4 el árbol semilla trae los casos que rompen a un simulador', () => {
  const estado = nuevo();
  const modo = (ruta) => en(estado, ruta).modo;
  assert.equal(en(estado, 'antiguo.txt').mtime < AHORA - 15778476, true, 'uno de más de seis meses');
  assert.equal(modo('secreto.txt'), 0o000, 'uno sin permiso de lectura');
  assert.equal(en(estado, 'vacio.txt').contenido, '', 'uno vacío');
  assert.equal(Object.keys(en(estado, 'vacio').hijos).length, 0, 'un directorio vacío');
  assert.equal(modo('cerrado'), 0o000, 'un directorio ilegible');
  assert.equal(modo('instalador.sh'), 0o4755, 'bits especiales');
  assert.equal(modo('/tmp'), 0o1777, 'el sticky de /tmp');
  assert.equal(en(estado, '/dev/null').tipo, 'c');
  assert.notEqual(en(estado, '/etc/hostname'), null);
  assert.notEqual(en(estado, '.bashrc'), null, 'ficheros ocultos');
});

/* ---------- mundo cerrado: lo que no sabe, lo dice ---------- */

test('C1 una opción no implementada se declara en vez de inventarse la salida', () => {
  for (const linea of ['wc -L notas.txt', 'ls -R', 'ls -C', 'cat -v notas.txt', 'cut -b1 notas.txt']) {
    const r = corre(linea);
    assert.match(r.error, /^simulador: /, linea);
    assert.equal(r.salida, '', linea);
    assert.equal(r.codigo, 2, linea);
  }
});

test('C2 un comando desconocido responde como bash, con 127', () => {
  const r = corre('inventado');
  assert.equal(r.error, 'bash: inventado: command not found\n');
  assert.equal(r.codigo, 127);
});

test('C3 una estructura de control se declara: no se ejecuta `for` como programa', () => {
  assert.match(corre('for f in *.txt ; do echo $f ; done').error,
    /^simulador: bash: la estructura de control `for`/);
  assert.match(corre('if [ -f notas.txt ] ; then echo si ; fi').error,
    /^simulador: bash: la estructura de control `if`/);
});

test('C4 `exit` no miente diciendo que no existe: es un builtin, y se declara', () => {
  assert.match(corre('exit').error, /^simulador: bash: la orden `exit`/);
  assert.equal(corre('type exit').salida, 'exit is a shell builtin\n');
});

test('C5 el simulador cubre los comandos del temario que dice cubrir', () => {
  const delTemario = ['cat', 'cd', 'chmod', 'cp', 'cut', 'echo', 'find', 'grep', 'head',
    'id', 'ln', 'ls', 'mkdir', 'mv', 'pwd', 'rm', 'rmdir', 'sort', 'tail', 'test',
    'touch', 'tr', 'type', 'umask', 'uniq', 'wc', 'whoami'];
  const faltan = delTemario.filter((c) => !IMPLEMENTADOS.includes(c));
  assert.deepEqual(faltan, [], `sin implementar: ${faltan.join(', ')}`);
});

/* ---------- inodos: nombre y contenido son cosas distintas ---------- */

test('I1 un enlace duro es otro nombre del mismo inodo, y ls -l cuenta 2', () => {
  const estado = nuevo();
  ejecutar(estado, 'ln notas.txt duro');
  const a = en(estado, 'notas.txt');
  const b = en(estado, 'duro');
  assert.equal(a.id, b.id, 'los dos nombres apuntan al mismo inodo');
  assert.equal(enlaces(estado.fs, a), 2);
  assert.equal(cuantosNombres(estado.fs, a.id), 2);
});

test('I2 borrar un nombre no borra el contenido si queda otro', () => {
  const estado = nuevo();
  ejecutar(estado, 'ln notas.txt duro && rm notas.txt');
  assert.equal(en(estado, 'notas.txt'), null);
  assert.equal(ejecutar(estado, 'cat duro').salida, 'comprar pan\nrevisar permisos\nestudiar find\n');
  assert.equal(enlaces(estado.fs, en(estado, 'duro')), 1, 'ya solo queda un nombre');
});

test('I3 al irse el último nombre el inodo desaparece de la tabla', () => {
  const estado = nuevo();
  const antes = estado.fs.inodos.size;
  ejecutar(estado, 'touch nuevo.txt');
  assert.equal(estado.fs.inodos.size, antes + 1);
  ejecutar(estado, 'rm nuevo.txt');
  assert.equal(estado.fs.inodos.size, antes, 'no quedan inodos huérfanos');
});

test('I4 borrar un directorio libera también lo que tenía dentro', () => {
  const estado = nuevo();
  const antes = estado.fs.inodos.size;
  ejecutar(estado, 'mkdir -p a/b && touch a/b/f a/g');
  assert.equal(estado.fs.inodos.size, antes + 4);
  ejecutar(estado, 'rm -r a');
  assert.equal(estado.fs.inodos.size, antes);
});

test('I5 escribir por un nombre se ve por el otro; copiar crea un inodo nuevo', () => {
  const estado = nuevo();
  ejecutar(estado, 'ln notas.txt duro && echo cambiado > duro');
  assert.equal(ejecutar(estado, 'cat notas.txt').salida, 'cambiado\n', 'el inodo es el mismo');

  ejecutar(estado, 'cp notas.txt copia.txt && echo otra > copia.txt');
  assert.notEqual(en(estado, 'copia.txt').id, en(estado, 'notas.txt').id);
  assert.equal(ejecutar(estado, 'cat notas.txt').salida, 'cambiado\n', 'la copia es otro fichero');
});

test('I6 mover conserva el inodo: renombrar no copia nada', () => {
  const estado = nuevo();
  const idAntes = en(estado, 'notas.txt').id;
  ejecutar(estado, 'mv notas.txt renombrado.txt');
  assert.equal(en(estado, 'renombrado.txt').id, idAntes);
});

test('I7 un directorio no admite enlaces duros, y su cuenta la fijan sus hijos', () => {
  const estado = nuevo();
  assert.match(ejecutar(estado, 'ln proyectos pd').error, /hard link not allowed for directory/);
  // proyectos tiene un subdirectorio: `.`, su nombre en el padre y el `..` del hijo.
  assert.equal(enlaces(estado.fs, en(estado, 'proyectos')), 3);
  ejecutar(estado, 'mkdir proyectos/otro');
  assert.equal(enlaces(estado.fs, en(estado, 'proyectos')), 4);
});

test('I8 un enlace simbólico guarda texto, y puede apuntar a lo que no existe', () => {
  const estado = nuevo();
  ejecutar(estado, 'ln -s nada roto');
  const enlace = en(estado, 'roto');
  assert.equal(enlace.tipo, 'l');
  assert.equal(enlace.destino, 'nada');
  assert.equal(ejecutar(estado, 'cat roto').codigo, 1, 'el enlace existe; su destino no');
  assert.equal(ejecutar(estado, 'ls roto').codigo, 2, 'ls sigue el enlace y no encuentra el destino');
  assert.match(ejecutar(estado, 'ls -l roto').salida, /roto -> nada$/m, 'ls -l ve el enlace en sí');
});

test('C6 una orden escrita como ruta distingue no estar de no poder ejecutarse', () => {
  assert.equal(corre('./nada').codigo, 127, '127 es «no está»');
  assert.equal(corre('./nada').error, 'bash: ./nada: No such file or directory\n');
  assert.equal(corre('./notas.txt').codigo, 126, '126 es «está pero no es ejecutable»');
  assert.equal(corre('./notas.txt').error, 'bash: ./notas.txt: Permission denied\n');
  assert.equal(corre('./proyectos').error, 'bash: ./proyectos: Is a directory\n');
  assert.equal(corre('./proyectos').codigo, 126);
  // El que sí se puede ejecutar es el único caso que se declara: no lo ejecuta.
  assert.match(corre('./script.sh').error, /^simulador: bash: ejecutar un programa por su ruta/);
});

test('C7 los programas están donde `type` promete que están', () => {
  const estado = nuevo();
  assert.equal(ejecutar(estado, 'type ls').salida, 'ls is /usr/bin/ls\n');
  assert.equal(en(estado, '/usr/bin/ls').modo, 0o755, 'y el fichero existe de verdad');
  assert.equal(buscar(estado, '/usr/bin/cd').error, 'ENOENT', 'un builtin no tiene fichero');
  assert.equal(en(estado, '/bin').tipo, 'l', '/bin es un enlace, como en Debian 12');
  assert.equal(ejecutar(estado, 'ls /bin/ls').salida, '/bin/ls\n', 'y se puede recorrer');
});

/* ---------- permisos: lo que el banco de fidelidad no puede probar ---------- */

test('R1 el kernel elige un solo bloque de permisos y no los acumula', () => {
  const estado = nuevo();
  const inodo = { id: 999, tipo: 'f', modo: 0o604, usuario: 'jorge', grupo: 'jorge', mtime: 0, contenido: '' };
  // El dueño tiene rw- y "otros" tienen r--; el grupo, en medio, no tiene nada.
  assert.equal(puede({ ...estado, usuario: 'jorge', grupos: ['jorge'] }, inodo, 'w'), true);
  assert.equal(puede({ ...estado, usuario: 'ana', grupos: ['jorge'] }, inodo, 'r'), false,
    'ser del grupo no da los permisos de "otros" aunque sean mayores');
  assert.equal(puede({ ...estado, usuario: 'ana', grupos: ['ana'] }, inodo, 'r'), true);
});

test('R2 root se salta lectura y escritura, pero no ejecuta lo que no es ejecutable', () => {
  const estado = { ...nuevo(), usuario: 'root', grupos: ['root'] };
  const sinPermisos = { id: 998, tipo: 'f', modo: 0o000, usuario: 'jorge', grupo: 'jorge', mtime: 0, contenido: 'x' };
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
  assert.equal(en(conUmask('022', 'mkdir d'), 'd').modo, 0o755);
  assert.equal(en(conUmask('077', 'mkdir d'), 'd').modo, 0o700);
  assert.equal(en(conUmask('022', 'touch f'), 'f').modo, 0o644,
    'un fichero nace sin x aunque la umask lo permita');
  assert.equal(en(conUmask('002', 'touch f'), 'f').modo, 0o664);
});

test('R6 la copia nace con la umask aplicada; con -p se queda como estaba', () => {
  const estado = nuevo();
  ejecutar(estado, 'chmod 777 notas.txt && cp notas.txt sin-p && cp -p notas.txt con-p');
  assert.equal(en(estado, 'sin-p').modo, 0o755, 'copiar aplica la umask al modo del original');
  assert.equal(en(estado, 'con-p').modo, 0o777);
  assert.equal(en(estado, 'con-p').mtime, en(estado, 'notas.txt').mtime, '-p conserva la fecha');
  assert.equal(en(estado, 'sin-p').mtime, AHORA, 'sin -p la copia es de ahora');
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

/* ---------- presentación: la única diferencia entre pantalla y tubería ---------- */

test('V1 las columnas se rellenan hacia abajo primero, como en GNU ls', () => {
  const nombres = ['a', 'bb', 'ccc', 'dddd', 'e', 'f'];
  // Con 12 columnas de ancho caben dos de 6 (el nombre más largo son 4 + 2).
  assert.equal(enColumnas(nombres, 12), 'a     dddd\nbb    e\nccc   f\n');
  assert.equal(enColumnas(nombres, 4), 'a\nbb\nccc\ndddd\ne\nf\n', 'si no cabe otra, una sola columna');
  assert.equal(enColumnas([], 80), '', 'un directorio vacío no imprime nada');
  assert.equal(enColumnas(['solo'], 80), 'solo\n');
});

test('V2 solo un `ls` a secas se reparte en columnas al pintarlo', () => {
  assert.equal(lsDePantalla('ls'), true);
  assert.equal(lsDePantalla('ls -a proyectos'), true);
  assert.equal(lsDePantalla('ls -l'), false, 'el formato largo ya trae una línea por fichero');
  assert.equal(lsDePantalla('ls -1'), false);
  assert.equal(lsDePantalla('ls -la'), false);
  assert.equal(lsDePantalla('ls | wc -l'), false, 'por una tubería no va a la pantalla');
  assert.equal(lsDePantalla('ls > f'), false);
  assert.equal(lsDePantalla('ls ; ls'), false);
  assert.equal(lsDePantalla('cat notas.txt'), false);
  assert.equal(lsDePantalla('echo "sin cerrar'), false, 'una línea que no parsea no se toca');
});

test('V3 el núcleo siempre entrega una entrada por línea, aunque la pantalla reparta', () => {
  const r = corre('ls');
  assert.equal(r.salida.includes('  '), false, 'la salida del núcleo no lleva relleno de columnas');
  assert.equal(r.salida.trim().split('\n').length, 11, 'once entradas visibles en la carpeta personal');
});

/* ---------- lo que hace posible corregir ejercicios ---------- */

test('E1 el resultado de un ejercicio se comprueba en el árbol, no en lo que se teclee', () => {
  const caminos = [
    'mkdir /tmp/logs && chmod 750 /tmp/logs',
    'mkdir -m 750 /tmp/logs',
    'cd /tmp ; mkdir logs ; chmod u=rwx,g=rx,o= logs',
    'umask 027 ; mkdir /tmp/logs',
    'mkdir --parents /tmp/logs && chmod --recursive 750 /tmp/logs'
  ];
  for (const camino of caminos) {
    const estado = nuevo();
    ejecutar(estado, camino);
    const { inodo, error } = buscar(estado, '/tmp/logs');
    assert.equal(error, null, `no creó el directorio: ${camino}`);
    assert.equal(inodo.tipo, 'd', camino);
    assert.equal(inodo.modo, 0o750, `modo incorrecto por el camino: ${camino}`);
  }
});

test('E2 clonar aísla el estado, tabla de inodos incluida', () => {
  const antes = nuevo();
  const copia = clonar(antes);
  ejecutar(copia, 'rm -r proyectos && touch nuevo');
  assert.equal(buscar(copia, 'proyectos').error, 'ENOENT');
  assert.equal(buscar(antes, 'proyectos').error, null, 'el original no se ha tocado');
  assert.equal(buscar(antes, 'nuevo').error, 'ENOENT');
  assert.equal(inodoDe(antes.fs, antes.fs.raiz).hijos.home !== undefined, true);
});

test('E3 el código de salida es dato del ejercicio: distingue no encontrar de no poder', () => {
  assert.equal(corre('grep ERROR informe.log').codigo, 0);
  assert.equal(corre('grep nada informe.log').codigo, 1, '1 es "no hay coincidencias"');
  assert.equal(corre('grep ERROR nofichero').codigo, 2, '2 es "no pude mirar"');
  assert.equal(corre('ls nofichero').codigo, 2);
  assert.equal(corre('cat nofichero').codigo, 1);
  assert.equal(corre('inventado').codigo, 127);
  assert.equal(corre('ls -R').codigo, 2, 'un hueco declarado es un error de uso');
});

test('E4 dos alumnos con la misma orden ven lo mismo: el árbol no se hereda', () => {
  const uno = nuevo();
  ejecutar(uno, 'rm -r proyectos');
  const otro = nuevo();
  assert.equal(buscar(otro, 'proyectos').error, null);
  assert.equal(otro.fs.siguienteId, uno.fs.siguienteId, 'los ids arrancan igual, no son azar');
});
