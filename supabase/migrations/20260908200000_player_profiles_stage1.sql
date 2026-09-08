-- Stage 1 of the Account -> Player Profile refactor: introduce the athlete as
-- an entity that does not have to be a login.
--
-- Today `profiles.id` is a primary key referencing auth.users(id), so a player
-- IS an auth account. That is why a child currently needs their own email and
-- password: guardian_links.child_user_id and child_controls.child_user_id both
-- reference auth.users, and redeem_minor_invite() raises AUTH_REQUIRED unless
-- the child is signed in. There is no way to represent "Jake, age 12" without
-- creating Jake an account.
--
-- This migration is purely additive. It creates the table, backfills one row
-- per existing profile, and stops. Nothing reads it yet; no existing column,
-- policy, or foreign key is altered; every current code path behaves exactly
-- as before. Repointing games/teams/media at player_profile_id, and collapsing
-- existing child logins into managed profiles, are later stages that each need
-- their own RLS work and their own review.
--
-- The bridge that makes those stages incremental is `user_id`: for a profile
-- that is also a login it holds that auth id, and it is null for a managed
-- child who never had one. Code can therefore resolve either direction during
-- the transition, and stage 5 can re-parent a child's account_id without
-- inventing new identifiers.

CREATE TABLE IF NOT EXISTS public.player_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The authenticated account that owns and manages this athlete. For an
  -- adult's own profile this equals user_id. For a managed child it is the
  -- parent, and user_id is null.
  account_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Set only when this athlete is also a login. Null is the new normal for
  -- children. UNIQUE so an auth user can never end up with two player
  -- identities pointing at the same login, which would split their history.
  user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,

  first_name text,
  last_name text,
  display_name text NOT NULL DEFAULT 'Player',

  -- Public URL segment (/players/jake-smith). Nullable until stage 4 assigns
  -- them; unique when present so a slug can never address two athletes.
  slug text UNIQUE,

  -- Date of birth lives here, on the athlete, rather than in
  -- profile_birthdays, which is keyed on an auth user a managed child does not
  -- have. age_cohort is derived from it by trigger below, never set by a
  -- client: minor status has to follow the birthday, not a flag someone can
  -- flip.
  date_of_birth date,
  age_cohort text NOT NULL DEFAULT 'unknown',

  avatar_url text,
  avatar_initials text,
  bio text,
  location text,
  primary_sport text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT player_profiles_cohort_chk
    CHECK (age_cohort IN ('unknown','child_under_13','teen_13_15','teen_16_17','adult')),
  -- A self-owned profile must be its own login; anything else means a child
  -- row was written with someone else's auth id in user_id.
  CONSTRAINT player_profiles_self_or_managed_chk
    CHECK (user_id IS NULL OR user_id = account_id)
);

CREATE INDEX IF NOT EXISTS player_profiles_account_idx ON public.player_profiles (account_id);

-- Derive the cohort from the birthday on every write, reusing the same
-- function the rest of the app already computes cohorts with so the two can
-- never disagree.
CREATE OR REPLACE FUNCTION public.player_profiles_set_cohort()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  NEW.age_cohort := CASE
    WHEN NEW.date_of_birth IS NULL THEN 'unknown'
    ELSE public.age_cohort_from_birthday(NEW.date_of_birth)
  END;
  NEW.updated_at := now();
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS player_profiles_cohort ON public.player_profiles;
CREATE TRIGGER player_profiles_cohort
  BEFORE INSERT OR UPDATE ON public.player_profiles
  FOR EACH ROW EXECUTE FUNCTION public.player_profiles_set_cohort();

-- Ownership test, mirroring is_conversation_participant()'s shape. SECURITY
-- DEFINER so the policies below can use it without the caller needing to read
-- the table to decide whether they may read the table.
CREATE OR REPLACE FUNCTION public.owns_player_profile(_player uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.player_profiles p
    WHERE p.id = _player AND p.account_id = auth.uid()
  );
$fn$;

ALTER TABLE public.player_profiles ENABLE ROW LEVEL SECURITY;

-- Writes are the owner's alone. There is deliberately no policy admitting a
-- player to edit a profile they do not own even when user_id is theirs: for a
-- managed child the parent is the only writer, and for an adult the two ids
-- are equal anyway.
CREATE POLICY "Account owner reads own player profiles"
  ON public.player_profiles FOR SELECT TO authenticated
  USING (account_id = auth.uid());

CREATE POLICY "Account owner creates own player profiles"
  ON public.player_profiles FOR INSERT TO authenticated
  WITH CHECK (account_id = auth.uid());

CREATE POLICY "Account owner updates own player profiles"
  ON public.player_profiles FOR UPDATE TO authenticated
  USING (account_id = auth.uid())
  WITH CHECK (account_id = auth.uid());

CREATE POLICY "Account owner deletes own player profiles"
  ON public.player_profiles FOR DELETE TO authenticated
  USING (account_id = auth.uid());

-- Column-level grants rather than a blanket table grant: account_id and
-- user_id decide ownership, so a client must never be able to UPDATE them.
-- Re-parenting is stage 5's job and belongs in a SECURITY DEFINER routine.
-- (20260908015006 fixed the same over-grant on messages; this starts narrow
-- instead of being widened back later.)
REVOKE ALL ON public.player_profiles FROM authenticated;
GRANT SELECT, DELETE ON public.player_profiles TO authenticated;
GRANT INSERT (account_id, user_id, first_name, last_name, display_name, slug,
              date_of_birth, avatar_url, avatar_initials, bio, location,
              primary_sport)
  ON public.player_profiles TO authenticated;
GRANT UPDATE (first_name, last_name, display_name, slug, date_of_birth,
              avatar_url, avatar_initials, bio, location, primary_sport)
  ON public.player_profiles TO authenticated;

-- Backfill: one athlete per existing profile, self-owned. Existing children
-- keep their own account_id here rather than being re-parented to a guardian
-- — that is stage 5, it is irreversible, and it is not something a schema
-- migration should do on its own.
INSERT INTO public.player_profiles
  (account_id, user_id, display_name, slug, date_of_birth, avatar_initials, bio, primary_sport)
SELECT p.id, p.id,
       COALESCE(NULLIF(p.display_name, ''), 'Player'),
       p.username,
       b.birthday,
       p.avatar_initials,
       p.bio,
       p.sport
FROM public.profiles p
LEFT JOIN public.profile_birthdays b ON b.user_id = p.id
ON CONFLICT (user_id) DO NOTHING;
