-- 1. Birthday becomes a locked identity attribute after registration.
CREATE OR REPLACE FUNCTION public.set_my_birthday(_dob date)
RETURNS TABLE(cohort text, member_age int, status text, review_required boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid(); _age int; _existing date;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: sign in before saving a date of birth.';
  END IF;
  IF _dob IS NULL THEN
    RAISE EXCEPTION 'DOB_REQUIRED: enter your date of birth.';
  END IF;
  IF _dob > current_date THEN
    RAISE EXCEPTION 'DOB_IN_FUTURE: enter a date of birth in the past.';
  END IF;
  _age := public.calculate_age(_dob);
  IF _age IS NULL OR _age > 120 THEN
    RAISE EXCEPTION 'DOB_INVALID: enter a valid date of birth.';
  END IF;

  SELECT birthday INTO _existing FROM public.profile_birthdays WHERE user_id = _uid;
  IF _existing IS NOT NULL AND _existing <> _dob THEN
    RAISE EXCEPTION 'BIRTHDAY_LOCKED: your date of birth cannot be changed after registration. Request a birthday correction instead.';
  END IF;

  INSERT INTO public.profile_birthdays (user_id, birthday)
  VALUES (_uid, _dob)
  ON CONFLICT (user_id) DO UPDATE SET birthday = EXCLUDED.birthday, updated_at = now();

  RETURN QUERY
    SELECT p.age_cohort, _age, public.platform_status(p.id), p.age_review_required
    FROM public.profiles p WHERE p.id = _uid;
END $$;

REVOKE ALL ON FUNCTION public.set_my_birthday(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_my_birthday(date) TO authenticated;

-- 2. Correction requests
CREATE TABLE public.birthday_correction_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  current_birthday date,
  requested_birthday date NOT NULL,
  reason text NOT NULL,
  evidence text,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT birthday_correction_status_chk CHECK (status IN ('pending','approved','rejected'))
);

GRANT SELECT, INSERT ON public.birthday_correction_requests TO authenticated;
GRANT ALL ON public.birthday_correction_requests TO service_role;
ALTER TABLE public.birthday_correction_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read own birthday corrections"
ON public.birthday_correction_requests FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.is_superadmin(auth.uid()));

CREATE POLICY "Members request own birthday correction"
ON public.birthday_correction_requests FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND status = 'pending');

CREATE INDEX birthday_correction_requests_user_idx
  ON public.birthday_correction_requests (user_id, created_at DESC);
CREATE UNIQUE INDEX birthday_correction_one_pending
  ON public.birthday_correction_requests (user_id) WHERE status = 'pending';

CREATE TRIGGER birthday_correction_requests_touch
BEFORE UPDATE ON public.birthday_correction_requests
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3. Immutable audit trail
CREATE TABLE public.birthday_change_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  request_id uuid,
  previous_birthday date,
  requested_birthday date,
  approved_birthday date,
  requester_id uuid,
  reviewer_id uuid,
  outcome text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.birthday_change_audit TO authenticated;
GRANT ALL ON public.birthday_change_audit TO service_role;
ALTER TABLE public.birthday_change_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members and admins read birthday audit"
ON public.birthday_change_audit FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.is_superadmin(auth.uid()));

CREATE OR REPLACE FUNCTION public.birthday_audit_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'BIRTHDAY_AUDIT_IMMUTABLE: birthday history cannot be changed.';
END $$;

CREATE TRIGGER birthday_change_audit_immutable
BEFORE UPDATE OR DELETE ON public.birthday_change_audit
FOR EACH ROW EXECUTE FUNCTION public.birthday_audit_append_only();

