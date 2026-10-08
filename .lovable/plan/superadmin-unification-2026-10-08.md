# Superadmin role hierarchy + unified control center

## Review: what exists today

**Role checks are inconsistent.** Superadmin access is bolted on per call site rather than inherited:

| Check | Superadmin passes? |
|---|---|
| `is_moderator()` (SQL) | Yes: includes admin, moderator, superadmin |
| `has_role(uid,'admin')` (SQL, 43 RLS policies, 17 migrations) | **No**: reads `user_roles` literally |
| `assertAdmin` in `admin.functions.ts` (`has_role` admin only) | **No**: superadmin is rejected unless they also hold `admin` |
| `assertAdmin` in `legal-documents.functions.ts`, `audit-log.functions.ts`, `compliance.ts` | Yes, via an explicit second `superadmin` RPC |
| `review_birthday_correction` / `list_birthday_corrections` (SQL) | Yes, via explicit `OR is_superadmin()` |
| `childSafetyOverview`, `resolveParentRequest`, `listingsCheck` (`is_moderator`) | Yes |
| `resolveAgeReview` | Calls `clear_age_review` RPC, which checks `is_moderator` in SQL |

So the "unauthorized wall" is any `has_role(..., 'admin')`-only path: all `admin.functions.ts` handlers and every RLS policy that gates on admin. The existing patches (`OR is_superadmin`) work but must be repeated everywhere; fixing it once in `has_role` makes them redundant.

**Queues live on separate `/admin/*` pages.** `/superadmin` has 9 tabs (Overview, Users, Content, Images, Payments, Monetization, Ops, Youth, Audit). The Youth tab only holds age-policy settings.
- Birthday corrections: `BirthdayCorrectionQueue` component, used by `/admin/child-safety`.
- Parental consent / age reviews / parent requests: `childSafetyOverview`, `resolveAgeReview`, `resolveParentRequest` and the `/admin/child-safety` page body.
- Listings & claims: `/admin/listings` (555 lines, its own auth check).
- Legal publishing: `/admin/legal` (571 lines, a `LegalManager` inner component).
- Reels worker: no UI. The worker is the secret-gated `POST /api/public/reels/process`. The only reels visibility is a read-only "Highlight reels" list in `OpsTab`.

## Part 1: role inheritance (one migration, no app-code change required)

Replace `has_role` so superadmin implies admin and moderator:

```sql
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND (role = _role
           OR (role = 'superadmin' AND _role IN ('admin','moderator')))
  )
$$;
```

Notes and risks:
- Inheritance is one-directional. `has_role(x,'superadmin')` stays literal, so admins never gain superadmin. The role-grant functions already restrict `superadmin` grants to superadmins (`superadmin.functions.ts`).
- It queries `user_roles` directly, not `is_superadmin()`, so no recursion or extra function hop. Grants/ownership are unchanged (the function is `CREATE OR REPLACE`, so existing EXECUTE grants survive; re-assert them in the migration anyway).
- **Side effects to audit before shipping** (grep each for `has_role(... 'admin')` used as an identity check rather than a permission check):
  - `admin.functions.ts` role listing/granting: make sure "list admins" and "last admin" logic read `user_roles` directly, not `has_role`.
  - `audit-log.functions.ts:18-19` computes admin vs superadmin separately to scope what is visible. Inheritance makes `isAdmin` true for superadmins. Check that it still derives scope from the superadmin flag, not "admin and not superadmin".
  - `compliance.ts:54-55`: same pattern.
  - The `user_roles` RLS policy "Users view own roles" (`has_role(auth.uid(),'admin')`) now lets superadmins read all role rows. That is intended.
- After the migration, simplify the explicit double-checks in `legal-documents.functions.ts`, `audit-log.functions.ts`, and `compliance.ts` to a single `has_role(..., 'admin')`. This is optional cleanup and can be a follow-up so the diff stays reviewable.
- Add a SQL test: a user with only `superadmin` returns true for `admin`, `moderator`, `superadmin`; an admin-only user returns false for `superadmin`; a moderator-only user returns false for `admin`.
- Regenerate `src/integrations/supabase/types.ts` only if the migration tooling does it automatically; the signature is unchanged.

## Part 2: unify the control center

