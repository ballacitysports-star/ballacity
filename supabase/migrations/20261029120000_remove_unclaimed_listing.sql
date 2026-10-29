-- Removing an unclaimed listing a moderator (or discovery) created.
--
-- A listing with no owner can be taken down again, but only while that is
-- harmless. The rule is checked here, in the database, because a plain DELETE
-- would quietly take with it everything that cascades from the listing
-- (members, posts, reviews, follows, ...), and by then the listing may hold
-- things other people wrote.
--
--   * moderators only (the same check as creating one)
--   * only a moderator-listed listing that nobody owns
--   * not while a claim is open (pending, or waiting on the claimant)
--   * not while any other row would be deleted along with it or would block the
--     delete: found by reading the foreign keys, so a table added later is
--     covered without touching this function
--
-- Games linked to the listing only lose the link (ON DELETE SET NULL), so they
-- do not block it. The listing's finished claims are swept by the existing
-- cleanup trigger.

CREATE OR REPLACE FUNCTION public.remove_unclaimed_listing(_type text, _id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := auth.uid();
  _table regclass;
  _key text;
  _owner uuid;
  _listed timestamptz;
  _found boolean;
  _gym uuid;
  fk record;
  _n bigint;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  IF NOT public.is_moderator(_me) THEN RAISE EXCEPTION 'NOT_MODERATOR' USING ERRCODE = '42501'; END IF;

  IF _type = 'team' THEN
    _table := 'public.teams'::regclass;
    _key := _id;
    SELECT owner_id, listed_at, true INTO _owner, _listed, _found
      FROM public.teams WHERE id = _id FOR UPDATE;
  ELSIF _type = 'gym' THEN
    BEGIN
      _gym := _id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'LISTING_NOT_FOUND';
    END;
    _table := 'public.trainer_orgs'::regclass;
    _key := _gym::text;
    SELECT owner_id, listed_at, true INTO _owner, _listed, _found
      FROM public.trainer_orgs WHERE id = _gym FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'INVALID_TYPE';
  END IF;

  IF NOT COALESCE(_found, false) THEN RAISE EXCEPTION 'LISTING_NOT_FOUND'; END IF;
  IF _owner IS NOT NULL THEN RAISE EXCEPTION 'ALREADY_CLAIMED'; END IF;
  IF _listed IS NULL THEN RAISE EXCEPTION 'NOT_UNCLAIMED_LISTING'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.listing_claims
     WHERE subject_type = _type AND subject_id = _key AND status IN ('pending', 'needs_info')
  ) THEN
    RAISE EXCEPTION 'CLAIM_OPEN';
  END IF;

  -- Anything that would be deleted with the listing, or would block it.
  FOR fk IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f'
       AND c.confrelid = _table
       AND array_length(c.conkey, 1) = 1
       AND c.confdeltype IN ('c', 'r', 'a')
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I::text = $1', fk.tbl, fk.col)
      INTO _n USING _key;
    IF _n > 0 THEN
      RAISE EXCEPTION 'LISTING_IN_USE' USING DETAIL = fk.tbl::text;
    END IF;
  END LOOP;

  IF _type = 'team' THEN
    DELETE FROM public.teams WHERE id = _id;
  ELSE
    DELETE FROM public.trainer_orgs WHERE id = _gym;
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.remove_unclaimed_listing(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_unclaimed_listing(text, text) TO authenticated;