-- 4. Member-facing request RPC
CREATE OR REPLACE FUNCTION public.request_birthday_correction(
  _requested date, _reason text, _evidence text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid(); _current date; _age int; _id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: sign in first.';
  END IF;
  IF _requested IS NULL OR _requested > current_date THEN
    RAISE EXCEPTION 'DOB_INVALID: enter a valid date of birth.';
  END IF;
  _age := public.calculate_age(_requested);
  IF _age IS NULL OR _age > 120 THEN
    RAISE EXCEPTION 'DOB_INVALID: enter a valid date of birth.';
  END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 10 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: explain why the date needs correcting.';
  END IF;

  SELECT birthday INTO _current FROM public.profile_birthdays WHERE user_id = _uid;
  IF _current IS NOT NULL AND _current = _requested THEN
    RAISE EXCEPTION 'DOB_UNCHANGED: that is already your date of birth on file.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.birthday_correction_requests
             WHERE user_id = _uid AND status = 'pending') THEN
    RAISE EXCEPTION 'REQUEST_PENDING: you already have a correction under review.';
  END IF;

  INSERT INTO public.birthday_correction_requests
    (user_id, current_birthday, requested_birthday, reason, evidence)
  VALUES (_uid, _current, _requested, btrim(_reason), NULLIF(btrim(COALESCE(_evidence,'')), ''))
  RETURNING id INTO _id;

  INSERT INTO public.birthday_change_audit
    (user_id, request_id, previous_birthday, requested_birthday, requester_id, outcome, reason)
  VALUES (_uid, _id, _current, _requested, _uid, 'requested', btrim(_reason));

  RETURN _id;
END $$;

REVOKE ALL ON FUNCTION public.request_birthday_correction(date, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_birthday_correction(date, text, text) TO authenticated;

-- 5. Admin review RPC (the only path that can change a locked birthday)
CREATE OR REPLACE FUNCTION public.review_birthday_correction(
  _id uuid, _approve boolean, _notes text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    INSERT INTO public.profile_birthdays (user_id, birthday)
    VALUES (_req.user_id, _req.requested_birthday)
    ON CONFLICT (user_id) DO UPDATE SET birthday = EXCLUDED.birthday, updated_at = now();

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
END $$;

REVOKE ALL ON FUNCTION public.review_birthday_correction(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_birthday_correction(uuid, boolean, text) TO authenticated;

-- 6. Support review queue (joined display data, admin only)
CREATE OR REPLACE FUNCTION public.list_birthday_corrections(_status text DEFAULT 'pending')
RETURNS TABLE(id uuid, user_id uuid, display_name text, handle text,
              current_birthday date, requested_birthday date, reason text, evidence text,
              status text, reviewed_at timestamptz, review_notes text, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(), 'admin') OR public.is_superadmin(auth.uid())) THEN
    RAISE EXCEPTION 'FORBIDDEN: admin access required.';
  END IF;
  RETURN QUERY
    SELECT r.id, r.user_id, p.name, p.username, r.current_birthday, r.requested_birthday,
           r.reason, r.evidence, r.status, r.reviewed_at, r.review_notes, r.created_at
      FROM public.birthday_correction_requests r
      LEFT JOIN public.profiles p ON p.id = r.user_id
     WHERE _status IS NULL OR r.status = _status
     ORDER BY r.created_at DESC
     LIMIT 200;
END $$;

REVOKE ALL ON FUNCTION public.list_birthday_corrections(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_birthday_corrections(text) TO authenticated;

-- 7. The member's own request list (self-service status)
CREATE OR REPLACE FUNCTION public.my_birthday_corrections()
RETURNS TABLE(id uuid, requested_birthday date, reason text, status text,
              review_notes text, created_at timestamptz, reviewed_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT r.id, r.requested_birthday, r.reason, r.status, r.review_notes, r.created_at, r.reviewed_at
    FROM public.birthday_correction_requests r
   WHERE r.user_id = auth.uid()
   ORDER BY r.created_at DESC
   LIMIT 20;
$$;

REVOKE ALL ON FUNCTION public.my_birthday_corrections() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_birthday_corrections() TO authenticated;