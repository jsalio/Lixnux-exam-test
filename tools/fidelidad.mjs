/**
 * Banco de fidelidad: ejecuta la misma línea en el simulador y en el Linux de
 * verdad, y compara salida, error y código de salida.
 *
 * Sin esto, «parece correcto» es lo único que se puede decir de un simulador.
 * Con esto, la fidelidad es un número.
 *
 * Mide el núcleo **extraído de la página**, no una copia: lo que se comprueba
 * es exactamente lo que se publica.
 *
 * Uso:  node tools/fidelidad.mjs            resumen
 *       node tools/fidelidad.mjs -v         con el detalle de cada discrepancia
 *       node tools/fidelidad.mjs -v grep    solo un grupo
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, utimesSync, rmSync, linkSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generarModuloNucleo } from './extract-core.mjs';

const { ruta } = generarModuloNucleo({ pagina: 'terminal' });
const { estadoInicial, ejecutar, clonar, buscar, inodoDe } = await import(ruta);

const AHORA = Math.floor(Date.now() / 1000);

/* ---------- materializar el árbol virtual en disco de verdad ---------- */

/**
 * Escribe el subárbol del mundo virtual en un directorio real, con sus modos,
 * sus fechas y sus enlaces.
 *
 * Los permisos se aplican al volver de la recursión: si se aplicaran al bajar,
 * un directorio en 000 impediría crear lo que va dentro. Los inodos ya escritos
 * se recuerdan para que un segundo nombre del mismo inodo salga como enlace
 * duro de verdad y no como una copia.
 */
function materializar(fs, inodo, ruta, escritos) {
  if (inodo.tipo === 'l') { symlinkSync(inodo.destino, ruta); return; }
  if (inodo.tipo === 'c') return;  // un dispositivo no se puede crear sin root

  if (inodo.tipo === 'f') {
    const previo = escritos.get(inodo.id);
    if (previo !== undefined) { linkSync(previo, ruta); return; }
    writeFileSync(ruta, inodo.contenido);
    escritos.set(inodo.id, ruta);
  } else {
    mkdirSync(ruta, { recursive: true });
    for (const [nombre, id] of Object.entries(inodo.hijos)) {
      materializar(fs, inodoDe(fs, id), join(ruta, nombre), escritos);
    }
  }
  chmodSync(ruta, inodo.modo & 0o7777);
  utimesSync(ruta, inodo.mtime, inodo.mtime);
}

/**
 * Ejecuta la línea en bash de verdad, con locale y zona horaria fijas.
 *
 * Con `spawnSync` y no `execFileSync`: el segundo descarta `stderr` cuando el
 * comando termina con éxito, y entonces todo caso que acabe en `; echo $?`
 * parece no haber escrito nada al error.
 */
function real(linea, cwd) {
  const r = spawnSync('/bin/bash', ['-c', linea], {
    cwd,
    encoding: 'utf8',
    env: { LC_ALL: 'C', TZ: 'UTC', PATH: '/usr/local/bin:/usr/bin:/bin', HOME: cwd, USER: 'jorge', SHELL: '/bin/bash' }
  });
  if (r.error) throw r.error;
  return { salida: r.stdout ?? '', error: r.stderr ?? '', codigo: r.status ?? 0 };
}

/**
 * Normaliza diferencias que no son de fidelidad, y que hay que declarar:
 *
 *  1. `bash -c` prefija sus errores con `line N:`; un shell interactivo, que es
 *     lo que simulamos, no lo hace.
 *  2. La ruta del directorio temporal no existe en el mundo virtual.
 */
function normalizar(texto, raiz) {
  return texto
    // La raíz del sandbox es la raíz del mundo virtual: `pwd` allí dice «/».
    .split(raiz + '\n').join('/\n')
    .split(raiz).join('')
    .replace(/^\/bin\/bash: line \d+: /gm, 'bash: ');
}

/**
 * Casos que este banco NO puede comparar, con el motivo. Se declaran en el
 * informe: un banco que esconde lo que no mide no sirve para decidir nada.
 */
