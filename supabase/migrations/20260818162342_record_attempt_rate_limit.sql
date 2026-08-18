-- Rate limit por IP dentro del RPC.
--
-- Motivo: telemetry no está expuesto en la API, así que la Edge Function no
-- puede hacer el count(*) previo con .from(). Al moverlo dentro de la función
-- el límite se evalúa en la misma transacción que el insert, sin ventana de
-- carrera entre la comprobación y la escritura.
--
-- La firma gana una columna de salida, así que hay que soltar la anterior:
-- CREATE OR REPLACE no puede cambiar el tipo de retorno.

drop function if exists public.record_exam_attempt(
  uuid, text, text, text, smallint, smallint, smallint, smallint, smallint,
  numeric, smallint, integer, jsonb, text, text, text, text
);

create function public.record_exam_attempt(
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
returns table (id bigint, intento_num integer, duplicado boolean, rate_limited boolean)
language plpgsql
security definer
set search_path = telemetry, pg_temp
as $$
declare
  c_rate_limit_hora constant integer := 60;
  v_pct    numeric(5,2) := round(p_porcentaje, 2);
  v_ip     inet;
  v_recientes integer;
  v_id     bigint;
  v_num    integer;
begin
  -- El literal de IP nunca debe tumbar el insert: si no parsea, se guarda NULL.
  begin
    v_ip := nullif(btrim(coalesce(p_ip, '')), '')::inet;
  exception when others then
    v_ip := null;
  end;

  -- Idempotencia primero: un reintento legítimo del cliente no debe consumir cuota.
  select a.id, a.intento_num into v_id, v_num
    from telemetry.exam_attempts a
   where a.client_attempt_id = p_client_attempt_id;
  if v_id is not null then
    return query select v_id, v_num, true, false;
    return;
  end if;

  if v_ip is not null then
    select count(*) into v_recientes
      from telemetry.exam_attempts a
     where a.ip = v_ip
       and a.created_at > now() - interval '1 hour';
    if v_recientes >= c_rate_limit_hora then
      return query select null::bigint, null::integer, false, true;
      return;
    end if;
  end if;

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
    return query select v_id, v_num, false, false;
    return;
  end if;

  -- Carrera: otra petición insertó el mismo client_attempt_id entre el SELECT y el INSERT.
  return query
    select a.id, a.intento_num, true, false
      from telemetry.exam_attempts a
     where a.client_attempt_id = p_client_attempt_id;
end;
$$;

comment on function public.record_exam_attempt is
  'Único camino de escritura a telemetry.exam_attempts. Idempotente por client_attempt_id y con rate limit de 60 intentos/hora por IP.';

revoke all on function public.record_exam_attempt(
  uuid, text, text, text, smallint, smallint, smallint, smallint, smallint,
  numeric, smallint, integer, jsonb, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.record_exam_attempt(
  uuid, text, text, text, smallint, smallint, smallint, smallint, smallint,
  numeric, smallint, integer, jsonb, text, text, text, text
) to service_role;
