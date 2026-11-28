-- ROLLBACK for supabase/migrations/20261205100000_network_post_reports.sql (members report a network post).
-- NOT a migration. It drops the trigger user_reports_post_via_rpc and its function private_sec.user_reports_post_via_rpc(),
-- the function public.report_post(uuid, text, text), the index user_reports_post_idx and the columns user_reports.post_id
-- and user_reports.post_body_md5, and puts back user_reports_subject_type_check as 20261109100000 left it ('user', 'game',
-- 'message', 'reel', 'payment', 'team_chat_message'): the objects the migration created, and the one it changed.
-- POST REPORTS ARE NEVER DELETED OR REWRITTEN HERE. While any report has subject_type 'post', a post_id or a
-- post_body_md5, it refuses, changing nothing: the old check would refuse those rows, and dropping the columns would lose
-- which post each is about. A person decides what happens to them first.
-- THE EXPORT IS CONFIDENTIAL. Reports are confidential: the export names who reported whom, carries the reporter's own
-- words and the moderators' notes, and the post's text, which may be a minor's family or team post. Write it only to
-- storage that only moderators and the owner can open, never into the repository, a release record, a ticket or a chat.
-- The release record notes only how many post reports there were and where the export is kept (the second query).
--     \copy (SELECT r.*, p.author_id AS post_author_id, p.posted_as, p.team_id, p.org_id, p.audience, p.body AS post_body,
--            p.moderation_status AS post_moderation_status, p.hidden_at AS post_hidden_at, p.deleted_at AS post_deleted_at
--            FROM public.user_reports r LEFT JOIN public.posts p ON p.id = r.post_id
--            WHERE r.subject_type = 'post' OR r.post_id IS NOT NULL OR r.post_body_md5 IS NOT NULL ORDER BY r.created_at)
--            TO '<a path in that restricted storage>/post_reports.csv' WITH (FORMAT csv, HEADER)
--     SELECT count(*) FROM public.user_reports WHERE subject_type = 'post' OR post_id IS NOT NULL OR post_body_md5 IS NOT NULL;
-- Then either keep them as reports about the account (the reported user is the post's author already):
--     UPDATE public.user_reports SET subject_type = 'user', post_id = NULL, post_body_md5 = NULL
--      WHERE subject_type = 'post' OR post_id IS NOT NULL OR post_body_md5 IS NOT NULL;
-- or, once a moderator has closed every one, delete them. Run either as the migration role (as this file is), not
-- through the API. Then run this file again.
-- APP: the Report action on a post calls report_post and, once it is gone, tells the member reporting a post isn't
-- available; the moderation queue (src/lib/moderation.functions.ts) reads user_reports.post_id only where it exists. So the
-- app keeps working, but revert the app commit as well so the Report action is not offered.
-- It stops, changing nothing, unless both functions still have the definitions 20261205100000 gave them (md5 below);
-- report_post's only API-role grant is EXECUTE for authenticated and the trigger function has none; no other function
-- names either of them; no other function body names user_reports together with post_id or post_body_md5, and no other
-- trigger function on user_reports names either column (pg_depend does not record a column a plpgsql or SQL body reads,
-- so the drop would not stop for them, and they would break at run time: a trigger like that would make every report
-- insert fail); the trigger is the BEFORE INSERT ... FOR EACH ROW one on user_reports, and no other trigger uses the
-- function; the subject check is the one the migration created; post_id is a nullable uuid whose only constraint is its
-- foreign key to posts(id) ON DELETE SET NULL, whose only index is user_reports_post_idx as created; post_body_md5 is a
-- nullable text with no default, constraint or index; nothing else (a policy, a view, another index) depends on either;
-- and no report is a post report. A later change needs a person to look first.
-- It refuses to run unless the session sets the confirmation first:
--     SET app.confirm_network_post_reports_rollback = 'yes';
--     (or PGOPTIONS="-c app.confirm_network_post_reports_rollback=yes")
-- LEDGER: this file does not touch supabase_migrations.schema_migrations. After a successful rollback, delete the ledger row
-- for 20261205100000 by hand (as the earlier release records do), or the ledger says applied while the objects are gone.
-- PRODUCTION CHECK: the md5s below were computed on the local Postgres 16; production runs 17 and pg_get_functiondef text may
-- differ between versions. The guard fails closed (it refuses, changing nothing), but do not find that out in an emergency:
-- after applying the migration, run this read-only query in production and record the result in the release record. It must
-- return 4bdc4cfa0f20c349760c89896ae58a3b and e4cef9fd49a98338247921050a2f6b27; if not, the guard values here need a person
-- to look first.
--     SELECT md5(pg_get_functiondef('public.report_post(uuid,text,text)'::regprocedure)),
--            md5(pg_get_functiondef('private_sec.user_reports_post_via_rpc()'::regprocedure));
-- Locks: ACCESS EXCLUSIVE on user_reports while the check is rebuilt (one scan of a small table) and the columns dropped,
-- and SHARE ROW EXCLUSIVE on posts while the foreign key goes; the wait for each is limited to 5 s.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $guard$
DECLARE
  _want CONSTANT text[][] := ARRAY[
    ['public.report_post(uuid,text,text)',            '4bdc4cfa0f20c349760c89896ae58a3b', 'authenticated:EXECUTE'],
    ['private_sec.user_reports_post_via_rpc()',       'e4cef9fd49a98338247921050a2f6b27', NULL]];
  _check CONSTANT text := 'CHECK ((subject_type = ANY (ARRAY[''user''::text, ''game''::text, ''message''::text, ''reel''::text, ''payment''::text, ''team_chat_message''::text, ''post''::text])))';
  _index CONSTANT text := 'CREATE INDEX user_reports_post_idx ON public.user_reports USING btree (post_id, reporter_id) WHERE (post_id IS NOT NULL)';
  _callee_re CONSTANT text := '\m(report_post|user_reports_post_via_rpc)\M';
  _column_re CONSTANT text := '\mpost_(id|body_md5)\M';
  _guarded oid[] := '{}';
  _fn regprocedure;
  _trigfn oid;
  _col smallint;
  _md5col smallint;
  _fk oid;
  _got text;
  _n bigint;
  i int;
BEGIN
  IF current_setting('app.confirm_network_post_reports_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: members can no longer report a post, and the moderation queue loses the post a report is about. Set app.confirm_network_post_reports_rollback=yes for the session to proceed deliberately.';
  END IF;
  FOR i IN 1 .. array_length(_want, 1) LOOP
    _fn := to_regprocedure(_want[i][1]);
    SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = _fn;
    IF _fn IS NULL OR _got IS DISTINCT FROM _want[i][2] THEN
      RAISE EXCEPTION 'Refusing to run: % is not the definition 20261205100000 created (md5 %, expected %). A later change needs a person to look first.', _want[i][1], _got, _want[i][2];
    END IF;
    SELECT string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY coalesce(r.rolname, 'PUBLIC'), x.privilege_type)
      INTO _got
      FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
      LEFT JOIN pg_roles r ON r.oid = x.grantee
     WHERE p.oid = _fn AND coalesce(r.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated', 'service_role');
    IF _got IS DISTINCT FROM _want[i][3] THEN
      RAISE EXCEPTION 'Refusing to run: % has API-role grants 20261205100000 did not give (%, expected %). A later change needs a person to look first.', _want[i][1], coalesce(_got, 'none'), coalesce(_want[i][3], 'none');
    END IF;
    _guarded := _guarded || _fn::oid;
  END LOOP;
  _trigfn := 'private_sec.user_reports_post_via_rpc()'::regprocedure;

  -- a SQL or plpgsql body names its callees only as text, which pg_depend does not record
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO _got
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.oid <> ALL (_guarded)
     AND p.prosrc ~ _callee_re;
  IF _got IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to run: % names a function this rollback drops. A later change needs a person to look first.', _got;
  END IF;
  -- nor does pg_depend record the columns such a body reads: a function naming user_reports and either column, or a
  -- trigger function on user_reports naming either column, would break once they are gone
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO _got
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.oid <> ALL (_guarded)
     AND ((p.prosrc ~ '\muser_reports\M' AND p.prosrc ~ _column_re)
          OR (p.prosrc ~ _column_re
              AND EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgfoid = p.oid AND tg.tgrelid = 'public.user_reports'::regclass)));
  IF _got IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to run: % reads user_reports.post_id or post_body_md5, which this rollback drops. A later change needs a person to look first.', _got;
  END IF;

  -- the trigger: BEFORE (2) | INSERT (4) | ROW (1) = 7, enabled, on user_reports, and the only user of its function
  SELECT string_agg(tg.tgrelid::regclass::text || '.' || tg.tgname || ' type ' || tg.tgtype::text || ' ' || tg.tgenabled::text, ', ') INTO _got
    FROM pg_trigger tg
   WHERE tg.tgfoid = _trigfn
     AND NOT (tg.tgrelid = 'public.user_reports'::regclass AND tg.tgname = 'user_reports_post_via_rpc'
              AND tg.tgtype = 7 AND tg.tgenabled = 'O' AND NOT tg.tgisinternal);
  IF _got IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.user_reports'::regclass
                     AND tg.tgname = 'user_reports_post_via_rpc' AND tg.tgfoid = _trigfn) THEN
    RAISE EXCEPTION 'Refusing to run: the trigger user_reports_post_via_rpc is not the one 20261205100000 created (%). A later change needs a person to look first.', coalesce(_got, 'missing');
  END IF;

  -- the subject check
  SELECT pg_get_constraintdef(c.oid) INTO _got
    FROM pg_constraint c
   WHERE c.conrelid = 'public.user_reports'::regclass AND c.conname = 'user_reports_subject_type_check';
  IF _got IS DISTINCT FROM _check THEN
    RAISE EXCEPTION 'Refusing to run: user_reports_subject_type_check is not the one 20261205100000 created (%). A later change needs a person to look first.', _got;
  END IF;

  -- the column, its foreign key and its index, and nothing else that depends on it
  SELECT a.attnum INTO _col FROM pg_attribute a
   WHERE a.attrelid = 'public.user_reports'::regclass AND a.attname = 'post_id' AND NOT a.attisdropped
     AND a.atttypid = 'uuid'::regtype AND NOT a.attnotnull AND NOT a.atthasdef;
  IF _col IS NULL THEN
    RAISE EXCEPTION 'Refusing to run: user_reports.post_id is not the nullable uuid column 20261205100000 created. A later change needs a person to look first.';
  END IF;
  SELECT string_agg(c.conname || ' ' || c.contype::text, ', '), (array_agg(c.oid))[1] INTO _got, _fk
    FROM pg_constraint c
   WHERE c.conrelid = 'public.user_reports'::regclass AND _col = ANY (c.conkey);
  IF _got IS DISTINCT FROM 'user_reports_post_id_fkey f'
     OR NOT EXISTS (SELECT 1 FROM pg_constraint c
                     WHERE c.oid = _fk AND c.conkey = ARRAY[_col] AND c.confrelid = 'public.posts'::regclass
                       AND c.confkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.posts'::regclass AND attname = 'id')]
                       AND c.confdeltype = 'n' AND c.confupdtype = 'a' AND c.confmatchtype = 's' AND c.convalidated) THEN
    RAISE EXCEPTION 'Refusing to run: the constraints on user_reports.post_id are not the foreign key 20261205100000 created (%). A later change needs a person to look first.', coalesce(_got, 'none');
  END IF;
  SELECT string_agg(i.indexrelid::regclass::text, ', ') INTO _got
    FROM pg_index i
   WHERE i.indrelid = 'public.user_reports'::regclass
     AND (_col = ANY (i.indkey::smallint[]) OR pg_get_expr(i.indpred, i.indrelid) ~ '\mpost_id\M'
          OR pg_get_expr(i.indexprs, i.indrelid) ~ '\mpost_id\M');
  IF _got IS DISTINCT FROM 'user_reports_post_idx'
     OR pg_get_indexdef('public.user_reports_post_idx'::regclass) IS DISTINCT FROM _index THEN
    RAISE EXCEPTION 'Refusing to run: the indexes on user_reports.post_id are not the one 20261205100000 created (%). A later change needs a person to look first.', coalesce(_got, 'none');
  END IF;
  SELECT string_agg(pg_describe_object(d.classid, d.objid, d.objsubid), ', ') INTO _got
    FROM pg_depend d
   WHERE d.refclassid = 'pg_class'::regclass AND d.refobjid = 'public.user_reports'::regclass AND d.refobjsubid = _col
     AND NOT (d.classid = 'pg_constraint'::regclass AND d.objid = _fk)
     AND NOT (d.classid = 'pg_class'::regclass AND d.objid = 'public.user_reports_post_idx'::regclass);
  IF _got IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to run: % depends on user_reports.post_id. A later change needs a person to look first.', _got;
  END IF;

  -- post_body_md5: a nullable text with no default, and nothing (constraint, index, view, policy) built on it
  SELECT a.attnum INTO _md5col FROM pg_attribute a
   WHERE a.attrelid = 'public.user_reports'::regclass AND a.attname = 'post_body_md5' AND NOT a.attisdropped
     AND a.atttypid = 'text'::regtype AND NOT a.attnotnull AND NOT a.atthasdef;
  IF _md5col IS NULL THEN
    RAISE EXCEPTION 'Refusing to run: user_reports.post_body_md5 is not the nullable text column 20261205100000 created. A later change needs a person to look first.';
  END IF;
  SELECT string_agg(pg_describe_object(d.classid, d.objid, d.objsubid), ', ') INTO _got
    FROM pg_depend d
   WHERE d.refclassid = 'pg_class'::regclass AND d.refobjid = 'public.user_reports'::regclass AND d.refobjsubid = _md5col;
  IF _got IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to run: % depends on user_reports.post_body_md5. A later change needs a person to look first.', _got;
  END IF;

  -- the reports themselves: never deleted or rewritten here
  SELECT count(*) INTO _n FROM public.user_reports WHERE subject_type = 'post' OR post_id IS NOT NULL OR post_body_md5 IS NOT NULL;
  IF _n > 0 THEN
    RAISE EXCEPTION 'Refusing to run: % post report(s) exist. Export them and decide with a person whether they stay as account reports or go (the header of this file says how), then run it again. Nothing was changed.', _n;
  END IF;
END
$guard$;

DROP TRIGGER user_reports_post_via_rpc ON public.user_reports;
DROP FUNCTION private_sec.user_reports_post_via_rpc();
DROP FUNCTION public.report_post(uuid, text, text);
ALTER TABLE public.user_reports DROP CONSTRAINT user_reports_subject_type_check;
ALTER TABLE public.user_reports ADD CONSTRAINT user_reports_subject_type_check
  CHECK (subject_type IN ('user', 'game', 'message', 'reel', 'payment', 'team_chat_message'));
DROP INDEX public.user_reports_post_idx;
ALTER TABLE public.user_reports DROP COLUMN post_body_md5;
ALTER TABLE public.user_reports DROP COLUMN post_id;

COMMIT;
