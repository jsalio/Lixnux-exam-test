# TDD Plan: Estadísticas de preparación por temario

**Feature**: Agregar los intentos finalizados y ordenar los temas por impacto de estudio.
**Spec de origen**: [estadisticas-preparacion-por-tema.spec.md](estadisticas-preparacion-por-tema.spec.md)
**Arch de origen**: [estadisticas-preparacion-por-tema.arch.md](estadisticas-preparacion-por-tema.arch.md)
**Impact**: [estadisticas-preparacion-por-tema.impact.md](estadisticas-preparacion-por-tema.impact.md)
**Fecha**: 2026-08-18
**Total de tests planificados**: 36

---

## Resumen

| Banda de la arquitectura | Equivalencia clásica | Tests | Tipo |
|---|---|---|---|
| 2 — Núcleo puro (fórmulas) | dominio | 20 | unitario, sin dobles |
| 2 — Núcleo puro (historial) | dominio | 6 | unitario, sin dobles |
| 3+4 — Adaptadores y orquestación | aplicación / infraestructura | 8 | unitario con `store` falso |
| — Guardia arquitectónica | — | 2 | estático sobre el archivo |

Ejecutor: `node --test` sobre el núcleo extraído por `tools/extract-core.mjs`. Sin dependencias
nuevas, sin navegador y sin `package.json`.

**La pantalla no entra en este plan.** Los estados `sin_datos`, `muestra_corta`, `con_datos`,
`confirmando_borrado`, `importando` e `import_error` y sus 7 transiciones son material de
`/tdd-plan-ui`.

---

## Cobertura de invariantes

### Invariantes del modelo (spec)

| # | Invariante | Test asignado |
|---|---|---|
| 1 | Solo entran intentos finalizados | 4.3 |
| 2 | Un `cid` aparece como máximo una vez | 3.3, 3.4, 4.4 |
| 3 | `dominio ∈ [0,1]`; con `N=0` vale `P0` y es `sin_datos` | 1.1, 2.3 |
| 4 | `nCrudo` crudo frente a `dominio` ponderado | 2.12 |
| 5 | Preguntas fuera del banco se ignoran sin borrarse | 2.9 |
| 6 | Tope de 50 intentos, FIFO | 3.5 |
| 7 | Ningún resultado por pregunta viaja a la red | 5.2 |
| 8 | Un fallo de almacenamiento no impide usar el examen | 4.8 |

### Invariantes del sistema (spec)

| # | Invariante | Test asignado |
|---|---|---|
| 1 | Un fallo del histórico no impide terminar ni revisar | 4.8 |
| 2 | La pantalla es de solo lectura salvo importar y borrar | `/tdd-plan-ui` |
| 3 | Ningún dato por pregunta sale del navegador | 5.2 |
| 4 | El orden es siempre por impacto de estudio | **2.2** |
| 5 | Todo porcentaje va con su tamaño de muestra | 2.12 + `/tdd-plan-ui` |
| 6 | Un tema sin datos se marca, no se inventa un número | 2.3 |
| 7 | Borrar no afecta al intento, idioma, nombre ni cola | 4.7 |
| 8 | Cálculo determinista, independiente de la hora | 2.5, 5.1 |

Ningún invariante queda sin test salvo el nº 2 del sistema, que es puramente de interfaz.

---

## Secuencia de implementación

### Iteración 1 — La fórmula de dominio (Red/Green/Refactor)

Se empieza aquí porque `topicMastery` es la función más pequeña de la que depende todo lo demás.

#### Test 1.1
- **Nombre**: `dado_un_tema_sin_muestras_cuando_calculo_su_dominio_entonces_devuelve_el_prior()`
- **Tipo**: unitario
- **Arrange**: lista de muestras vacía
- **Act**: `topicMastery([])`
- **Assert**: `0.5` exacto
- **GREEN mínimo**: `return (0 + K*P0) / (0 + K)`
- **Prioridad**: 1

