-- In-app court inquiries: a signed-in player asks a facility about a court
-- (sport, date, time, length, party size, notes). Facility owners/admins read
-- and resolve them; requesters only see their own.

CREATE TABLE IF NOT EXISTS public.org_court_inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.trainer_orgs(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL,
  sport text NOT NULL CHECK (char_length(sport) BETWEEN 1 AND 40),
  court_type text NOT NULL DEFAULT 'any' CHECK (court_type IN ('any', 'indoor', 'outdoor')),
  requested_date date NOT NULL,
  start_time time NOT NULL,
  duration_min integer NOT NULL CHECK (duration_min BETWEEN 30 AND 480),
  player_count integer NOT NULL CHECK (player_count BETWEEN 1 AND 200),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'handled', 'declined')),
  handled_by uuid,
  handled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS org_court_inquiries_org_status_idx
  ON public.org_court_inquiries (org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS org_court_inquiries_requester_idx
  ON public.org_court_inquiries (requester_id, created_at DESC);

ALTER TABLE public.org_court_inquiries ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.org_court_inquiries TO authenticated;
-- Managers may only change the resolution fields, never the request itself.
GRANT UPDATE (status, handled_by, handled_at, updated_at) ON public.org_court_inquiries TO authenticated;
GRANT ALL ON public.org_court_inquiries TO service_role;

DROP POLICY IF EXISTS "Requesters and facility managers read inquiries" ON public.org_court_inquiries;
CREATE POLICY "Requesters and facility managers read inquiries"
  ON public.org_court_inquiries FOR SELECT TO authenticated
  USING (requester_id = auth.uid() OR public.is_trainer_org_admin(org_id, auth.uid()));

DROP POLICY IF EXISTS "Signed-in users create their own inquiries" ON public.org_court_inquiries;
CREATE POLICY "Signed-in users create their own inquiries"
  ON public.org_court_inquiries FOR INSERT TO authenticated
  WITH CHECK (requester_id = auth.uid() AND status = 'pending');

DROP POLICY IF EXISTS "Facility managers resolve inquiries" ON public.org_court_inquiries;
CREATE POLICY "Facility managers resolve inquiries"
  ON public.org_court_inquiries FOR UPDATE TO authenticated
  USING (public.is_trainer_org_admin(org_id, auth.uid()))
  WITH CHECK (public.is_trainer_org_admin(org_id, auth.uid()));

-- Guardrails enforced in the database so a direct API call can't skip them:
-- children never message facilities, and one account can't flood managers.
CREATE OR REPLACE FUNCTION public.guard_org_court_inquiry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.age_cohort_of(NEW.requester_id) = 'child_under_13' THEN
    RAISE EXCEPTION 'CHILD_CANNOT_INQUIRE: an adult needs to contact the facility for you.'
      USING ERRCODE = '42501';
  END IF;

  IF (SELECT count(*) FROM public.org_court_inquiries
        WHERE requester_id = NEW.requester_id
          AND created_at > now() - interval '24 hours') >= 10 THEN
    RAISE EXCEPTION 'INQUIRY_RATE_LIMIT: too many court inquiries today, try again tomorrow.'
      USING ERRCODE = '54000';
  END IF;

  IF (SELECT count(*) FROM public.org_court_inquiries
        WHERE requester_id = NEW.requester_id
          AND org_id = NEW.org_id
          AND status = 'pending') >= 3 THEN
    RAISE EXCEPTION 'INQUIRY_PENDING_LIMIT: you already have open inquiries with this facility.'
      USING ERRCODE = '54000';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_org_court_inquiry_trg ON public.org_court_inquiries;
CREATE TRIGGER guard_org_court_inquiry_trg
BEFORE INSERT ON public.org_court_inquiries
FOR EACH ROW EXECUTE FUNCTION public.guard_org_court_inquiry();

DROP TRIGGER IF EXISTS org_court_inquiries_touch_updated_at ON public.org_court_inquiries;
CREATE TRIGGER org_court_inquiries_touch_updated_at
BEFORE UPDATE ON public.org_court_inquiries
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
