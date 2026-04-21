-- Создаём sequence для коротких ID пользователей
create sequence if not exists public.profiles_short_id_seq start 1;

-- Добавляем колонку short_id
alter table public.profiles
  add column if not exists short_id integer unique;

-- Проставляем существующим профилям
update public.profiles
  set short_id = nextval('public.profiles_short_id_seq')
  where short_id is null;

-- Устанавливаем default для новых вставок
alter table public.profiles
  alter column short_id set default nextval('public.profiles_short_id_seq');

-- Обновляем resolve_account_user: возвращает short_id, поддерживает поиск по U{n}
create or replace function public.resolve_account_user(
  p_account_id uuid,
  p_email      text    default null,
  p_user_id    uuid    default null,
  p_short_id   integer default null
)
returns table(
  user_id    uuid,
  email      text,
  full_name  text,
  short_id   integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is not null then
    return query
      select au.id,
             au.email::text,
             coalesce(pr.full_name, ''),
             pr.short_id
      from   auth.users au
      left   join public.profiles pr on pr.user_id = au.id
      where  au.id = p_user_id
      limit  1;

  elsif p_short_id is not null then
    return query
      select au.id,
             au.email::text,
             coalesce(pr.full_name, ''),
             pr.short_id
      from   auth.users au
      join   public.profiles pr on pr.user_id = au.id
      where  pr.short_id = p_short_id
      limit  1;

  elsif p_email is not null then
    return query
      select au.id,
             au.email::text,
             coalesce(pr.full_name, ''),
             pr.short_id
      from   auth.users au
      left   join public.profiles pr on pr.user_id = au.id
      where  lower(au.email) = lower(p_email)
      limit  1;
  end if;
end;
$$;

grant execute on function public.resolve_account_user(uuid, text, uuid, integer) to authenticated;