#### Test 1.2
- **Nombre**: `dado_dos_aciertos_de_dos_preguntas_cuando_calculo_el_dominio_entonces_no_llega_al_cien_por_cien()`
- **Tipo**: unitario
- **Arrange**: una muestra `{peso:1, ok:2, n:2}`
- **Act**: `topicMastery(muestras)`
- **Assert**: `≈ 0.643` y estrictamente `< 1`
- **GREEN mínimo**: aplicar el encogimiento completo
- **Prioridad**: 1
- **Por qué importa**: es la razón de ser del prior. Sin él, dos aciertos sueltos mandarían al
  usuario a estudiar el tema equivocado.

#### Test 1.3
- **Nombre**: `dado_un_tema_con_muestra_grande_cuando_calculo_el_dominio_entonces_converge_a_la_proporcion_real()`
- **Tipo**: unitario
- **Arrange**: muestra `{peso:1, ok:180, n:200}` (90 %)
- **Act**: `topicMastery(muestras)`
- **Assert**: dentro de `0.89 ± 0.01` — el prior deja de pesar
- **Prioridad**: 1

#### Test 1.4
- **Nombre**: `dados_los_mismos_aciertos_totales_cuando_los_recientes_son_mejores_entonces_el_dominio_es_mayor()`
- **Tipo**: unitario
- **Arrange**: dos historiales espejo — A con `[10/10 reciente, 0/10 antiguo]`, B con `[0/10 reciente, 10/10 antiguo]`
- **Act**: `topicMastery(A)` y `topicMastery(B)`
- **Assert**: `dominio(A) > dominio(B)`, con la misma suma cruda
- **Prioridad**: 1
- **Por qué importa**: es la única prueba de que la ponderación por recencia existe de verdad. Sin
  ella, un `FACTOR_OLVIDO = 1` pasaría inadvertido.

#### Test 1.5
- **Nombre**: `dado_el_factor_de_olvido_cuando_pasan_cuatro_intentos_entonces_el_peso_cae_a_la_mitad()`
- **Tipo**: unitario
- **Assert**: `0.85^4 ≈ 0.522`, dentro de `0.5 ± 0.03`
- **Prioridad**: 2
- **Nota**: fija la vida media declarada en el spec para que nadie la cambie sin darse cuenta.

#### Test 1.6
- **Nombre**: `dado_un_id_de_pregunta_como_cadena_cuando_lo_busco_en_el_indice_entonces_encuentra_la_pregunta()`
- **Tipo**: unitario
- **Arrange**: `qIndex` construido desde `Q`
- **Act**: buscar `"301"` y `301`
- **Assert**: ambos devuelven la misma pregunta, con su `topic` y su `type`
- **Prioridad**: 1
- **Por qué importa**: cubre el fallo silencioso nº 6 de `/impact`. Sin este test, un `Number()`
  olvidado deja todos los temas en `sin_datos` sin lanzar ningún error.

#### Test 1.7
- **Nombre**: `dado_un_intento_resuelto_cuando_lo_resumo_entonces_los_conteos_suman_el_total()`
- **Tipo**: unitario (regresión de `summarizeAttempt`, que ya existe)
- **Assert**: `ok + ko + blank === total`
- **Prioridad**: 1

---

### Iteración 2 — `computeStats` (Red/Green/Refactor)

#### Test 2.1
- **Nombre**: `dado_un_historial_vacio_cuando_calculo_las_estadisticas_entonces_devuelve_la_proyeccion_neutra_sin_lanzar()`
- **Arrange**: `{v:1, intentos:[]}`
- **Assert**: `resumen.intentos === 0`, los cinco temas en `sin_datos`, `rebeldes` vacío
- **Prioridad**: 1

#### Test 2.2 — **el test central del feature**
- **Nombre**: `dado_un_tema_flojo_de_poco_peso_y_otro_menos_flojo_de_mucho_peso_cuando_ordeno_por_impacto_entonces_gana_el_de_mucho_peso()`
- **Arrange**: historial construido para que el tema 101 (peso 0,175) quede en 0,55 de dominio y el
  103 (peso 0,25) en 0,57
- **Act**: `computeStats(historial)`
- **Assert**: el 103 aparece **antes** que el 101, pese a tener mejor dominio
  (`0,08 × 0,25 = 0,020` frente a `0,10 × 0,175 = 0,0175`)
