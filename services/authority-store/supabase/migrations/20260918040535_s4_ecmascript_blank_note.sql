-- Follow-up to the synthetic S4 create subset; no production selection.
-- Match ECMAScript TrimString: WhiteSpace plus LineTerminator (25 BMP code points).
-- Explicit btrim character membership is independent of database locale/POSIX classes.
-- Validate only: preserve the submitted note bytes and existing function grants.
-- https://tc39.es/ecma262/multipage/text-processing.html#sec-trimstring
begin;

create or replace function pennsync_private.s4_fields(p_fields jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare k text; item jsonb; n numeric; d date; vitals jsonb := '{}';
  required text[] := array['visit_date','visit_type','status','nurse_notes','raw_transcription',
    'vital_signs','compliance_score','draft_presence_score','homebound_status_verified',
    'skilled_intervention_documented','homebound_justification','documentation_source',
    'grounding_pending','compliance_issues','ai_tags','chart_findings','denial_findings',
    'sustained_trends','acknowledgment','rule_versions','diagnosis'];
begin
  if p_fields is null or jsonb_typeof(p_fields)<>'object' or octet_length(p_fields::text)>2400000
    or not p_fields ?& required or p_fields - required <> '{}'::jsonb then
    raise exception using errcode='22023',message='PENNSYNC_S4_UNSUPPORTED_FIELDS';
  end if;
  if p_fields->>'visit_type' is distinct from 'skilled_nursing'
    or p_fields->>'status' is distinct from 'completed'
    or p_fields->>'documentation_source' is distinct from 'smart_note'
    or p_fields->'grounding_pending' is distinct from 'false'::jsonb
    or p_fields->'diagnosis' is distinct from '""'::jsonb
    or p_fields->'acknowledgment' is distinct from 'null'::jsonb then
    raise exception using errcode='22023',message='PENNSYNC_S4_UNSUPPORTED_WORKFLOW';
  end if;
  foreach k in array array['compliance_issues','ai_tags','chart_findings','denial_findings','sustained_trends','rule_versions'] loop
    if p_fields->k is distinct from '[]'::jsonb then
      raise exception using errcode='22023',message='PENNSYNC_S4_UNSUPPORTED_FINDINGS';
    end if;
  end loop;
  foreach k in array array['nurse_notes','raw_transcription','homebound_justification'] loop
    if jsonb_typeof(p_fields->k)<>'string' or pennsync_private.s4_utf16_length(p_fields->>k) >
      (case when k='homebound_justification' then 20000 else 250000 end) then
      raise exception using errcode='22023',message='PENNSYNC_S4_INVALID_TEXT';
    end if;
  end loop;
  if btrim(p_fields->>'nurse_notes', U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') = '' then
    raise exception using errcode='22023',message='PENNSYNC_S4_NOTE_REQUIRED';
  end if;
  foreach k in array array['homebound_status_verified','skilled_intervention_documented'] loop
    if jsonb_typeof(p_fields->k)<>'boolean' then
      raise exception using errcode='22023',message='PENNSYNC_S4_INVALID_BOOLEAN';
    end if;
  end loop;
  foreach k in array array['compliance_score','draft_presence_score'] loop
    if jsonb_typeof(p_fields->k)<>'number' or (p_fields->>k)::numeric not between 0 and 100 then
      raise exception using errcode='22023',message='PENNSYNC_S4_INVALID_SCORE';
    end if;
  end loop;
  if jsonb_typeof(p_fields->'visit_date')<>'string' or p_fields->>'visit_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception using errcode='22023',message='PENNSYNC_S4_INVALID_DATE';
  end if;
  begin d := (p_fields->>'visit_date')::date;
  exception when datetime_field_overflow or invalid_datetime_format then
    raise exception using errcode='22023',message='PENNSYNC_S4_INVALID_DATE';
  end;
  if to_char(d,'YYYY-MM-DD')<>p_fields->>'visit_date' then
    raise exception using errcode='22023',message='PENNSYNC_S4_INVALID_DATE';
  end if;
  if jsonb_typeof(p_fields->'vital_signs')<>'object' then
    raise exception using errcode='22023',message='PENNSYNC_S4_INVALID_VITALS';
  end if;
  for k,item in select key,value from jsonb_each(p_fields->'vital_signs') loop
    if not k=any(array['temperature','blood_pressure_systolic','blood_pressure_diastolic','heart_rate',
      'respiratory_rate','oxygen_saturation','pain_level','weight']) then
      raise exception using errcode='22023',message='PENNSYNC_S4_INVALID_VITALS';
    end if;
    if item='null'::jsonb then continue; end if;
    if jsonb_typeof(item)<>'number' then
      raise exception using errcode='22023',message='PENNSYNC_S4_INVALID_VITALS';
    end if;
    n := item::text::numeric;
    if abs(n)>1000000 then raise exception using errcode='22023',message='PENNSYNC_S4_INVALID_VITALS'; end if;
    vitals := vitals || jsonb_build_object(k,item);
  end loop;
  return jsonb_set(p_fields,'{vital_signs}',vitals);
end $$;

commit;
