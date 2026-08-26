/**
 * Pruebas de la vista de la terminal simulada.
 *
 * La vista no se puede extraer —su razón de ser es hablar con el navegador—,
 * así que se carga la página entera sobre un DOM de mentira y se observa lo que
 * escribe y cómo responde al teclado. Lo que se comprueba aquí es la máquina de
 * estados de docs/specs/terminal-simulador-nucleo.spec.md, no el shell.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(resolve(RAIZ, 'linux_terminal/index.html'), 'utf8');
const AHORA_MS = 1755000000000;

/** El bloque de lógica de la página: núcleo y vista, tal como se publica. */
function guionDeLaPagina() {
  const bloques = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  return bloques[bloques.length - 1];
}

/**
 * Carga la página sobre un DOM simulado y devuelve mandos para observarla.
 *
 * @returns {{texto:()=>string, prompt:()=>string, estado:()=>string,
 *            teclear:(linea:string)=>void, tecla:(ev:object)=>void,
 *            pulsar:(id:string)=>void, nodos:()=>Array<object>, chips:()=>number}}
 */
function cargarTerminal() {
  const nodos = new Map();

  const crearNodo = (id) => {
    const nodo = {
      id,
      textContent: '',
      value: '',
      className: '',
      disabled: false,
      scrollTop: 0,
      scrollHeight: 500,
      hijos: [],
      escuchas: {},
      _html: '',
      get innerHTML() { return this._html; },
      set innerHTML(v) { this._html = String(v); if (v === '') this.hijos = []; },
      appendChild(n) { this.hijos.push(n); },
      addEventListener(ev, fn) { (this.escuchas[ev] = this.escuchas[ev] || []).push(fn); },
      // La regla mide 40 caracteres; 400 px de regla y 800 de pantalla dan 80 columnas.
      getBoundingClientRect() { return { width: id === 'regla' ? 400 : 800 }; },
      setSelectionRange() {},
      focus() {}
    };
    if (id === 'regla') nodo.textContent = 'M'.repeat(40);
    return nodo;
  };

  const documento = {
    getElementById(id) {
      if (!nodos.has(id)) nodos.set(id, crearNodo(id));
      return nodos.get(id);
    },
    createElement() { return crearNodo('pre'); }
  };
  const ventana = { getSelection: () => '' };
  // El núcleo sí usa `new Date(ms)` para dar formato a las fechas; lo que no
  // puede es preguntar la hora. Se le da un Date con `now` fijo.
  const reloj = class extends Date { static now() { return AHORA_MS; } };

  const guion = guionDeLaPagina();
  // eslint-disable-next-line no-new-func
  new Function('document', 'window', 'Date', guion)(documento, ventana, reloj);

  const salida = documento.getElementById('salida');
  const entrada = documento.getElementById('entrada');

  const tecla = (ev) => {
    for (const fn of entrada.escuchas.keydown ?? []) fn({ preventDefault() {}, ...ev });
  };

  return {
    texto: () => salida.hijos.map((h) => h.innerHTML).join('\n'),
    nodos: () => salida.hijos,
    prompt: () => documento.getElementById('prompt').textContent,
    estado: () => documento.getElementById('estado').textContent,
    entrada: () => entrada,
    chips: () => documento.getElementById('chips').hijos.length,
    teclear: (linea) => { entrada.value = linea; tecla({ key: 'Enter' }); },
    tecla,
    pulsar: (id) => { for (const fn of documento.getElementById(id).escuchas.click ?? []) fn(); }
  };
}

test('W1 al cargar, la terminal está lista, con su prompt y el aviso del árbol', () => {
  const t = cargarTerminal();
  assert.equal(t.estado(), 'listo');
  assert.equal(t.prompt(), 'jorge@simulador:~$ ');
  assert.match(t.texto(), /árbol de partida montado en \/home\/jorge/);
  assert.equal(t.entrada().disabled, false);
  assert.equal(t.chips() > 25, true, 'la página lista los comandos que hay');
});

test('W2 una orden deja el eco de lo escrito y su salida, y vuelve a listo', () => {
  const t = cargarTerminal();
  t.teclear('pwd');
  const bloques = t.nodos();
  assert.equal(bloques[bloques.length - 2].innerHTML, 'jorge@simulador:~$ pwd');
  assert.equal(bloques[bloques.length - 2].className, 'eco');
  assert.equal(bloques[bloques.length - 1].innerHTML, '/home/jorge');
  assert.equal(t.estado(), 'listo');
  assert.equal(t.entrada().value, '', 'la línea se vacía tras ejecutar');
});

