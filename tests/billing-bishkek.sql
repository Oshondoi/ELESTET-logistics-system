begin;
do $$
declare a uuid;u uuid;result jsonb;q jsonb;
begin
 if (select timezone from public.calendar_billing_config where id)<>'Asia/Bishkek' then raise exception 'Calendar not configured'; end if;
 if ('2026-10-15 17:59:59+00'::timestamptz at time zone 'Asia/Bishkek')::date<>'2026-10-15'::date
  or ('2026-10-15 18:00:00+00'::timestamptz at time zone 'Asia/Bishkek')::date<>'2026-10-16'::date then raise exception 'Wrong business boundary'; end if;
 q:=public.quote_calendar_month(5000,('2026-10-31 17:59:59+00'::timestamptz at time zone 'Asia/Bishkek')::date,true);
 if q->>'startDate'<>'2026-11-01' or (q->>'amountSom')::integer<>5000 then raise exception 'Next month start/price broken'; end if;
 if (q->>'startDate')::date::timestamp at time zone 'Asia/Bishkek'<>'2026-10-31 18:00:00+00'::timestamptz then raise exception 'Period timezone broken'; end if;
 begin perform public.quote_calendar_month(5000,'2026-10-15',true);raise exception 'FAIL: early tomorrow allowed';exception when invalid_parameter_value then null;end;
 select id into u from auth.users where email_confirmed_at is not null limit 1;
 perform set_config('request.jwt.claim.sub',u::text,true);
 insert into public.accounts(name) values('Bishkek test rollback') returning id into a;
 insert into public.account_members(account_id,user_id,role) values(a,u,'owner');
 result:=public.get_company_checkout_state(a);
 if result->>'timezone'<>'Asia/Bishkek' or (result->>'server_now')::timestamptz<>now() then raise exception 'Server calendar missing'; end if;
 -- Approved calendar must not imply a payment enablement.
 update public.calendar_billing_config set checkout_enabled=false,provider_enabled=false where id;
 q:=public.quote_company_checkout(a,'seller');
 if (q->>'available')::boolean or q->>'reason'<>'Оплата пока не включена' then raise exception 'Disabled checkout unexpectedly available'; end if;
 if (q->>'purchase_date')::date<>(now() at time zone 'Asia/Bishkek')::date then raise exception 'Quote not using business date'; end if;
end $$;
rollback;
