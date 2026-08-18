-- Registro de intentos del examen LPI 010-160.
-- Spec: docs/specs/registro-intentos-supabase.spec.md
--
-- Modelo de seguridad:
--   * La tabla vive en el esquema `telemetry`, que NO figura en la lista de
--     esquemas expuestos de la API (supabase/config.toml -> [api].schemas).
--     PostgREST no puede verla: una anon key filtrada no alcanza los datos.
--   * El único punto de escritura es public.record_exam_attempt(), SECURITY
--     DEFINER, con EXECUTE revocado a PUBLIC y concedido solo a service_role.
--   * RLS activo en la tabla como segunda barrera, por si algún día alguien
--     expone el esquema por error.

create schema if not exists telemetry;

revoke all on schema telemetry from public;
revoke all on schema telemetry from anon, authenticated;

-- ---------------------------------------------------------------- tabla ----

create table telemetry.exam_attempts (
  id                 bigint generated always as identity primary key,
  created_at         timestamptz not null default now(),

  -- identidad
  usuario_nombre     text        not null,
  usuario_key        text        not null,          -- nombre normalizado (agrupación)
  intento_num        integer     not null,          -- 1,2,3... por usuario_key

  -- versión del examen
  modo               text        not null,
  total_preguntas    smallint    not null,
  limite_minutos     smallint,                      -- 60 en simulacro, NULL en completo

  -- resultado
  correctas          smallint    not null,
  incorrectas        smallint    not null,
  sin_responder      smallint    not null,
  porcentaje         numeric(5,2) not null,
  puntuacion_escala  smallint    not null,          -- equivalencia aproximada 200-800
  aprobado           boolean     not null,
  duracion_segundos  integer     not null,
  desglose_temas     jsonb       not null default '{}'::jsonb,

  -- contexto
  ip                 inet,                          -- NULL si la cabecera no llegó o no parsea
  user_agent         text,
  idioma             text        not null default 'both',
  app_version        text        not null,
  client_attempt_id  uuid        not null,

  constraint exam_attempts_nombre_ck
    check (length(btrim(usuario_nombre)) between 2 and 80),
  constraint exam_attempts_key_ck
    check (usuario_key = btrim(usuario_key) and length(usuario_key) between 2 and 80),
  constraint exam_attempts_intento_ck    check (intento_num > 0),
  constraint exam_attempts_modo_ck       check (modo in ('simulacro_60min','completo')),
  constraint exam_attempts_idioma_ck     check (idioma in ('both','es','en')),
  constraint exam_attempts_total_ck      check (total_preguntas between 1 and 500),
  constraint exam_attempts_conteos_ck
    check (correctas >= 0 and incorrectas >= 0 and sin_responder >= 0
           and correctas + incorrectas + sin_responder = total_preguntas),
  constraint exam_attempts_pct_ck        check (porcentaje between 0 and 100),
  constraint exam_attempts_escala_ck     check (puntuacion_escala between 200 and 800),
  constraint exam_attempts_aprobado_ck   check (aprobado = (porcentaje >= 65)),
  constraint exam_attempts_duracion_ck   check (duracion_segundos >= 0),
  constraint exam_attempts_limite_ck
    check ((modo = 'simulacro_60min' and limite_minutos = 60)
        or (modo = 'completo'        and limite_minutos is null)),
  constraint exam_attempts_duracion_limite_ck
    check (limite_minutos is null or duracion_segundos <= limite_minutos * 60),
  constraint exam_attempts_desglose_ck   check (jsonb_typeof(desglose_temas) = 'object'),

  constraint exam_attempts_usuario_intento_uk unique (usuario_key, intento_num),
  constraint exam_attempts_client_uk          unique (client_attempt_id)
);

comment on table telemetry.exam_attempts is
  'Un intento finalizado del examen LPI 010-160. Solo agregados: nunca la respuesta a cada pregunta.';
comment on column telemetry.exam_attempts.ip is
  'IP tomada de las cabeceras de la petición por la Edge Function. Dato personal: ver política de retención.';

create index exam_attempts_usuario_idx on telemetry.exam_attempts (usuario_key, intento_num desc);
create index exam_attempts_created_idx on telemetry.exam_attempts (created_at desc);
create index exam_attempts_modo_idx    on telemetry.exam_attempts (modo, created_at desc);
-- Sostiene el count(*) del rate limit por IP de la última hora.
create index exam_attempts_ip_idx      on telemetry.exam_attempts (ip, created_at desc);