- **Prioridad**: 1
- **Por qué importa**: si el orden fuera por porcentaje, este test falla. Es el invariante 4 del
  sistema y la diferencia entre "un informe" y "dime qué estudiar".

#### Test 2.3
- **Nombre**: `dado_un_tema_sin_preguntas_vistas_cuando_calculo_las_estadisticas_entonces_no_entra_en_el_ranking_de_impacto()`
- **Assert**: `estado === 'sin_datos'` y no aparece en la lista ordenada
- **Prioridad**: 1

#### Test 2.4
- **Nombre**: `dado_un_dominio_del_sesenta_y_cinco_por_ciento_en_todos_los_temas_cuando_estimo_la_nota_entonces_da_sesenta_y_cinco()`
- **Assert**: `resumen.notaEstimada ≈ 65.0`; los pesos suman 1
- **Prioridad**: 1
- **Nota**: verifica de paso que `Σ peso_t = 1`, error fácil si alguien edita `SIM_PLAN`.

#### Test 2.5
- **Nombre**: `dado_el_mismo_historial_cuando_calculo_dos_veces_entonces_las_proyecciones_son_identicas()`
- **Assert**: `JSON.stringify` de ambas salidas es igual
- **Prioridad**: 1 · **Invariante 8 del sistema**

#### Test 2.6
- **Nombre**: `dada_una_pregunta_acertada_al_estrenarla_y_fallada_despues_cuando_calculo_primera_vez_entonces_cuenta_como_acierto()`
- **Assert**: `primeraVez` la cuenta como acierto aunque `dominio` haya bajado
- **Prioridad**: 1

#### Test 2.7
- **Nombre**: `dado_un_dominio_muy_por_encima_del_acierto_en_primera_vez_cuando_calculo_el_resumen_entonces_marca_memorizacion()`
- **Arrange**: banco repetido con dominio 0,90 y primera vez 0,60
- **Assert**: `resumen.memorizando === true`
- **Prioridad**: 2

#### Test 2.8
- **Nombre**: `dada_una_pregunta_vista_tres_veces_y_nunca_acertada_cuando_busco_las_rebeldes_entonces_aparece_en_la_lista()`
- **Assert**: está en `rebeldes`; una pregunta con un solo acierto no está
- **Prioridad**: 2

#### Test 2.9
- **Nombre**: `dado_un_historial_con_preguntas_que_ya_no_existen_en_el_banco_cuando_calculo_entonces_las_ignora_sin_lanzar()`
- **Arrange**: entrada con `res: {"9999":"o"}`
- **Assert**: no lanza, `9999` no suma a ningún tema, y la entrada **sigue** en el historial
- **Prioridad**: 1 · **Invariante 5 del modelo**

#### Test 2.10
- **Nombre**: `dados_tres_intentos_recientes_mejores_que_los_tres_anteriores_cuando_calculo_la_tendencia_entonces_devuelve_sube()`
- **Assert**: `'sube'`; con diferencia menor a 5 puntos, `'estable'`
- **Prioridad**: 2

#### Test 2.11
- **Nombre**: `dado_un_historial_con_menos_de_cuatro_intentos_cuando_calculo_la_tendencia_entonces_devuelve_sin_datos()`
- **Prioridad**: 2

#### Test 2.12
- **Nombre**: `dado_un_historial_ponderado_cuando_leo_el_conteo_crudo_entonces_no_esta_ponderado()`
- **Arrange**: historial donde dominio ponderado ≠ `okCrudo/nCrudo`
- **Assert**: `nCrudo` y `okCrudo` son enteros que coinciden con el recuento real; `dominio` difiere
- **Prioridad**: 1 · **Invariante 4 del modelo** — es el riesgo aceptado del spec, conviene fijarlo

#### Test 2.13
- **Nombre**: `dado_un_intento_con_preguntas_de_los_tres_tipos_cuando_agrego_por_tipo_entonces_separa_single_multi_y_fill()`
- **Prioridad**: 2

---

