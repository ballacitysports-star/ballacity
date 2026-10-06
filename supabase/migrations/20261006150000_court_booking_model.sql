-- Court booking model, part 2.
--
-- 1. trainer_orgs.booking_url: an external reservation link (CourtReserve,
--    Mindbody, the venue's own page). "Book court" opens it when set; with no
--    link, players send an in-app inquiry instead.
-- 2. org_court_inquiries: court area (full/half/turf/cage), a time slot
--    (morning/afternoon/evening) alongside an exact start time.

ALTER TABLE public.trainer_orgs ADD COLUMN IF NOT EXISTS booking_url text;

ALTER TABLE public.trainer_orgs DROP CONSTRAINT IF EXISTS trainer_orgs_booking_url_len;
ALTER TABLE public.trainer_orgs
  ADD CONSTRAINT trainer_orgs_booking_url_len
  CHECK (booking_url IS NULL OR char_length(booking_url) <= 300);

-- Anonymous visitors only have column-level SELECT on this table.
GRANT SELECT (booking_url) ON public.trainer_orgs TO anon;

-- Court / area replaces the old indoor/outdoor-only choice. The old values stay
-- valid so nothing already stored can break.
ALTER TABLE public.org_court_inquiries DROP CONSTRAINT IF EXISTS org_court_inquiries_court_type_check;
ALTER TABLE public.org_court_inquiries
  ADD CONSTRAINT org_court_inquiries_court_type_check
  CHECK (court_type IN ('any', 'full_court', 'half_court', 'turf', 'cage', 'indoor', 'outdoor'));

-- A request is either for a rough slot of the day or for an exact start time.
ALTER TABLE public.org_court_inquiries
  ADD COLUMN IF NOT EXISTS time_slot text NOT NULL DEFAULT 'custom';
ALTER TABLE public.org_court_inquiries DROP CONSTRAINT IF EXISTS org_court_inquiries_time_slot_check;
ALTER TABLE public.org_court_inquiries
  ADD CONSTRAINT org_court_inquiries_time_slot_check
  CHECK (time_slot IN ('morning', 'afternoon', 'evening', 'custom'));

ALTER TABLE public.org_court_inquiries ALTER COLUMN start_time DROP NOT NULL;
ALTER TABLE public.org_court_inquiries DROP CONSTRAINT IF EXISTS org_court_inquiries_slot_time_check;
ALTER TABLE public.org_court_inquiries
  ADD CONSTRAINT org_court_inquiries_slot_time_check
  CHECK ((time_slot = 'custom') = (start_time IS NOT NULL));
