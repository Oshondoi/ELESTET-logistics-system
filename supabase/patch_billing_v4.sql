-- ============================================================
-- BILLING v4:
--   Добавить owner_short_id (U1, U2...) из таблицы profiles
-- ============================================================

DROP FUNCTION IF EXISTS admin_get_billing_overview();

CREATE FUNCTION admin_get_billing_overview()
RETURNS TABLE (
  id              uuid,
  short_id        integer,
  name            text,
  plan            text,
  plan_until      timestamptz,
  trial_ends_at   timestamptz,
  grace_until     timestamptz,
  plan_features   jsonb,
  created_at      timestamptz,
  owner_user_id   uuid,
  owner_email     text,
  owner_short_id  integer
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    a.short_id,
    a.name,
    a.plan,
    a.plan_until,
    a.trial_ends_at,
    a.grace_until,
    a.plan_features,
    a.created_at,
    am.user_id                    AS owner_user_id,
    u.email::text                 AS owner_email,
    p.short_id                    AS owner_short_id
  FROM accounts a
  LEFT JOIN account_members am
    ON am.account_id = a.id AND am.role = 'owner'
  LEFT JOIN auth.users u
    ON u.id = am.user_id
  LEFT JOIN profiles p
    ON p.user_id = am.user_id
  ORDER BY a.created_at DESC;
END;
$$;
