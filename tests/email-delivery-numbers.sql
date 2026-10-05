-- Execute together with the migration, replacing its final COMMIT with this test + ROLLBACK.
do $$
declare
  v_id uuid := gen_random_uuid();
  v_email text := gen_random_uuid()::text || '@example.invalid';
  v_first jsonb;
  v_next jsonb;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  v_first := public.reserve_email_delivery_number(v_email, v_id, 'recovery');
  if v_first->>'number' <> '1' then raise exception 'first number'; end if;
  if public.reserve_email_delivery_number(upper(v_email), v_id, 'recovery') <> v_first then raise exception 'idempotency/normalization'; end if;
  v_next := public.reserve_email_delivery_number(v_email, gen_random_uuid(), 'signup');
  if v_next->>'number' <> '2' then raise exception 'shared purpose sequence'; end if;
  v_next := public.reserve_email_delivery_number(v_email, gen_random_uuid(), 'notification');
  if v_next->>'number' <> '3' then raise exception 'notification sequence'; end if;
  if exists(select 1 from auth.users where email = v_email) then raise exception 'unexpected auth account'; end if;
  begin
    perform public.reserve_email_delivery_number('other-' || v_email, v_id, 'recovery');
    raise exception 'conflicting request accepted';
  exception when invalid_parameter_value then null;
  end;
  perform set_config('request.jwt.claim.role', 'anon', true);
  begin
    perform public.reserve_email_delivery_number(v_email, gen_random_uuid(), 'recovery');
    raise exception 'cooldown missing';
  exception when raise_exception then
    if sqlerrm not like 'Подождите%' then raise; end if;
  end;
  begin
    perform public.reserve_email_delivery_number(v_email, gen_random_uuid(), 'campaign');
    raise exception 'anonymous campaign allowed';
  exception when insufficient_privilege then null;
  end;
  if has_table_privilege('anon','public.email_delivery_counters','SELECT') or
     has_table_privilege('authenticated','public.email_delivery_requests','SELECT') then
    raise exception 'private counters exposed';
  end if;
end $$;
