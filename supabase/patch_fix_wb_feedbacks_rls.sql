-- Исправление RLS-политики wb_feedbacks
-- Причина: ошибочно использовалась несуществующая таблица role_members
-- вместо account_members. Из-за этого все SELECT/INSERT/DELETE блокировались.
-- Результат: данные никогда не сохранялись в БД → юзер каждый раз видел пустой экран
-- и был вынужден нажимать "Синхронизировать" → срабатывал rate limit WB API.

DROP POLICY IF EXISTS "Members can manage their account feedbacks" ON wb_feedbacks;

CREATE POLICY "Members can manage their account feedbacks"
  ON wb_feedbacks
  FOR ALL
  USING (
    account_id IN (
      SELECT account_id FROM account_members WHERE user_id = auth.uid()
    )
  );
