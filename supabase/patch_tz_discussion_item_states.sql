-- Цветовые состояния блоков и строк актуального обсуждения.
-- Предыдущий JSON-снимок автоматически входит в каждую сохранённую редакцию.

alter table public.tz_discussions
  add column if not exists item_states jsonb not null default '{}'::jsonb;

alter table public.tz_discussions
  drop constraint if exists tz_discussions_item_states_check;

alter table public.tz_discussions
  add constraint tz_discussions_item_states_check
  check (jsonb_typeof(item_states) = 'object');

alter table public.tz_discussion_revisions
  add column if not exists item_states jsonb not null default '{}'::jsonb;

alter table public.tz_discussion_revisions
  drop constraint if exists tz_discussion_revisions_item_states_check;

alter table public.tz_discussion_revisions
  add constraint tz_discussion_revisions_item_states_check
  check (jsonb_typeof(item_states) = 'object');

create or replace function public.archive_tz_discussion_revision()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if row(old.title, old.content, old.item_states, old.status, old.completed_at)
     is distinct from
     row(new.title, new.content, new.item_states, new.status, new.completed_at) then
    insert into public.tz_discussion_revisions (
      discussion_id,
      revision_no,
      title,
      content,
      item_states,
      status,
      completed_at,
      saved_by,
      saved_at
    ) values (
      old.id,
      old.revision_no,
      old.title,
      old.content,
      old.item_states,
      old.status,
      old.completed_at,
      auth.uid(),
      now()
    );
    new.revision_no := old.revision_no + 1;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
