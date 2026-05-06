-- Очистка архивированных компаний для пользователя sydykovsam@gmail.com
-- Применить в Supabase SQL Editor (один раз).

-- Полностью удаляет аккаунты в архиве (deleted_at IS NOT NULL)
-- которые принадлежат пользователю sydykovsam@gmail.com (role = 'owner')

DO $$
DECLARE
  v_user_id uuid;
BEGIN
  -- Получаем user_id по email
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = 'sydykovsam@gmail.com'
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Сначала удаляем записи account_members для архивированных компаний
  DELETE FROM public.account_members am
  WHERE EXISTS (
    SELECT 1 FROM public.accounts a
    WHERE a.id = am.account_id
      AND a.deleted_at IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.account_members am2
        WHERE am2.account_id = a.id
          AND am2.user_id = v_user_id
          AND am2.role = 'owner'
      )
  );

  -- Затем удаляем сами архивированные компании
  DELETE FROM public.accounts a
  WHERE a.deleted_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.account_members am
      WHERE am.account_id = a.id
    );

  RAISE NOTICE 'Done. Archived accounts deleted for user %', v_user_id;
END;
$$;
