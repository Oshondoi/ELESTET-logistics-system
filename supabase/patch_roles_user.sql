-- Добавляем поле назначенного пользователя к роли (необязательное)
alter table public.roles
  add column if not exists assigned_user_id uuid references auth.users (id) on delete set null;

-- RPC: ищем пользователя по email ИЛИ user_id среди всех зарегистрированных
-- security definer — сервер имеет доступ к auth.users
create or replace function public.resolve_account_user(
  p_account_id uuid,
  p_email      text    default null,
  p_user_id    uuid    default null
)
returns table(
  user_id   uuid,
  email     text,
  full_name text
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
             coalesce(pr.full_name, '')
      from   auth.users au
      left   join public.profiles pr on pr.user_id = au.id
      where  au.id = p_user_id
      limit  1;

  elsif p_email is not null then
    return query
      select au.id,
             au.email::text,
             coalesce(pr.full_name, '')
      from   auth.users au
      left   join public.profiles pr on pr.user_id = au.id
      where  lower(au.email) = lower(p_email)
      limit  1;
  end if;
end;
$$;

-- Разрешаем участникам вызывать функцию
grant execute on function public.resolve_account_user(uuid, text, uuid) to authenticated;
