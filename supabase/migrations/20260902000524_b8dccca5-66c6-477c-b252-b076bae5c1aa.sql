-- 1) Move birthday out of the publicly-readable profiles row
CREATE TABLE IF NOT EXISTS public.profile_birthdays (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  birthday date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_birthdays TO authenticated;
GRANT ALL ON public.profile_birthdays TO service_role;

ALTER TABLE public.profile_birthdays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own birthday select" ON public.profile_birthdays;
CREATE POLICY "Own birthday select" ON public.profile_birthdays
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));

DROP POLICY IF EXISTS "Own birthday write" ON public.profile_birthdays;
CREATE POLICY "Own birthday write" ON public.profile_birthdays
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Own birthday update" ON public.profile_birthdays;
CREATE POLICY "Own birthday update" ON public.profile_birthdays
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Own birthday delete" ON public.profile_birthdays;
CREATE POLICY "Own birthday delete" ON public.profile_birthdays
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TRIGGER profile_birthdays_touch
  BEFORE UPDATE ON public.profile_birthdays
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Backfill from existing profiles
INSERT INTO public.profile_birthdays (user_id, birthday)
SELECT id, birthday FROM public.profiles WHERE birthday IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

-- Keep the private table in sync with writes that still target profiles.birthday,
-- then clear the public column so direct table reads cannot recover birthdates.
CREATE OR REPLACE FUNCTION public.sync_profile_birthday()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.birthday IS NOT NULL THEN
    INSERT INTO public.profile_birthdays (user_id, birthday)
    VALUES (NEW.id, NEW.birthday)
    ON CONFLICT (user_id) DO UPDATE SET birthday = EXCLUDED.birthday, updated_at = now();
    NEW.age_category := public.age_category_from_birthday(NEW.birthday);
    NEW.birthday := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_profile_birthday() FROM anon, authenticated;

DROP TRIGGER IF EXISTS sync_profile_birthday_trg ON public.profiles;
CREATE TRIGGER sync_profile_birthday_trg
  BEFORE INSERT OR UPDATE OF birthday ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_birthday();

UPDATE public.profiles SET birthday = NULL WHERE birthday IS NOT NULL;

-- Age helpers now read the private table
CREATE OR REPLACE FUNCTION public.get_my_birthday()
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT birthday FROM public.profile_birthdays WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.profile_ages(_ids uuid[])
RETURNS TABLE(id uuid, age integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.user_id,
         date_part('year', age(b.birthday))::int
  FROM public.profile_birthdays b
  WHERE b.user_id = ANY(_ids)
    AND b.birthday IS NOT NULL
    AND public.profile_visibility_of(b.user_id) IN ('public','members');
$$;

CREATE OR REPLACE FUNCTION public.is_minor(_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT date_part('year', age(birthday))::int < 18
     FROM public.profile_birthdays WHERE user_id = _user AND birthday IS NOT NULL),
    (SELECT age_category = 'minor' FROM public.profiles WHERE id = _user),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.my_age_category()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT public.age_category_from_birthday(birthday)
     FROM public.profile_birthdays WHERE user_id = auth.uid() AND birthday IS NOT NULL),
    (SELECT age_category FROM public.profiles WHERE id = auth.uid()),
    'unknown'
  );
$$;

-- 2) Stop exposing org email/phone to anonymous visitors
DROP POLICY IF EXISTS "orgs are publicly viewable" ON public.trainer_orgs;
CREATE POLICY "orgs are viewable by signed-in users" ON public.trainer_orgs
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE VIEW public.trainer_orgs_public
WITH (security_invoker = false) AS
  SELECT id, owner_id, name, handle, bio, avatar, avatar_url, cover_url, city, website,
         verified, address, place_id, geo, category, amenities, photos, hours, timezone,
         created_at, updated_at, hidden_at
  FROM public.trainer_orgs
  WHERE hidden_at IS NULL;

GRANT SELECT ON public.trainer_orgs_public TO anon, authenticated;

-- 3) Internal helpers should not be anonymously callable
REVOKE ALL ON FUNCTION public.is_minor(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.blocked_image_paths() FROM anon;
REVOKE ALL ON FUNCTION public.youth_flag(text) FROM anon;
REVOKE ALL ON FUNCTION public.is_game_participant(text, uuid) FROM anon;