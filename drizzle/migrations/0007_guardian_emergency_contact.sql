-- Emergency contact info on a guardian's own profile. Private by construction:
-- every prior migration touching profiles' column privileges (birthday,
-- avatar_url_private, moderation_state, age_category, ...) follows the same
-- shape — REVOKE SELECT on the whole table, then GRANT SELECT (explicit
-- column list) back to anon/authenticated. A column added here and left off
-- every such list is never selectable by anon/authenticated at all; no
-- extra REVOKE is needed to keep it private, only an owner-only reader.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS emergency_contact_name text,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone text,
  ADD COLUMN IF NOT EXISTS emergency_contact_relationship text;

CREATE OR REPLACE FUNCTION public.get_my_emergency_contact()
RETURNS TABLE(contact_name text, contact_phone text, relationship text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.emergency_contact_name, p.emergency_contact_phone, p.emergency_contact_relationship
  FROM public.profiles p WHERE p.id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.get_my_emergency_contact() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_emergency_contact() TO authenticated;