### Iteración 3 — Historial: validar, fusionar, recortar

#### Test 3.1
- **Nombre**: `dado_un_json_sin_campo_de_version_cuando_lo_valido_entonces_lo_rechaza_entero()`
- **Assert**: `{ok:false, error}` y el historial previo intacto
- **Prioridad**: 1

#### Test 3.2
- **Nombre**: `dado_un_archivo_con_una_entrada_corrupta_cuando_lo_valido_entonces_descarta_solo_esa_entrada()`
- **Assert**: `importados` cuenta las válidas, `ignorados` la corrupta, `ok:true`
- **Prioridad**: 1

#### Test 3.3
- **Nombre**: `dado_un_archivo_con_intentos_que_ya_existen_cuando_lo_fusiono_entonces_no_los_duplica()`
- **Assert**: los `cid` del resultado son únicos
- **Prioridad**: 1 · **Invariante 2**

#### Test 3.4
- **Nombre**: `dado_el_mismo_archivo_importado_dos_veces_cuando_comparo_el_historial_entonces_es_identico()`
- **Assert**: la segunda importación no cambia nada
- **Prioridad**: 1
- **Por qué importa**: es la propiedad que justificó eliminar la segunda clave de `localStorage`.

#### Test 3.5
- **Nombre**: `dado_un_archivo_con_sesenta_intentos_cuando_lo_fusiono_entonces_conserva_los_cincuenta_mas_recientes()`
- **Assert**: longitud 50, y el más antiguo descartado es el de `ts` menor
- **Prioridad**: 1 · **Invariante 6** y side-effect 🟡 nº 9 de `/impact`

#### Test 3.6
- **Nombre**: `dado_un_archivo_con_intentos_desordenados_cuando_lo_fusiono_entonces_quedan_en_orden_cronologico()`
- **Prioridad**: 2
- **Nota**: el orden importa porque el decaimiento se aplica por posición, no por fecha.

---

### Iteración 4 — Adaptadores y orquestación (con `store` falso)

El doble es un `store` en memoria que puede simular fallo de cuota. **No se mockea ninguna lógica
de negocio**, solo el almacenamiento del navegador.

#### Test 4.1
- **Nombre**: `dado_un_almacenamiento_que_rechaza_la_escritura_cuando_guardo_entonces_el_store_devuelve_falso()`
- **Arrange**: `store` cuyo `setItem` lanza `QuotaExceededError`
- **Assert**: `store.write(...) === false`, sin excepción propagada
- **Prioridad**: 1

#### Test 4.2
- **Nombre**: `dado_que_la_cola_no_pudo_escribirse_cuando_registro_un_intento_entonces_no_informa_de_que_quedo_encolado()`
- **Arrange**: `store` en fallo de cuota, red caída
- **Act**: `recordAttempt(payload)`
- **Assert**: `{ok:false, encolado:false}` — **nunca** `encolado:true`
- **Prioridad**: 1
- **Por qué importa**: es el side-effect 🔴 nº 1 de `/impact`. Hoy la UI dice "queda en cola" con la
  cola vacía y el intento se pierde sin rastro.

#### Test 4.3
- **Nombre**: `dado_un_intento_sin_finalizar_cuando_intento_registrarlo_entonces_no_entra_en_el_historial()`
- **Prioridad**: 1 · **Invariante 1 del modelo**

#### Test 4.4
- **Nombre**: `dado_un_intento_ya_registrado_cuando_lo_registro_otra_vez_entonces_el_historial_no_cambia()`
- **Prioridad**: 1 · **Invariante 2**

#### Test 4.5
- **Nombre**: `dado_un_historial_que_no_cabe_cuando_registro_un_intento_entonces_poda_los_antiguos_y_reintenta()`
- **Arrange**: `store` que falla la primera escritura y acepta la segunda
- **Assert**: el intento nuevo queda guardado y el historial es más corto
- **Prioridad**: 2

