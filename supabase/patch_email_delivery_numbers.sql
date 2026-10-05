-- One sequence per normalized recipient, shared by all delivery purposes.
-- Allocating a number does NOT create an Auth user or send mail.
begin;
create table if not exists public.email_delivery_counters (
  recipient_hash text primary key,
  last_number bigint not null default 0 check (last_number >= 0),
  last_requested_at timestamptz
);
create table if not exists public.email_delivery_requests (
  request_id uuid primary key,
  recipient_hash text not null references public.email_delivery_counters(recipient_hash),
  number bigint not null,
  purpose text not null,
  requested_at timestamptz not null,
  unique (recipient_hash, number)
);
alter table public.email_delivery_counters enable row level security;
alter table public.email_delivery_requests enable row level security;
revoke all on public.email_delivery_counters, public.email_delivery_requests from public, anon, authenticated;

create or replace function public.reserve_email_delivery_number(p_email text, p_request_id uuid, p_purpose text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_email text := lower(btrim(p_email));
  v_hash text;
  v_request public.email_delivery_requests%rowtype;
  v_counter public.email_delivery_counters%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_request_id is null or v_email is null or length(v_email) > 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or p_purpose is null or p_purpose not in ('signup','recovery','invite','notification','campaign') then
    raise exception 'Invalid email request' using errcode = '22023';
  end if;
  if p_purpose in ('notification','campaign') and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Server delivery only' using errcode = '42501';
  end if;
  v_hash := encode(digest(v_email, 'sha256'), 'hex');
  -- Serialize the same id before recipient locks, including cross-recipient misuse.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 731));
  select * into v_request from public.email_delivery_requests where request_id = p_request_id;
  if found then
    if v_request.recipient_hash <> v_hash or v_request.purpose <> p_purpose then
      raise exception 'Request conflict' using errcode = '22023';
    end if;
    return jsonb_build_object('number', v_request.number::text, 'requested_at', to_char(v_request.requested_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  end if;
  insert into public.email_delivery_counters(recipient_hash) values (v_hash) on conflict do nothing;
  select * into v_counter from public.email_delivery_counters where recipient_hash = v_hash for update;
  -- Same cooldown for existing and unknown accounts; never query auth.users.
  if coalesce(auth.role(), '') <> 'service_role' and v_counter.last_requested_at > v_now - interval '60 seconds' then
    raise exception 'Подождите минуту перед повторной отправкой кода.' using errcode = 'P0001';
  end if;
  update public.email_delivery_counters set last_number = last_number + 1, last_requested_at = v_now
    where recipient_hash = v_hash returning * into v_counter;
  insert into public.email_delivery_requests values (p_request_id, v_hash, v_counter.last_number, p_purpose, v_now);
  return jsonb_build_object('number', v_counter.last_number::text, 'requested_at', to_char(v_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'));
end;
$$;
revoke all on function public.reserve_email_delivery_number(text,uuid,text) from public;
grant execute on function public.reserve_email_delivery_number(text,uuid,text) to anon, authenticated, service_role;
notify pgrst, 'reload schema';
commit;
