-- AcreMap: require the designated administrator to replace the initial password.
-- The existing application role is checked before changing the profile flag.
DO $$
DECLARE
  target_user_id uuid;
BEGIN
  SELECT u.id
    INTO target_user_id
  FROM neon_auth."user" AS u
  JOIN public.user_roles AS r ON r.user_id = u.id
  WHERE lower(u.email) = lower('innocentkoffi1@gmail.com')
    AND r.role::text = 'admin'
  LIMIT 1;

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'AcreMap administrator innocentkoffi1@gmail.com was not found with the admin application role';
  END IF;

  UPDATE public.profiles
     SET must_change_password = true,
         updated_at = now()
   WHERE id = target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AcreMap profile missing for administrator innocentkoffi1@gmail.com';
  END IF;
END
$$;