Principle (matches AGENTS.md): **reuse the existing queue components and server functions; don't copy permission or participation logic.** Extract page bodies into components under `src/components/superadmin/` or `src/components/admin/`, and have both the old `/admin/*` route and the new tab render the same component. Server auth stays on the existing server function (`is_moderator` etc.), and with Part 1 it already admits superadmins. Do not add a second permission path.

### 2a. Youth & age tab
Restructure `YouthTab` into sub-sections (a small inner `Tabs`, or stacked cards with the queues first):
1. **Birthday corrections**: render `<BirthdayCorrectionQueue />` as is (already admin-or-superadmin in SQL).
2. **Parental consent & age reviews**: extract the body of `AdminChildSafetyPage` (stat tiles, `ageReviews` list with `resolveAgeReview`, `openRequests` with `resolveParentRequest`, `AdminFamilyPanel`) into `src/components/child/ChildSafetyPanel.tsx`. `/admin/child-safety` becomes a thin wrapper around it; the tab renders the same panel. Keep the query key `["admin-child-safety"]` so invalidation stays shared.
3. **Age policy settings**: the existing content, moved into its own component (`AgePolicyPanel`) so the tab file stays small.
4. Pending counts shown as badges on the sub-section headings (reuse `childSafetyOverview` counts and the birthday queue's `pending` list length), and rolled into the Overview tab's attention list.

### 2b. New tabs in `superadmin.tsx`
Add triggers `Listings & claims`, `Legal`, `Reels worker` (lazy-load each panel so the tab shell stays fast).

- **Listings & claims**: extract the `ListingsPage` body from `admin.listings.tsx` into `ListingsClaimsPanel`. The inner `listingsCheck` redirect logic stays in the route wrapper only; the panel assumes it is already authorized (server functions still enforce `is_moderator`). Preserve the Unclaimed / Claims / Featured sub-tabs.
- **Legal publishing**: extract `LegalManager` from `admin.legal.tsx` into `LegalPublishingPanel`; the route keeps its page chrome and auth gate. Server functions (`adminListLegalDocuments`, `adminPublishLegalDocument`, …) are unchanged. Include the re-acceptance pending count.
- **Reels worker**: new, small panel plus one server function in `superadmin.functions.ts` (`superadminReelsWorkerStatus`, using `assertSuperadmin` and `logAdminAction`):
  - Counts by `highlight_reels.status`: processing / failed / stuck (processing past `STUCK_AFTER_MS`) / at `MAX_ATTEMPTS`. Constants come from `reels-pipeline.server.ts` and are exported to the function, not duplicated.
  - Table of stuck/failed reels with `attempts`, `processing_step`, last error.
  - Actions: **Retry** (reset `attempts`/`processing_started_at` for selected reels) and **Hide** (`setReelsHidden` semantics). Both audited with a reason. Soft-only, consistent with the control-center rules.
  - **"Run worker now" is deliberately not built.** The endpoint requires `REELS_WORKER_SECRET`, and the browser must never hold it. If an on-demand run is wanted later, add a server-side trigger that calls the pipeline directly under `assertSuperadmin`.
  - Show "worker last ran" from the newest `processing_started_at`, which gives a health signal without exposing the secret.
- Remove the read-only "Highlight reels" list from `OpsTab` queues or link it to the new tab (avoid two diverging views).

### 2c. Overview "needs attention" strip
One row of count chips linking to the right tab: pending birthday corrections, open consent/parent requests, age reviews, pending claims, unpublished legal drafts / reacceptance pending, stuck reels. Each count comes from the same server function its queue uses.

## Suggested order (each step shippable alone)

1. Migration: `has_role` inheritance + SQL test + audit the side-effect call sites listed above.
2. Extract `ChildSafetyPanel`; embed birthday queue and consent panel in the Youth tab (`/admin/child-safety` keeps working via the wrapper).
3. Extract `ListingsClaimsPanel` and `LegalPublishingPanel`; add the two tabs.
4. Reels worker status function + panel + audit entries.
5. Overview attention strip; optional cleanup of redundant double role checks.

## Decisions for you
- **Should superadmin also inherit `moderator`?** The plan says yes (`is_moderator` already does; this just makes `has_role` agree). Say if you'd rather limit inheritance to `admin`.
- **Leave `/admin/*` routes in place?** The plan keeps them as thin wrappers so existing links, bookmarks, and admins who aren't superadmins still work. Removing them would lock regular admins out of those queues.
- **Reels "Retry" scope:** reset only `failed`/stuck reels (recommended), or also let superadmins re-queue completed ones?