const NO_COMPARABLES = [
  ['ls -la (en la raíz del sandbox)', 'el dueño de `..` es root en el mundo virtual y no se puede reproducir sin ser root'],
  ['cd / && pwd', 'la raíz real no es la del sandbox'],
  ['ls -l /dev/null', 'el /dev/null real tiene dueño y fecha del sistema anfitrión'],
  ['id', 'el usuario real pertenece a los grupos del sistema anfitrión, no a los del mundo virtual'],
  ['ls -i', 'los números de inodo del mundo virtual son los suyos, no los del disco real'],
  ['la fecha de `..` (ls -lt, ls -at)', 'el padre del sandbox lo crea el banco al arrancar, no es el /home del mundo virtual'],
  ['el reparto de `ls` en columnas', 'se compara la salida por tubería, que va a una línea por fichero; en pantalla lo reparte `enColumnas`']
];

/* ---------- casos ---------- */

const CASOS = {
  navegacion: [
    'pwd', 'cd proyectos && pwd', 'cd .. && pwd', 'cd ../.. && pwd', 'cd nope',
    'cd notas.txt', 'cd cerrado && pwd', 'cd proyectos/interno && pwd', 'cd ~ && pwd'
  ],
  'ls-corto': ['ls', 'ls -a', 'ls -A', 'ls proyectos', 'ls vacio', 'ls nope', 'ls cerrado', 'ls -d proyectos', 'ls notas.txt proyectos', 'ls -r'],
  'ls-largo': ['ls -l', 'ls -la proyectos', 'ls -l proyectos', 'ls -l vacio', 'ls -l notas.txt', 'ls -l vacio.txt', 'ls -lh', 'ls -l antiguo.txt', 'ls -l secreto.txt', 'ls -ld proyectos', 'ls -l instalador.sh'],
  cat: ['cat notas.txt', 'cat notas.txt datos.csv', 'cat nope', 'cat proyectos', 'cat secreto.txt', 'cat -n notas.txt', 'cat vacio.txt', 'cat -A datos.csv', 'cat -E notas.txt', 'cat -T notas.txt'],
  'head-tail': ['head -n 2 informe.log', 'head -2 informe.log', 'tail -n 2 informe.log', 'tail -1 informe.log', 'head -n 0 informe.log', 'head informe.log notas.txt', 'head -n 99 notas.txt', 'head -v -n 1 notas.txt'],
  wc: ['wc notas.txt', 'wc -l notas.txt', 'wc -l < notas.txt', 'cat notas.txt | wc -l', 'wc -lw notas.txt', 'wc notas.txt informe.log', 'wc -c vacio.txt', 'wc -l nope', 'wc -m notas.txt', 'wc -cm notas.txt'],
  grep: [
    'grep ERROR informe.log', 'grep -n ERROR informe.log', 'grep -c ERROR informe.log',
    'grep -v ERROR informe.log', 'grep -i error informe.log', 'grep nada informe.log',
    'grep ERROR informe.log notas.txt', 'grep "^INFO" informe.log', 'grep vigo datos.csv',
    'grep -l ERROR informe.log notas.txt', 'cat informe.log | grep WARN'
  ],
  tuberias: [
    'cat informe.log | sort', 'cat informe.log | sort | uniq -c',
    'cut -d, -f1 datos.csv', 'cut -d, -f1,3 datos.csv', 'cut -d, -f2 datos.csv | sort -n',
    'grep -c . datos.csv', 'cat datos.csv | tr a-z A-Z', 'sort -u informe.log',
    'cut -d, -f3 datos.csv | sort | uniq -c | sort -nr'
  ],
  comodines: ['ls *.txt', 'ls *.md', 'ls proyectos/*.sh', 'ls ?.txt', 'ls "*.txt"', 'echo *.txt', 'wc -l *.txt', 'ls .*'],
  redireccion: [
    'echo hola > f1 && cat f1', 'echo a > f2 && echo b >> f2 && cat f2',
    'ls nope 2> e1 ; cat e1', 'wc -l < informe.log', 'cat < notas.txt',
    'cat nope > f3 ; echo codigo=$?', 'sort informe.log > ord && head -1 ord'
  ],
  'codigos-y-operadores': [
    'true ; echo $?', 'false ; echo $?', 'grep ERROR informe.log > /dev/null ; echo $?',
    'grep nada informe.log ; echo $?', 'nocomando ; echo $?', 'ls nope ; echo $?',
    'true && echo si', 'false && echo si', 'false || echo no', 'true || echo no',
    'cd nope && pwd ; echo $?'
  ],
  'crear-borrar': [
    'mkdir nueva && ls -d nueva', 'mkdir proyectos ; echo $?', 'mkdir -p a/b/c && find a | sort',
    'touch nuevo.txt && ls -l nuevo.txt', 'rmdir vacio && ls -d vacio ; echo $?',
    'rmdir proyectos ; echo $?', 'rm notas.txt && ls notas.txt ; echo $?',
    'rm proyectos ; echo $?', 'rm -r proyectos && ls -d proyectos ; echo $?',
    'rm nope ; echo $?', 'rm -f nope ; echo $?',
    'cp notas.txt copia.txt && cat copia.txt', 'cp proyectos otra ; echo $?',
    'cp -r proyectos otra && ls otra', 'mv notas.txt renombrado.txt && ls renombrado.txt',
    'mv nope x ; echo $?', 'cp notas.txt datos.csv proyectos && ls proyectos'
  ],
  permisos: [
    'chmod 600 notas.txt && ls -l notas.txt', 'chmod u+x notas.txt && ls -l notas.txt',
    'chmod go-r notas.txt && ls -l notas.txt', 'chmod a=r notas.txt && ls -l notas.txt',
    'chmod 755 nope ; echo $?', 'chmod +x vacio.txt && ls -l vacio.txt',
    'chmod 4755 script.sh && ls -l script.sh', 'chmod 1777 vacio && ls -ld vacio',
    'chmod 2755 vacio && ls -ld vacio', 'umask',
    'umask 077 ; touch privado.txt ; ls -l privado.txt',
    'chmod 000 vacio.txt && cat vacio.txt ; echo $?'
  ],
  find: [
    'find . -name "*.sh" | sort', 'find . -type d | sort', 'find proyectos | sort',
    'find . -name "*.txt" | sort', 'find . -maxdepth 1 -type f | sort',
    'find nope ; echo $?', 'find . -type f -name "a*" | sort'
  ],
  /* Ronda dura: casos elegidos para romper el simulador, no para lucirlo. */
  'duras-comillas': [
    'echo a\\ b', `echo "a'b"`, `echo 'a"b'`, 'echo "$HOME"', `echo '$HOME'`,
    'echo "a  b"  c', 'grep "fallo de red" informe.log', "grep 'ERROR' informe.log"
  ],
  'duras-regex': [
    'grep "ERROR\\|WARN" informe.log', 'grep -E "ERROR|WARN" informe.log',
    'grep "o+" notas.txt', 'grep -E "o+" notas.txt', 'grep "^$" vacio.txt',
    'grep "\\." datos.csv', 'grep "[0-9]" datos.csv', 'grep -w vigo datos.csv',
    'grep "s\\{2\\}" notas.txt'
  ],
  'duras-comodines': [
    'ls [ab]*.txt', 'ls *.[cl]*', 'ls proyectos/*', 'echo {1..3}',
    'ls no*existe*', 'ls */*.sh', 'echo .??*', 'ln -s nope roto && echo r*'
  ],
  'duras-tuberias': [
    'false | true ; echo $?', 'true | false ; echo $?',
    'cat notas.txt | head -2 | wc -l', 'ls | grep sh', 'ls -l | head -3',
    'cat informe.log | grep ERROR | wc -l', 'sort datos.csv | head -1',
    'ls nope 2>&1 | wc -l'
  ],
  'duras-shell': [
    'X=5 ; echo $X', 'cd - ; echo $?', 'for f in *.txt ; do echo $f ; done',
    'echo $(pwd)', 'echo `pwd`', 'if [ -f notas.txt ] ; then echo si ; fi',
    'ls ; ls', 'echo uno && echo dos && echo tres', 'type ln', 'type export'
  ],
  'duras-ficheros': [
    'cp -r proyectos nuevo && find nuevo | sort', 'mv proyectos vacio && ls vacio',
    'touch a b c && ls a b c', 'echo x > notas.txt && cat notas.txt',
    'rm -r . ; echo $?', 'mkdir -p x/y && rmdir x/y && ls -d x',
    'cp notas.txt notas.txt ; echo $?', 'mv vacio.txt vacio ; ls vacio',
    'chmod u+s script.sh && ls -l script.sh', 'chmod 777 secreto.txt && cat secreto.txt',
    'chmod g+s vacio && ls -ld vacio', 'umask 002 ; mkdir d2 ; ls -ld d2'
  ],
  /* Tercera ronda: rincones donde un simulador suele mentir sin enterarse. */
  'duras-nombres': [
    'touch "a b" && ls -1', 'mkdir "d 1" && ls -d "d 1"',
    'echo x > "f con espacios" && cat "f con espacios"',
    'touch -- -raro && ls -1 -- -raro', 'touch \'raro$dolar\' && ls -1',
    'echo "$(ls | head -1)"'
  ],
  'duras-permisos': [
    'chmod 700 proyectos && ls proyectos', 'chmod 500 proyectos && touch proyectos/nuevo ; echo $?',
    'chmod 600 script.sh && ls -l script.sh', 'chmod 000 proyectos && find proyectos ; echo $?',
    'chmod 400 notas.txt && echo x > notas.txt ; echo $?',
    'umask ; umask 077 ; umask', 'umask 077 ; mkdir d3 ; ls -ld d3',
    'chmod 000 vacio && cd vacio ; echo $?', 'chmod 000 vacio && rm -r vacio ; echo $?'
  ],
  'duras-rutas': [
    'cd proyectos && cat ../notas.txt', 'ls proyectos/interno',
    'ls -l proyectos/interno', 'cat proyectos/../notas.txt',
    'cd proyectos/interno && cd ../.. && pwd', 'ls ./proyectos/./interno',
    'find proyectos/interno | sort', 'mkdir -p a/b && cd a/b && cd ../.. && pwd'
  ],
  'duras-texto': [
    'wc -l informe.log notas.txt datos.csv', 'sort informe.log | uniq -d',
    'tr -d aeiou < notas.txt', 'tr a-z A-Z < notas.txt',
    'grep ERROR *.log', 'ls -l | wc -l', 'grep -c "" notas.txt',
    'grep -v "" notas.txt ; echo $?', 'cat notas.txt informe.log | wc -l',
    'sort -n datos.csv | head -2', 'tr -s aeiou < notas.txt', 'sort -b notas.txt'
  ],
  'duras-ficheros-2': [
    'echo x >> nuevo && cat nuevo', '> vacio2 && ls -l vacio2',
    'cp -r proyectos proyectos/copia ; echo $?', 'mv notas.txt proyectos/ && ls proyectos',
    'touch vacio/f && ls vacio', 'ln -s notas.txt enlace ; echo $?',
    'false ; echo $? ; echo $?', 'mkdir a b c && ls -d a b c',
    'rm -r vacio proyectos && ls'
  ],
  enlaces: [
    'ln -s notas.txt enlace && ls -l enlace', 'ln -s notas.txt enlace && cat enlace',
    'ln -s nope roto && cat roto ; echo $?', 'ln -s nope roto && ls -l roto',
    'ln -s proyectos pd && ls pd', 'ln -s proyectos pd && cd pd && pwd',
    'ln -s notas.txt e && rm e && ls notas.txt', 'ln -s notas.txt e && ln -s notas.txt e ; echo $?',
    'ln -s notas.txt e && wc -l e', 'ln -s notas.txt e && find . -type l | sort',
    'ln -s notas.txt e && mv e e2 && ls -l e2'
  ],
  /* Cuarta ronda: lo que esta versión añade sobre el prototipo. */
  'enlaces-duros': [
    'ln notas.txt duro && ls -l notas.txt duro', 'ln notas.txt duro && cat duro',
    'ln notas.txt duro && rm notas.txt && cat duro',
    'ln notas.txt duro && echo cambiado > duro && cat notas.txt',
    'ln notas.txt duro ; ln notas.txt duro ; echo $?',
    'ln proyectos pd ; echo $?', 'ln nope x ; echo $?',
    'ln notas.txt proyectos && ls -l proyectos',
    'ln notas.txt duro && touch duro && ls -l notas.txt',
    'ln notas.txt duro && rm duro && ls -l notas.txt',
    'ln -s notas.txt blando && ln blando duro2 && ls -l duro2',
    'ln notas.txt duro && find . -samefile notas.txt'
  ],
  'orden-de-ls': [
    'ls -t', 'ls -lt', 'ls -tr', 'ls -S', 'ls -lS', 'ls -Sr', 'ls -At',
    'touch nuevo && ls -t | head -2', 'ls -t proyectos'
  ],
  'opciones-largas': [
    'ls --all', 'ls --almost-all', 'ls --reverse', 'ls -l --human-readable',
    'ls --directory proyectos', 'wc --lines notas.txt', 'head --lines=2 informe.log',
    'tail --lines=1 informe.log', 'sort --numeric-sort --reverse datos.csv',
    'sort --unique informe.log', 'cut --delimiter=, --fields=2 datos.csv',
    'grep --count ERROR informe.log', 'grep --invert-match ERROR informe.log',
    'uniq --count notas.txt', 'mkdir --parents a/b && find a | sort',
    'rm --force nope ; echo $?', 'chmod --recursive 700 proyectos && ls -ld proyectos',
    'ln --symbolic notas.txt s && ls -l s', 'touch --no-create nope ; echo $?'
  ],
  'cut-y-recorte': [
    'cut -c1-3 notas.txt', 'cut -c-4 notas.txt', 'cut -c3- notas.txt',
    'cut -c1,4 notas.txt', 'cut -c1 -f1 notas.txt ; echo $?',
    'cut notas.txt ; echo $?', 'cut -c0 notas.txt ; echo $?',
    'cut -f0 -d, datos.csv ; echo $?', 'cut -c1 -d, notas.txt ; echo $?',
    'cut -f x notas.txt ; echo $?', 'cut -d, -f2- datos.csv',
    'head -c 5 notas.txt', 'head -c -20 notas.txt', 'tail -c 5 notas.txt',
    'tail -c +5 notas.txt', 'head -c x notas.txt ; echo $?', 'head -c 3 notas.txt datos.csv'
  ],
  'sort-con-clave': [
    'sort -k2 datos.csv', 'sort -t, -k2 datos.csv', 'sort -t, -k2 -n datos.csv',
    'sort -t, -k1,1 datos.csv', 'sort -t, -k1,1 -r datos.csv',
    'sort -t, -k3 datos.csv', 'sort -t, -k2 -u datos.csv',
    'sort -k 2 datos.csv', 'sort -t xx -k1 datos.csv ; echo $?',
    'sort -k 0 datos.csv ; echo $?', 'sort -t, -k9 datos.csv'
  ],
  'grep-con-contexto': [
    'grep -A1 ERROR informe.log', 'grep -B1 ERROR informe.log', 'grep -C1 ERROR informe.log',
    'grep -A2 WARN informe.log', 'grep -n -A1 ERROR informe.log',
    'grep -A1 -c ERROR informe.log', 'grep -A1 -l ERROR informe.log',
    'grep -A1 ERROR informe.log notas.txt', 'grep -C0 ERROR informe.log',
    'grep -A1 -v ERROR informe.log', 'grep -A x ERROR informe.log ; echo $?',
    'grep --after-context=1 ERROR informe.log'
  ],
  'echo-y-cat': [
    'echo -e "a\\tb"', 'echo -e "a\\nb"', 'echo -E "a\\nb"', 'echo -x hola',
    'echo -n -e "x\\n"', 'echo -ne "y\\n"', 'echo', 'echo -n',
    'echo -e "a\\\\tb"', 'cat -n informe.log | head -2'
  ],
  'copiar-y-mover': [
    'chmod 777 notas.txt && cp notas.txt c && ls -l c',
    'umask 077 ; cp notas.txt c ; ls -l c',
    'cp -p antiguo.txt c && ls -l c', 'cp antiguo.txt c && ls -l c',
    'cp -n notas.txt datos.csv ; head -1 datos.csv',
    'mv -n notas.txt datos.csv ; head -1 datos.csv',
    'rmdir -p proyectos/interno ; echo $?',
    'mkdir -p x/y/z && rmdir -p x/y/z ; ls -d x ; echo $?',
    'mv proyectos/interno . && ls interno'
  ],
  /* Huecos: lo que el simulador declara en vez de inventar. */
  'ordenes-por-ruta': [
    './nada ; echo $?', './notas.txt ; echo $?', './proyectos ; echo $?',
    'proyectos/interno/c.sh ; echo $?', './cerrado/dentro.txt ; echo $?',
    'chmod -x proyectos/a.sh && proyectos/a.sh ; echo $?'
  ],
  'huecos-declarados': [
    'wc -L notas.txt', 'ls -R', 'ls -C', 'ls -i', 'ls --format=long',
    'rm -v notas.txt', 'rm -i notas.txt', 'mkdir -v x', 'cp -v notas.txt c',
    'cat -v notas.txt', 'touch -a notas.txt', 'cut -b1 notas.txt',
    'sort -k2.3 datos.csv', 'sort -k1 -k2 datos.csv', 'exit', 'clear', './script.sh', 'chmod +x notas.txt && ./notas.txt',
    'while [ -f nada ] ; do echo x ; done', 'case x in y) echo z ;; esac',
    'find . -newer notas.txt', 'grep -r ERROR .'
  ],
  varios: ['echo hola', 'echo -n hola', 'echo "a  b"', "echo 'a  b'", 'echo $HOME', 'echo $NOEXISTE', 'whoami', 'type cd', 'type ls', 'type nada ; echo $?']
};

