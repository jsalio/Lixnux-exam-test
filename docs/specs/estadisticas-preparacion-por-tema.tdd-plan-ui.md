# TDD Plan UI: Estadísticas de preparación por temario

**Feature**: Pantalla que muestra el estado de preparación por tema, ordenado por impacto de estudio.
**Spec de origen**: [estadisticas-preparacion-por-tema.spec.md](estadisticas-preparacion-por-tema.spec.md)
**Arch de origen**: [estadisticas-preparacion-por-tema.arch.md](estadisticas-preparacion-por-tema.arch.md)
**Fecha**: 2026-08-18
**Framework UI**: ninguno — HTML y JavaScript plano en un archivo único, render por `innerHTML`
**Total de tests planificados**: 18

---

## Resumen

- Funciones de render **Dumb** (puras, devuelven cadena): 3 → 10 tests
- Controlador **Smart** (`renderStats` y los controles de datos): 1 → 7 tests
- Integración con el ciclo del intento: 1 test

**La decisión que hace esto testeable**: las funciones de render no escriben en el DOM, *devuelven
HTML como cadena*. El controlador es el único que hace `innerHTML = ...`. Así el 60 % de la pantalla
se prueba con aserciones sobre texto, sin jsdom y sin navegador. Es la traducción de Smart/Dumb a un
proyecto sin componentes.

Las funciones puras de render viven **fuera** de los marcadores del núcleo: son presentación, y el
núcleo no debe saber que existe el HTML. Se prueban a través de `tests/browser-stub.mjs`, que ya
carga la aplicación con el navegador inyectado por parámetros.

---

## Clasificación de componentes

| Componente | Tipo | Responsabilidad | Dependencias |
|---|---|---|---|
| `statsSummaryHtml(proyeccion)` | Dumb | Cabecera: nota estimada, escala, intentos y avisos | ninguna |
| `statsTableHtml(proyeccion)` | Dumb | Filas de temas en el orden recibido, con muestra y semáforo | ninguna |
| `leechListHtml(rebeldes)` | Dumb | Lista de preguntas que se resisten | `byId` (banco) |
| `renderStats()` | Smart | Lee historial, calcula la proyección, inyecta HTML y cablea botones | `store`, núcleo |

### Estados por componente

| Componente | IDLE | LOADING | SUCCESS | ERROR | EMPTY |
|---|---|---|---|---|---|
| `statsSummaryHtml` | ✅ | ❌ | ✅ | ❌ | ✅ |
| `statsTableHtml` | ✅ | ❌ | ✅ | ❌ | ✅ |
| `leechListHtml` | ✅ | ❌ | ✅ | ❌ | ✅ |
| `renderStats` | ✅ | ❌ todo es síncrono | ✅ | ✅ historial ilegible | ✅ |
| Controles de datos | ✅ | ✅ importando | ✅ | ✅ archivo inválido | ❌ |

`LOADING` casi no aplica: no hay red y `computeStats` sobre el historial lleno tarda 2,8 ms medidos.
El único estado de espera real es leer el archivo al importar.

### Interacciones del usuario

| Acción | Consecuencia observable |
|---|---|
| Abrir la pantalla desde inicio o desde el resultado | Se pinta la proyección al día |
| Pulsar «Exportar progreso» | Se descarga un archivo; sin datos, avisa |
| Elegir un archivo en «Importar progreso» | Informa de cuántos entraron y repinta |
| Pulsar «Borrar mis datos» | Pide confirmación; **no borra todavía** |
| Confirmar el borrado | El historial desaparece y la pantalla pasa a vacía |
| Cancelar el borrado | No cambia nada |

---

## Plan por componente

### `statsTableHtml` — Dumb

#### U1.1 · EMPTY
- **Nombre**: `dado_un_tema_sin_datos_cuando_pinto_la_tabla_entonces_lo_marca_en_vez_de_mostrar_un_porcentaje()`
- **Assert**: la fila contiene «sin datos» y **no** contiene el `50 %` del prior
- **Invariante 6 del sistema**

#### U1.2 · orden
- **Nombre**: `dada_una_proyeccion_cuando_pinto_la_tabla_entonces_las_filas_salen_en_el_orden_recibido()`
- **Arrange**: proyección con `orden: ['103','101']` aunque `porTema` esté en otro orden
- **Assert**: la posición de «103» en la cadena es menor que la de «101»
- **Invariante 4 del sistema** — el render no puede reordenar por su cuenta

