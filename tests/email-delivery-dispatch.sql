-- Run after both email migrations inside an outer transaction, then ROLLBACK.
do $$
declare
  v_email text := gen_random_uuid()::text||'@example.invalid';
  v_id uuid := gen_random_uuid();
  v_first jsonb;
  v_dispatch jsonb;
  v_event text := encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');
  v_other text := encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');
begin
  perform set_config('request.jwt.claim.role','service_role',true);
  v_first := public.reserve_email_delivery_number(v_email,v_id,'invite');
  v_dispatch := public.prepare_email_dispatch(v_email,v_event,'signup',v_first->>'number',v_first->>'requested_at');
  if v_dispatch->>'number' <> '1' then raise exception 'reservation mismatch'; end if;
  if public.prepare_email_dispatch(upper(v_email),v_event,'signup') <> v_dispatch then raise exception 'retry mismatch'; end if;
  if (public.prepare_email_dispatch(v_email,v_other,'signup',v_first->>'number',v_first->>'requested_at'))->>'number' <> '2' then
    raise exception 'reservation reused by different event';
  end if;
  perform public.complete_email_dispatch(v_event,'test-provider-id');
  if (public.prepare_email_dispatch(v_email,v_event,'signup')->>'sent')::boolean is not true then raise exception 'completion missing'; end if;
  begin
    perform public.prepare_email_dispatch('other-'||v_email,v_event,'signup');
    raise exception 'recipient conflict accepted';
  exception when invalid_parameter_value then null; end;
  update public.email_delivery_dispatches set created_at=clock_timestamp()-interval '25 hours' where event_key=v_other;
  begin
    perform public.prepare_email_dispatch(v_email,v_other,'signup');
    raise exception 'late resend accepted';
  exception when invalid_parameter_value then null; end;
  perform set_config('request.jwt.claim.role','anon',true);
  begin
    perform public.prepare_email_dispatch(v_email,v_event,'signup');
    raise exception 'public dispatch accepted';
  exception when insufficient_privilege then null; end;
  if has_function_privilege('authenticated','public.prepare_email_dispatch(text,text,text,text,text)','EXECUTE') then raise exception 'dispatch grants exposed'; end if;
end $$;