#### Test 4.6
- **Nombre**: `dado_un_intento_guardado_sin_cid_cuando_lo_reanudo_entonces_recibe_uno_nuevo()`
- **Arrange**: `STORE_KEY` con un `S` de la versión anterior, sin `cid`
- **Act**: `loadStored()`
- **Assert**: el objeto devuelto tiene un `cid` con forma de UUID
- **Prioridad**: 1 · side-effect 🟠 nº 3 de `/impact`, afecta a código ya desplegado

#### Test 4.7
- **Nombre**: `dado_un_borrado_de_estadisticas_cuando_reviso_las_demas_claves_entonces_siguen_intactas()`
- **Assert**: `STORE_KEY`, `LANG_KEY`, `NAME_KEY` y `QUEUE_KEY` conservan su valor
- **Prioridad**: 1 · **Invariante 7 del sistema**

#### Test 4.8
- **Nombre**: `dado_que_el_registro_del_historial_falla_cuando_termino_el_intento_entonces_el_envio_se_ejecuta_igual()`
- **Arrange**: `recordAttemptStats` que lanza
- **Act**: `onAttemptFinished(attempt)`
- **Assert**: `sendCurrentAttempt` fue invocado y no se propagó la excepción
- **Prioridad**: 1 · **Invariante 1 del sistema y 8 del modelo**

---

### Iteración 5 — Guardia arquitectónica (estático)

#### Test 5.1
- **Nombre**: `dado_el_nucleo_puro_del_html_cuando_lo_extraigo_entonces_no_contiene_document_localstorage_datenow_ni_fetch()`
- **Tipo**: estático sobre el archivo fuente
- **Act**: `extractCore()` sobre `lpi_practice_exam/index.html`
- **Assert**: la región entre marcadores no contiene ninguno de los cuatro identificadores
- **Prioridad**: 1
- **Por qué importa**: convierte la regla de dependencias de `/arch` en algo que se rompe solo.
  Detecta hoy la violación conocida de `buildAttemptPayload` leyendo `LANG_KEY`.

#### Test 5.2
- **Nombre**: `dado_un_intento_con_resultados_por_pregunta_cuando_construyo_el_payload_remoto_entonces_no_incluye_ninguna_clave_de_pregunta()`
- **Tipo**: unitario
- **Act**: `buildAttemptPayload(attempt, nombre, idioma)`
- **Assert**: las claves del payload son exactamente las 14 del contrato; ningún `id` de pregunta
  aparece en el JSON serializado
- **Prioridad**: 1 · **Invariante 7 del modelo y 3 del sistema**
- **Por qué importa**: la privacidad no se sostiene con una nota en el spec. Este test falla en
  cuanto alguien añada `res` al envío "para tener más datos".

---

## Tests de segunda prioridad

- `2.7` memorización, `2.8` rebeldes, `2.10`/`2.11` tendencia, `2.13` por tipo — son señales
  secundarias: útiles para el usuario, no imprescindibles para que la tabla ordene bien.
- `3.6` orden cronológico — el caso solo se da importando archivos manipulados a mano.
- `4.5` poda por cuota — con 78 KB medidos frente a 5 MB, el escenario es remoto; el test existe
  porque la cuota es compartida con el resto de proyectos del mismo origen.
- `1.5` vida media del factor de olvido — documenta una constante, no un comportamiento.

## Tests excluidos y motivo

| Test candidato | Motivo de exclusión |
|---|---|
| Renderizado de la tabla y del semáforo | Corresponde a `/tdd-plan-ui` |
| Transiciones de la pantalla (6 estados, 7 transiciones) | Corresponde a `/tdd-plan-ui` |
| Descarga real del archivo exportado | Depende de `Blob` y del navegador; se prueba la construcción del contenido, no la descarga |
| Dos pestañas escribiendo a la vez | Fuera de scope del spec; no reproducible con `node --test` |
| Cuota real de `localStorage` | Punto ciego declarado en `/impact`: depende del navegador y del origen compartido |
| Purga de `localStorage` por ITP en Safari | No reproducible en pruebas automáticas |
| Rendimiento de `computeStats` | Medido en `/impact` (14,5 ms → 2,8 ms); un umbral en test sería frágil entre máquinas |

---

## Próximo paso

`/why` — documentar el motivo de cada cambio antes de commitear.
