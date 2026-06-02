-- ============================================================
-- PAYMENT ORDERS
-- Таблица для хранения платёжных заказов + RPC для работы с ними
-- ============================================================

-- Таблица payment_orders
CREATE TABLE IF NOT EXISTS public.payment_orders (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id              uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id                 uuid NOT NULL,
  plan                    text NOT NULL CHECK (plan IN ('seller', 'operational')),
  months                  int NOT NULL CHECK (months >= 1 AND months <= 12),
  amount_som              numeric(10,2) NOT NULL,
  discount_pct            int NOT NULL DEFAULT 0,
  status                  text NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'paid', 'failed', 'expired', 'cancelled')),
  provider                text NOT NULL DEFAULT 'mbusiness',
  provider_order_id       text,         -- ID присвоенный MBusiness
  provider_transaction_id text,         -- ID транзакции от MBusiness
  payment_url             text,         -- Ссылка на страницу оплаты MBusiness
  webhook_payload         jsonb,        -- Сырой payload webhook для аудита
  created_at              timestamptz   NOT NULL DEFAULT now(),
  paid_at                 timestamptz,
  expires_at              timestamptz   NOT NULL DEFAULT now() + interval '1 hour'
);

-- RLS
ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;

-- Пользователь видит только свои заказы
CREATE POLICY "Users read own payment orders"
  ON public.payment_orders FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Администраторы видят все
CREATE POLICY "Admins read all payment orders"
  ON public.payment_orders FOR SELECT
  TO authenticated
  USING (is_platform_admin());

-- Индексы
CREATE INDEX IF NOT EXISTS payment_orders_account_id_idx ON public.payment_orders(account_id);
CREATE INDEX IF NOT EXISTS payment_orders_user_id_idx ON public.payment_orders(user_id);
CREATE INDEX IF NOT EXISTS payment_orders_status_idx ON public.payment_orders(status);

-- ──────────────────────────────────────────────────────────────
-- RPC: create_payment_order
-- Вызывается Edge Function (service role) — создаёт заказ в ожидании оплаты
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_payment_order(
  p_account_id  uuid,
  p_user_id     uuid,
  p_plan        text,
  p_months      int,
  p_amount_som  numeric,
  p_discount_pct int DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO payment_orders (account_id, user_id, plan, months, amount_som, discount_pct)
  VALUES (p_account_id, p_user_id, p_plan, p_months, p_amount_som, p_discount_pct)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- RPC: activate_plan_by_payment
-- Вызывается Edge Function после успешного webhook от MBusiness
-- Идемпотентен: повторный вызов с paid order_id → без изменений
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.activate_plan_by_payment(
  p_order_id                uuid,
  p_provider_order_id       text,
  p_provider_transaction_id text,
  p_webhook_payload         jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order      payment_orders;
  v_old_plan   text;
  v_plan_until timestamptz;
BEGIN
  -- Получаем и блокируем строку (FOR UPDATE — защита от race condition)
  SELECT * INTO v_order
  FROM payment_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment order not found: %', p_order_id;
  END IF;

  -- Идемпотентность: уже оплачен → ничего не делаем
  IF v_order.status = 'paid' THEN
    RETURN;
  END IF;

  IF v_order.status != 'pending' THEN
    RAISE EXCEPTION 'Order % has unexpected status: %', p_order_id, v_order.status;
  END IF;

  -- Текущий план (для истории)
  SELECT plan INTO v_old_plan FROM accounts WHERE id = v_order.account_id;

  -- Вычисляем plan_until: продлеваем от текущего конца подписки (если ещё активна), иначе от сейчас
  SELECT GREATEST(now(), COALESCE(plan_until, now())) + (v_order.months || ' months')::interval
  INTO v_plan_until
  FROM accounts
  WHERE id = v_order.account_id;

  -- Активируем план
  UPDATE accounts
  SET
    plan       = v_order.plan,
    plan_until = v_plan_until,
    grace_until = NULL
  WHERE id = v_order.account_id;

  -- Запись в историю
  INSERT INTO account_plan_history (account_id, event_type, old_plan, new_plan, new_plan_until, note)
  VALUES (
    v_order.account_id,
    'payment',
    v_old_plan,
    v_order.plan,
    v_plan_until,
    'Оплата ' || v_order.months || ' мес. Транзакция: ' || COALESCE(p_provider_transaction_id, '—')
  );

  -- Помечаем заказ оплаченным
  UPDATE payment_orders
  SET
    status                  = 'paid',
    paid_at                 = now(),
    provider_order_id       = p_provider_order_id,
    provider_transaction_id = p_provider_transaction_id,
    webhook_payload         = p_webhook_payload
  WHERE id = p_order_id;
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- RPC: get_payment_order_status
-- Проверка статуса заказа — для страницы результата оплаты
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_payment_order_status(p_order_id uuid)
RETURNS TABLE (
  status    text,
  plan      text,
  months    int,
  amount_som numeric,
  paid_at   timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Только владелец заказа или платформ-админ
  IF NOT EXISTS (
    SELECT 1 FROM payment_orders
    WHERE id = p_order_id
      AND (user_id = auth.uid() OR is_platform_admin())
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT po.status, po.plan, po.months, po.amount_som, po.paid_at
  FROM payment_orders po
  WHERE po.id = p_order_id;
END;
$$;
