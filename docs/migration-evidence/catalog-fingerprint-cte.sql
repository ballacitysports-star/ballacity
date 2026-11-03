with norm as (select 1),
roles as (select oid, rolname from pg_roles union all select 0, 'PUBLIC'),
fnacl as (
  select p.oid, coalesce((select string_agg(r.rolname||':'||a.privilege_type, ',' order by r.rolname, a.privilege_type)
    from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a join roles r on r.oid=a.grantee
    where r.rolname in ('PUBLIC','anon','authenticated','service_role')),'') acl from pg_proc p),
relacl as (
  select c.oid, coalesce((select string_agg(r.rolname||':'||a.privilege_type, ',' order by r.rolname, a.privilege_type)
    from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a join roles r on r.oid=a.grantee
    where r.rolname in ('PUBLIC','anon','authenticated','service_role') and a.privilege_type<>'MAINTAIN'),'') acl from pg_class c),
fps as (
  select 'function' kind, n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' key,
    md5(regexp_replace(regexp_replace(pg_get_functiondef(p.oid),'--[^\n]*','','g'),'\s+',' ','g'))||'|'||md5(fa.acl) fp
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join fnacl fa on fa.oid=p.oid
  where n.nspname in ('public','private_sec') and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
  union all
  select 'table', n.nspname||'.'||c.relname, md5(c.relkind::text||c.relrowsecurity::text||c.relforcerowsecurity::text||ra.acl)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace join relacl ra on ra.oid=c.oid
  where n.nspname='public' and c.relkind in ('r','p','v','m')
  union all
  select 'column', n.nspname||'.'||c.relname||'.'||a.attname,
    md5(format_type(a.atttypid,a.atttypmod)||a.attnotnull::text||coalesce(pg_get_expr(d.adbin,d.adrelid),'')||a.attgenerated::text||a.attidentity::text)
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
  left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where n.nspname='public' and c.relkind in ('r','p','v','m') and a.attnum>0 and not a.attisdropped
  union all
  select 'constraint', n.nspname||'.'||c.relname||'.'||k.conname, md5(pg_get_constraintdef(k.oid))
  from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
  union all
  select 'index', schemaname||'.'||indexname, md5(indexdef) from pg_indexes where schemaname='public'
  union all
  select 'trigger', n.nspname||'.'||c.relname||'.'||t.tgname, md5(pg_get_triggerdef(t.oid)||t.tgenabled::text)
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where not t.tgisinternal and ((n.nspname='public') or (n.nspname='auth' and c.relname='users'))
  union all
  select 'policy', schemaname||'.'||tablename||'.'||policyname, md5(permissive||cmd||roles::text||coalesce(qual,'')||coalesce(with_check,''))
  from pg_policies where schemaname='public' or (schemaname='storage' and tablename in ('objects','buckets'))
  union all
  select 'bucket', id, md5(public::text||coalesce(file_size_limit::text,'')||coalesce(allowed_mime_types::text,'')) from storage.buckets
  union all
  select 'publication', pubname||'.'||schemaname||'.'||tablename, '' from pg_publication_tables where schemaname='public'
)
