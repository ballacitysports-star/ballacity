# Restore the live BallaCity deployment

## Verified evidence

A clean Chromium session against `https://ballacity.com` returns HTTP 200 but remains at `Loading…` and loads:

```text
https://ballacity.com/assets/index-BR82iF4e.js
```

The browser errors are:

```text
Missing Supabase environment variable(s): SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY. Connect Supabase in Lovable Cloud.
Missing Supabase environment variable(s): SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY. Connect Supabase in Lovable Cloud.
```

There are no failed network requests. The custom domain is active, its DNS records match, it is the primary domain, and the project is published. The current repository is clean at revision `6fe96f1f` and its latest build reports `build OK`.

## Conclusion

The live host is still serving the previously identified stale client asset rather than the verified current build. This is a deployment-artifact problem, not a DNS problem or a new application-code defect. No source code should be changed.

## Next steps

1. Have Lovable Support force-clear the stored production artifact/CDN entry for this project and deploy revision `6fe96f1f` as a completely fresh artifact.
2. After support confirms the reset, publish once if they request it.
3. Verify `ballacity.com` in a clean browser:
   - the entry asset hash differs from `index-BR82iF4e.js`;
   - the missing-variable errors are absent;
   - the landing page replaces `Loading…`;
   - no page errors or failed startup requests occur.
4. Check `ballacity.lovable.app`, `ballacity.com`, and `www.ballacity.com` to ensure they all resolve to the same corrected deployment.

## Scope

No application code, database data, authentication settings, DNS, or security policies will be changed.
