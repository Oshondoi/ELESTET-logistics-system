-- Apply after patch_email_delivery_numbers.sql. Only trusted server senders may bind deliveries.
begin;
create table if not exists public.email_delivery_dispatches (
  event_key text primary key check (event_key ~ '^[a-f0-9]{64}$'),
  request_id uuid not null unique references public.email_delivery_requests(request_id),
  recipient_hash text not null,
  purpose text not null,
  created_at timestamptz not null default clock_timestamp(),
  provider_id text,
  sent_at timestamptz
);
alter table public.email_delivery_dispatches enable row level security;
revoke all on public.email_delivery_dispatches from public, anon, authenticated;

create or replace function public.prepare_email_dispatch(
  p_email text, p_event_key text, p_purpose text,
  p_number text default null, p_requested_at text default null
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions as $$
declare
  v_hash text := encode(digest(lower(btrim(p_email)), 'sha256'), 'hex');
  v_dispatch public.email_delivery_dispatches%rowtype;
  v_request public.email_delivery_requests%rowtype;
  v_id uuid;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Server only' using errcode='42501'; end if;
  if p_email is null or length(btrim(p_email))>254 or btrim(p_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_event_key is null or p_event_key !~ '^[a-f0-9]{64}$'
    or p_purpose is null or p_purpose not in ('signup','recovery','invite','notification','campaign') then
    raise exception 'Invalid dispatch' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_event_key, 732));
  select * into v_dispatch from public.email_delivery_dispatches where event_key=p_event_key;
  if found then
    if v_dispatch.recipient_hash <> v_hash or v_dispatch.purpose <> p_purpose then
      raise exception 'Dispatch conflict' using errcode='22023';
    end if;
    select * into strict v_request from public.email_delivery_requests where request_id=v_dispatch.request_id;
  else
    -- A browser-supplied number is not trusted. Match recipient, purpose and server timestamp.
    -- Lock the reservation: different Auth events may never reuse the same letter number.
    if p_number ~ '^[1-9][0-9]{0,18}$' then
      select * into v_request from public.email_delivery_requests r
      where r.recipient_hash=v_hash and r.number::text=p_number
        and to_char(r.requested_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')=p_requested_at
        and (r.purpose=p_purpose or (r.purpose='invite' and p_purpose='signup'))
        and r.requested_at > clock_timestamp()-interval '10 minutes'
      for update;
      if found and exists(select 1 from public.email_delivery_dispatches where request_id=v_request.request_id) then
        v_request := null;
      end if;
    end if;
    if v_request.request_id is null then
      v_id := gen_random_uuid();
      perform public.reserve_email_delivery_number(p_email,v_id,p_purpose);
      select * into strict v_request from public.email_delivery_requests where request_id=v_id;
    end if;
    insert into public.email_delivery_dispatches(event_key,request_id,recipient_hash,purpose)
      values(p_event_key,v_request.request_id,v_hash,p_purpose) returning * into v_dispatch;
  end if;
  -- Resend remembers idempotency keys for 24 hours. Never blindly resend after that window.
  if v_dispatch.sent_at is null and v_dispatch.created_at < clock_timestamp()-interval '20 hours' then
    raise exception 'Dispatch retry expired' using errcode='22023';
  end if;
  return jsonb_build_object('number',v_request.number::text,
    'requested_at',to_char(v_request.requested_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'sent',v_dispatch.sent_at is not null);
end;
$$;
create or replace function public.complete_email_dispatch(p_event_key text,p_provider_id text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Server only' using errcode='42501'; end if;
  if p_provider_id is null or length(p_provider_id) not between 1 and 200 then
    raise exception 'Invalid provider id' using errcode='22023';
  end if;
  update public.email_delivery_dispatches set provider_id=p_provider_id,sent_at=clock_timestamp()
    where event_key=p_event_key and sent_at is null;
end;
$$;
revoke all on function public.prepare_email_dispatch(text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.complete_email_dispatch(text,text) from public,anon,authenticated;
grant execute on function public.prepare_email_dispatch(text,text,text,text,text) to service_role;
grant execute on function public.complete_email_dispatch(text,text) to service_role;
notify pgrst,'reload schema';
commit;
