-- patch_fix_wb_feedbacks_rls_v2.sql
-- Проблема: INSERT в wb_feedbacks блокируется RLS-ошибкой
--   "new row violates row-level security policy (USING expression)"
--
-- Причина: политика wb_feedbacks делает суб-запрос в account_members,
--   у которой ТОЖЕ включён RLS с рекурсивной политикой.
--   Postgres блокирует суб-запрос → account_id IN (...) = пустое множество → INSERT отклонён.
--
-- Решение: SECURITY DEFINER функция bypasses RLS на account_members.
-- Применить в Supabase SQL Editor.

-- 1. Функция-хелпер (выполняется с правами owner, не проверяет RLS на account_members)
CREATE OR REPLACE FUNCTION public.is_account_member(p_account_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM account_members
    WHERE account_id = p_account_id
      AND user_id = auth.uid()
  );
$$;

-- 2. Пересоздаём политику wb_feedbacks через эту функцию
DROP POLICY IF EXISTS "Members can manage their account feedbacks" ON wb_feedbacks;

CREATE POLICY "Members can manage their account feedbacks"
  ON wb_feedbacks
  FOR ALL
  USING  (public.is_account_member(account_id))
  WITH CHECK (public.is_account_member(account_id));