-- Segunda barrera: aunque el esquema se expusiera, no hay políticas.
alter table telemetry.exam_attempts enable row level security;

-- -------------------------------------------------- numeración de intento ----

create or replace function telemetry.exam_attempts_set_intento()
returns trigger
language plpgsql
security definer
set search_path = telemetry, pg_temp
as $$
begin
  -- Serializa por usuario para que dos intentos simultáneos no reciban el mismo número.
  perform pg_advisory_xact_lock(hashtext(new.usuario_key));
  select coalesce(max(intento_num), 0) + 1
    into new.intento_num
    from telemetry.exam_attempts
   where usuario_key = new.usuario_key;
  return new;
end;
$$;

create trigger exam_attempts_set_intento_trg
before insert on telemetry.exam_attempts
for each row execute function telemetry.exam_attempts_set_intento();

-- ------------------------------------------- único punto de escritura ----

-- Inserta un intento y resuelve la idempotencia en una sola ida y vuelta.
-- Deriva en el servidor: porcentaje redondeado, aprobado, ip.
create or replace function public.record_exam_attempt(
  p_client_attempt_id uuid,
  p_usuario_nombre    text,
  p_usuario_key       text,
  p_modo              text,
  p_total_preguntas   smallint,
  p_limite_minutos    smallint,
  p_correctas         smallint,
  p_incorrectas       smallint,
  p_sin_responder     smallint,
  p_porcentaje        numeric,
  p_puntuacion_escala smallint,
  p_duracion_segundos integer,
  p_desglose_temas    jsonb,
  p_idioma            text,
  p_app_version       text,
  p_ip                text,
  p_user_agent        text
)
returns table (id bigint, intento_num integer, duplicado boolean)
language plpgsql
security definer
set search_path = telemetry, pg_temp
as $$
declare
  v_pct numeric(5,2) := round(p_porcentaje, 2);
  v_ip  inet;
  v_id  bigint;
  v_num integer;
begin
  -- El literal de IP nunca debe tumbar el insert: si no parsea, se guarda NULL.
  begin
    v_ip := nullif(btrim(coalesce(p_ip, '')), '')::inet;
  exception when others then
    v_ip := null;
  end;

  insert into telemetry.exam_attempts (
    usuario_nombre, usuario_key, intento_num,
    modo, total_preguntas, limite_minutos,
    correctas, incorrectas, sin_responder,
    porcentaje, puntuacion_escala, aprobado, duracion_segundos, desglose_temas,
    ip, user_agent, idioma, app_version, client_attempt_id
  ) values (
    btrim(p_usuario_nombre), p_usuario_key, 0,   -- intento_num lo fija el trigger
    p_modo, p_total_preguntas, p_limite_minutos,
    p_correctas, p_incorrectas, p_sin_responder,
    v_pct, p_puntuacion_escala, (v_pct >= 65), p_duracion_segundos,
    coalesce(p_desglose_temas, '{}'::jsonb),
    v_ip, left(coalesce(p_user_agent, ''), 300), coalesce(p_idioma, 'both'), p_app_version,
    p_client_attempt_id
  )
  on conflict on constraint exam_attempts_client_uk do nothing
  returning exam_attempts.id, exam_attempts.intento_num into v_id, v_num;

  if v_id is not null then
    return query select v_id, v_num, false;
    return;
  end if;

  -- Mismo client_attempt_id: se devuelve la fila que ya existe.
  return query
    select a.id, a.intento_num, true
      from telemetry.exam_attempts a
     where a.client_attempt_id = p_client_attempt_id;
end;
$$;

comment on function public.record_exam_attempt is
  'Único camino de escritura a telemetry.exam_attempts. Idempotente por client_attempt_id.';

-- La anon key publicada en el HTML no puede ejecutarla: 403 en PostgREST.
revoke all on function public.record_exam_attempt(
  uuid, text, text, text, smallint, smallint, smallint, smallint, smallint,
  numeric, smallint, integer, jsonb, text, text, text, text
) from public, anon, authenticated;

grant usage on schema telemetry to service_role;
grant execute on function public.record_exam_attempt(
  uuid, text, text, text, smallint, smallint, smallint, smallint, smallint,
  numeric, smallint, integer, jsonb, text, text, text, text
) to service_role;