#### U1.3 · muestra
- **Nombre**: `dado_un_tema_con_datos_cuando_pinto_la_tabla_entonces_el_porcentaje_va_con_su_numero_de_preguntas()`
- **Assert**: la fila contiene el porcentaje y también `nCrudo`
- **Invariante 5 del sistema** — y el riesgo aceptado del spec: el dominio es ponderado, así que
  el número de preguntas nunca puede faltar al lado

#### U1.4 · semáforo
- **Nombre**: `dado_un_tema_por_encima_del_umbral_de_dominado_cuando_pinto_la_tabla_entonces_la_accion_es_repasar()`
- **Assert**: la fila de un tema con `estado:'repasar'` dice «repasar»; la de `'estudiar'` dice «estudiar»

### `statsSummaryHtml` — Dumb

#### U2.1 · EMPTY
- **Nombre**: `dado_un_historial_vacio_cuando_pinto_el_resumen_entonces_invita_a_empezar_y_no_muestra_nota()`

#### U2.2 · muestra corta
- **Nombre**: `dados_menos_de_tres_intentos_cuando_pinto_el_resumen_entonces_avisa_de_que_la_muestra_es_corta()`

#### U2.3 · memorización
- **Nombre**: `dado_que_la_proyeccion_detecta_memorizacion_cuando_pinto_el_resumen_entonces_lo_advierte()`

#### U2.4 · nota
- **Nombre**: `dada_una_nota_estimada_cuando_pinto_el_resumen_entonces_muestra_su_equivalencia_en_la_escala_oficial()`

### `leechListHtml` — Dumb

#### U3.1 · EMPTY
- **Nombre**: `dado_que_no_hay_preguntas_rebeldes_cuando_pinto_la_lista_entonces_no_aparece_la_seccion()`

#### U3.2
- **Nombre**: `dadas_preguntas_rebeldes_cuando_pinto_la_lista_entonces_cada_una_indica_su_tema_y_sus_apariciones()`

### `renderStats` — Smart

#### U4.1 · SUCCESS
- **Nombre**: `dado_un_historial_con_intentos_cuando_abro_la_pantalla_entonces_pinta_los_cinco_temas()`
- **Mocks**: ninguno — almacenamiento falso con historial sembrado

#### U4.2 · EMPTY
- **Nombre**: `dado_un_historial_vacio_cuando_abro_la_pantalla_entonces_muestra_el_estado_sin_datos()`

#### U4.3 · ERROR
- **Nombre**: `dado_un_historial_ilegible_cuando_abro_la_pantalla_entonces_degrada_a_sin_datos_sin_lanzar()`
- **Arrange**: la clave del historial contiene basura

### Controles de datos — Smart

#### U5.1 · confirmación
- **Nombre**: `cuando_el_usuario_pide_borrar_entonces_primero_pide_confirmacion_y_no_borra_nada()`
- **Arrange**: `confirm` devuelve false
- **Assert**: el historial sigue intacto
- **Invariante 2 del sistema** — la pantalla es de solo lectura salvo acciones explícitas

#### U5.2
- **Nombre**: `cuando_el_usuario_confirma_el_borrado_entonces_el_historial_desaparece()`

#### U5.3 · SUCCESS
- **Nombre**: `cuando_importo_un_archivo_valido_entonces_informa_de_cuantos_entraron_y_repinta()`

#### U5.4 · ERROR
- **Nombre**: `cuando_importo_un_archivo_ilegible_entonces_muestra_el_error_y_conserva_el_historial()`

---

## Test de integración

#### U6.1
- **Nombre**: `dado_un_intento_recien_terminado_cuando_abro_las_estadisticas_entonces_aparece_contado()`
- **Componentes**: `onAttemptFinished` + `renderStats`
- **Assert**: el resumen pasa de 0 a 1 intento y el tema de esas preguntas deja de estar «sin datos»

---

## Tests de segunda prioridad

- U2.3 memorización y U3.2 rebeldes — señales secundarias, no bloquean la utilidad de la tabla.
- U1.4 semáforo — el texto de la acción es cosmético comparado con el orden, que sí es el feature.

## Tests excluidos y motivo

| Test candidato | Motivo |
|---|---|
| Colores del semáforo, clases CSS, estructura de etiquetas | Detalle visual, no comportamiento |
| La descarga real del archivo exportado | Depende de `Blob` y del navegador; se prueba que devuelve `ok` y el conteo |
| El `<input type="file">` y su `FileReader` | Se prueba `importProgress(texto)`, que es donde está la decisión |
| Impresión de la pantalla | Fuera del alcance del feature |
| Que `innerHTML` renderice HTML | Es el navegador, no nuestro código |

---

## Próximo paso

`/why` — documentar el motivo de cada cambio antes de commitear.
