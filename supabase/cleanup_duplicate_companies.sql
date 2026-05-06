-- One-time cleanup: delete the 4 duplicate "Основная компания" accounts
-- created for sydykovsam@gmail.com due to auto-create race condition.
-- Only deletes accounts that have NO data (shipments, trips, stores, etc.)
-- Safe to run multiple times.

DO $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'sydykovsam@gmail.com';
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Delete account_members for empty "Основная компания" accounts owned by this user
  -- that have no trips, stores, or shipments
  DELETE FROM public.account_members am
  WHERE am.user_id = v_user_id
    AND am.role = 'owner'
    AND EXISTS (
      SELECT 1 FROM public.accounts a
      WHERE a.id = am.account_id
        AND a.name = 'Основная компания'
        AND a.deleted_at IS NULL
        -- no stores
        AND NOT EXISTS (SELECT 1 FROM public.stores s WHERE s.account_id = a.id)
        -- no trips
        AND NOT EXISTS (SELECT 1 FROM public.trips t WHERE t.account_id = a.id)
    );

  -- Delete the now-orphaned accounts
  DELETE FROM public.accounts a
  WHERE a.name = 'Основная компания'
    AND a.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.account_members am WHERE am.account_id = a.id
    );

  RAISE NOTICE 'Done. Duplicate empty companies removed for %', v_user_id;
END;
$$;