/* ---------- ejecución ---------- */

const verboso = process.argv.includes('-v');
const soloGrupo = process.argv.slice(2).find((a) => !a.startsWith('-'));

const base = mkdtempSync(join(tmpdir(), 'fidelidad-'));
const semilla = estadoInicial({ ahora: AHORA });
const casaVirtual = buscar(semilla, '/home/jorge').inodo;

let total = 0;
let iguales = 0;
const fallos = [];
const huecos = [];

for (const [grupo, lineas] of Object.entries(CASOS)) {
  if (soloGrupo && grupo !== soloGrupo) continue;

  for (const linea of lineas) {
    // Cada caso parte de un árbol limpio: los que modifican no se contaminan.
    // El sandbox reproduce /home/jorge dentro del temporal: así `cd ..` y
    // `pwd` dan la misma profundidad que en el mundo virtual y se pueden
    // comparar tras quitar el prefijo.
    const raizReal = mkdtempSync(join(base, 'caso-'));
    const cwd = join(raizReal, 'home', 'jorge');
    mkdirSync(cwd, { recursive: true });
    materializar(semilla.fs, casaVirtual, cwd, new Map());

    const r = real(linea, cwd);
    const estado = clonar(semilla);
    const s = ejecutar(estado, linea);

    const esperado = {
      salida: normalizar(r.salida, raizReal),
      error: normalizar(r.error, raizReal),
      codigo: r.codigo
    };
    const obtenido = { salida: s.salida, error: s.error, codigo: s.codigo };

    total++;
    const igual =
      esperado.salida === obtenido.salida &&
      esperado.error === obtenido.error &&
      esperado.codigo === obtenido.codigo;

    // Un hueco declarado no es una infidelidad: el simulador dice que no sabe.
    // Mezclar las dos cosas en un único porcentaje ocultaría lo único grave,
    // que es dar por buena una salida distinta de la real sin avisar.
    const hueco = !igual && obtenido.error.includes('simulador:');

    if (igual) iguales++;
    else if (hueco) huecos.push({ grupo, linea, obtenido });
    else fallos.push({ grupo, linea, esperado, obtenido });

    // Devolver los permisos para poder limpiar lo que estaba en 000.
    try { execFileSync('/bin/chmod', ['-R', 'u+rwX', raizReal]); } catch { /* nada */ }
    rmSync(raizReal, { recursive: true, force: true });
  }
}

