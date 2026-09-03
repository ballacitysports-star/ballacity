-- 1. Remove the member-facing delete path on the authoritative birthday store.
DROP POLICY IF EXISTS "Own birthday delete" ON public.profile_birthdays;
REVOKE DELETE, UPDATE, INSERT ON public.profile_birthdays FROM authenticated;
REVOKE DELETE, UPDATE, INSERT, SELECT ON public.profile_birthdays FROM anon;
GRANT SELECT ON public.profile_birthdays TO authenticated;
GRANT ALL ON public.profile_birthdays TO service_role;

-- 2. Trigger backstop: no delete, and no birthday change outside the review RPC.
CREATE OR REPLACE FUNCTION public.guard_birthday_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF current_setting('openrun.birthday_review', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'BIRTHDAY_LOCKED: a stored date of birth cannot be removed. Request a birthday correction instead.';
  END IF;
  IF NEW.birthday IS DISTINCT FROM OLD.birthday THEN
    RAISE EXCEPTION 'BIRTHDAY_LOCKED: your date of birth cannot be changed after registration. Request a birthday correction instead.';
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.guard_birthday_immutability() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_birthday_immutability ON public.profile_birthdays;
CREATE TRIGGER trg_guard_birthday_immutability
BEFORE UPDATE OR DELETE ON public.profile_birthdays
FOR EACH ROW EXECUTE FUNCTION public.guard_birthday_immutability();

-- 3. Correction requests only through the audited RPC.
DROP POLICY IF EXISTS "Members request own birthday correction" ON public.birthday_correction_requests;
REVOKE INSERT, UPDATE, DELETE ON public.birthday_correction_requests FROM authenticated, anon;

-- 4. Approval path sets the guard flag so approved corrections still apply.
CREATE OR REPLACE FUNCTION public.review_birthday_correction(_id uuid, _approve boolean, _notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _req public.birthday_correction_requests;
        _from text; _to text;
BEGIN
  IF _uid IS NULL OR NOT (public.has_role(_uid, 'admin') OR public.is_superadmin(_uid)) THEN
    RAISE EXCEPTION 'FORBIDDEN: only support staff can review birthday corrections.';
  END IF;

  SELECT * INTO _req FROM public.birthday_correction_requests WHERE id = _id;
  IF _req.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: that correction request no longer exists.';
  END IF;
  IF _req.status <> 'pending' THEN
    RAISE EXCEPTION 'ALREADY_REVIEWED: that request was already decided.';
  END IF;

  SELECT age_cohort INTO _from FROM public.profiles WHERE id = _req.user_id;

  UPDATE public.birthday_correction_requests
     SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
         reviewed_by = _uid, reviewed_at = now(), review_notes = NULLIF(btrim(COALESCE(_notes,'')), '')
   WHERE id = _id;

  IF _approve THEN
    PERFORM set_config('openrun.birthday_review', 'on', true);
    INSERT INTO public.profile_birthdays (user_id, birthday)
    VALUES (_req.user_id, _req.requested_birthday)
    ON CONFLICT (user_id) DO UPDATE SET birthday = EXCLUDED.birthday, updated_at = now();
    PERFORM set_config('openrun.birthday_review', 'off', true);

    SELECT age_cohort INTO _to FROM public.profiles WHERE id = _req.user_id;

    INSERT INTO public.age_change_events (user_id, from_cohort, to_cohort, outcome, actor_id)
    VALUES (_req.user_id, COALESCE(_from,'unknown'), COALESCE(_to,'unknown'), 'birthday_correction', _uid);
  END IF;

  INSERT INTO public.birthday_change_audit
    (user_id, request_id, previous_birthday, requested_birthday, approved_birthday,
     requester_id, reviewer_id, outcome, reason)
  VALUES (_req.user_id, _req.id, _req.current_birthday, _req.requested_birthday,
          CASE WHEN _approve THEN _req.requested_birthday END,
          _req.user_id, _uid, CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
          NULLIF(btrim(COALESCE(_notes,'')), ''));

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_req.user_id, 'age_review',
          CASE WHEN _approve THEN 'Birthday correction approved' ELSE 'Birthday correction declined' END,
          CASE WHEN _approve THEN 'Your date of birth was updated and your age settings were refreshed.'
               ELSE 'We could not verify that correction. Contact support for help.' END,
          '/settings');
END $function$;