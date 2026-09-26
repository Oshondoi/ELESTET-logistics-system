-- One-time controlled reset of the active discussion history.
-- The current title, content, agreement states and ordering become the new
-- initial revision. Archived technical/content revisions are intentionally
-- removed together with the old discussion object.

begin;

create temporary table active_discussion_reset_snapshot on commit drop as
select discussion_key, title, content, item_states, position
from public.tz_discussions
where status = 'active';

do $$
declare
  v_count integer;
  v_key text;
begin
  select count(*) into v_count from active_discussion_reset_snapshot;
  if v_count <> 1 then
    raise exception 'Ожидалось одно активное обсуждение, найдено: %', v_count;
  end if;
  select discussion_key into v_key from active_discussion_reset_snapshot;
  if v_key <> 'public-request-invite-auth-20260926' then
    raise exception 'Активное обсуждение изменилось, reset отменён: %', v_key;
  end if;
end;
$$;

delete from public.tz_discussion_revisions
where discussion_id in (
  select id from public.tz_discussions where status = 'active'
);

delete from public.tz_discussions
where status = 'active';

insert into public.tz_discussions (
  discussion_key,
  title,
  content,
  item_states,
  status,
  revision_no,
  position,
  completed_at,
  created_at,
  updated_at
)
select
  discussion_key,
  title,
  content,
  item_states,
  'active',
  1,
  position,
  null,
  now(),
  now()
from active_discussion_reset_snapshot;

commit;