test('W3 el prompt sigue al directorio de trabajo y abrevia la casa con ~', () => {
  const t = cargarTerminal();
  t.teclear('cd proyectos');
  assert.equal(t.prompt(), 'jorge@simulador:~/proyectos$ ');
  t.teclear('cd /tmp');
  assert.equal(t.prompt(), 'jorge@simulador:/tmp$ ');
});

test('W4 `ls` a secas se reparte en columnas; `ls -l` se deja como está', () => {
  const t = cargarTerminal();
  t.teclear('ls');
  const corto = t.nodos()[t.nodos().length - 1].innerHTML;
  assert.match(corto, /notas\.txt {2,}/, 'hay relleno de columnas');
  assert.equal(corto.split('\n').length < 11, true, 'once entradas en menos de once líneas');

  t.teclear('ls -l');
  const largo = t.nodos()[t.nodos().length - 1].innerHTML;
  assert.equal(largo.split('\n').length, 12, 'total y once entradas, una por línea');
});

test('W5 el canal de error separa el fallo del shell del hueco declarado', () => {
  const t = cargarTerminal();
  t.teclear('cat nope');
  let ultimo = t.nodos()[t.nodos().length - 1];
  assert.equal(ultimo.className, 'err');
  assert.match(ultimo.innerHTML, /No such file or directory/);

  t.teclear('ls -R');
  ultimo = t.nodos()[t.nodos().length - 1];
  assert.equal(ultimo.className, 'aviso', 'un hueco declarado no se pinta como un fallo');
  assert.match(ultimo.innerHTML, /^simulador: /);
});

test('W6 el historial se recorre con ↑ y ↓ y devuelve lo que estaba a medias', () => {
  const t = cargarTerminal();
  t.teclear('pwd');
  t.teclear('whoami');
  t.entrada().value = 'a medias';
  t.tecla({ key: 'ArrowUp' });
  assert.equal(t.entrada().value, 'whoami');
  t.tecla({ key: 'ArrowUp' });
  assert.equal(t.entrada().value, 'pwd');
  t.tecla({ key: 'ArrowDown' });
  assert.equal(t.entrada().value, 'whoami');
  t.tecla({ key: 'ArrowDown' });
  assert.equal(t.entrada().value, 'a medias', 'lo que se estaba escribiendo no se pierde');
});

test('W7 Ctrl+L limpia la pantalla y Ctrl+C descarta la línea dejando la marca', () => {
  const t = cargarTerminal();
  t.teclear('pwd');
  t.tecla({ key: 'l', ctrlKey: true });
  assert.equal(t.texto(), '', 'la pantalla queda vacía');

  t.entrada().value = 'rm -rf algo';
  t.tecla({ key: 'c', ctrlKey: true });
  assert.match(t.texto(), /rm -rf algo\^C$/);
  assert.equal(t.entrada().value, '');
});

test('W8 reiniciar vuelve al árbol semilla y limpia pantalla e historial', () => {
  const t = cargarTerminal();
  t.teclear('rm -r proyectos && touch invento');
  t.teclear('ls');
  assert.match(t.nodos()[t.nodos().length - 1].innerHTML, /invento/);

  t.pulsar('btnReiniciar');
  assert.match(t.texto(), /árbol de partida montado/);
  t.tecla({ key: 'ArrowUp' });
  assert.equal(t.entrada().value, '', 'el historial también se reinicia');
  t.teclear('ls');
  const tras = t.nodos()[t.nodos().length - 1].innerHTML;
  assert.match(tras, /proyectos/, 'lo borrado ha vuelto');
  assert.equal(/invento/.test(tras), false, 'lo creado ya no está');
});

test('W9 una línea vacía solo baja el prompt, y no rompe nada', () => {
  const t = cargarTerminal();
  const antes = t.nodos().length;
  t.teclear('   ');
  assert.equal(t.nodos().length, antes + 1, 'solo el eco');
  assert.equal(t.estado(), 'listo');
});

test('W10 la salida se escapa: el shell devuelve texto, nunca marcado', () => {
  const t = cargarTerminal();
  t.teclear('echo "<b>hola</b>"');
  assert.equal(t.nodos()[t.nodos().length - 1].innerHTML, '&lt;b&gt;hola&lt;/b&gt;');
});
