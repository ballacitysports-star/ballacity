# Catalog fingerprint

`catalog-fingerprint-cte.sql` is a read-only common table expression named `fps` that yields one row per catalog object
(`kind`, `key`, `fp`). Append one of the following and run it, unchanged, against two databases to compare them:

- per-kind, per-bucket digest (small output, safe to paste anywhere):
  `select kind, sum(n) n, string_agg(b||':'||n||':'||substr(h,1,4), ' ' order by b) s from (select kind, substr(md5(key),1,1) b, count(*) n, md5(string_agg(key||'='||fp, ',' order by key)) h from fps group by 1,2) x group by kind order by kind`
- the rows themselves: `select kind||'|'||key||'|'||substr(fp,1,12) from fps order by 1`

Covered: functions in `public` and `private_sec` (definition with comments and whitespace removed, plus EXECUTE for
PUBLIC/anon/authenticated/service_role), tables and views (kind, RLS flags, grants), columns, constraints, indexes,
triggers (public and `auth.users`), policies (public and `storage`), storage buckets, realtime publication membership.
Not covered: row data, platform-owned triggers in `storage`, the `MAINTAIN` privilege (PostgreSQL 17 only), and the
owner name. It prints no row data and no secrets.