rmSync(base, { recursive: true, force: true });

/* ---------- informe ---------- */

const porGrupo = {};
for (const [grupo, lineas] of Object.entries(CASOS)) {
  if (soloGrupo && grupo !== soloGrupo) continue;
  porGrupo[grupo] = { total: lineas.length, fallos: 0, huecos: 0 };
}
for (const f of fallos) porGrupo[f.grupo].fallos++;
for (const h of huecos) porGrupo[h.grupo].huecos++;

console.log('\nFIDELIDAD FRENTE A COREUTILS / BASH REALES\n');
const ancho = Math.max(...Object.keys(porGrupo).map((g) => g.length));
console.log(`  ${'grupo'.padEnd(ancho)}  ${'# igual  ? hueco declarado  . distinto'.padEnd(22)} igual  hueco  distinto`);
for (const [grupo, d] of Object.entries(porGrupo)) {
  const ok = d.total - d.fallos - d.huecos;
  const barra = ('#'.repeat(Math.round((ok / d.total) * 20)) + '?'.repeat(Math.round((d.huecos / d.total) * 20))).slice(0, 20).padEnd(20, '.');
  console.log(
    `  ${grupo.padEnd(ancho)}  ${barra}  ${String(ok).padStart(4)}  ${String(d.huecos).padStart(5)}  ${String(d.fallos).padStart(8)}`
  );
}
const comparables = total - huecos.length;
console.log(`\n  Fidelidad sobre lo implementado: ${iguales}/${comparables} (${((iguales / comparables) * 100).toFixed(1)}%)`);
console.log(`  Cobertura del banco:              ${iguales}/${total} (${((iguales / total) * 100).toFixed(1)}%)`);
console.log(`  Huecos declarados:                ${huecos.length}   ·   Discrepancias silenciosas: ${fallos.length}`);

if (huecos.length) {
  console.log('\n  Huecos declarados (el simulador avisa de que no sabe):');
  for (const h of huecos) console.log(`    [${h.grupo}] ${h.linea}`);
}
console.log('\n  Fuera de medida (el banco no puede compararlos):');
for (const [caso, motivo] of NO_COMPARABLES) console.log(`    ${caso}  —  ${motivo}`);
console.log('');

if (fallos.length && !verboso) {
  console.log('  Discrepancias:');
  for (const f of fallos) console.log(`    [${f.grupo}] ${f.linea}`);
  console.log('\n  Con -v se ve el detalle de cada una.\n');
}

if (verboso) {
  const ver = (s) => JSON.stringify(s);
  for (const f of fallos) {
    console.log(`\n${'-'.repeat(70)}\n[${f.grupo}] $ ${f.linea}`);
    if (f.esperado.salida !== f.obtenido.salida) {
      console.log(`  stdout real  : ${ver(f.esperado.salida)}`);
      console.log(`  stdout simul.: ${ver(f.obtenido.salida)}`);
    }
    if (f.esperado.error !== f.obtenido.error) {
      console.log(`  stderr real  : ${ver(f.esperado.error)}`);
      console.log(`  stderr simul.: ${ver(f.obtenido.error)}`);
    }
    if (f.esperado.codigo !== f.obtenido.codigo) {
      console.log(`  codigo real  : ${f.esperado.codigo}   simulador: ${f.obtenido.codigo}`);
    }
  }
  console.log('');
}

process.exitCode = fallos.length ? 1 : 0;
