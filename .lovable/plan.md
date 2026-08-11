# Superadmin control center

A new `/superadmin` page: one place to see and control every part of the app, gated behind a new top-level `superadmin` role. Existing `/admin` stays as-is (and gets a link to the new page).

## Access model

- New `superadmin` value added to the role list, sitting above `admin` and `moderator`.
- Only a superadmin can open `/superadmin` or run any of its actions; the check happens on the server for every action, not just on the page.
- Only a superadmin can grant or revoke the `superadmin` role. Admins keep their current powers.
- Bootstrapping: the first superadmin is granted directly in the database as part of this change (you tell me which account, or I default to the current admin account).

## What the page contains

Tabbed control center, each tab with search, filters, paging, and row detail drawers.

1. **Overview** — live counts and health: users, profiles by type, games (upcoming/live/past), teams, gyms, orgs, availability posts, reviews, messages, notifications, purchases/subscriptions, reels, plus recent sign-in and location-denial telemetry.
2. **Users & profiles** — search by name/username/email/id; view full profile, roles, owned teams/gyms/orgs, games, availability, reports and blocks. Actions: edit profile fields, grant/revoke roles, suspend (soft) account, reset onboarding/account type, clear active profile, force sign-out.
3. **Content moderation** — games, teams, trainers, gyms/orgs, team posts, availability posts, reviews, comments, reactions, messages. Actions: hide/unhide, flag/unflag, close joins, cancel game, unpublish, edit key fields, and a queue for user reports and blocks with resolve/dismiss.
4. **Payments & subscriptions** — purchases, subscriptions, host payment methods, game payment settings, payment submissions and verification history. Actions: change submission status with reviewer notes, mark refund-requested, disable a host payment method (no money moves from this page).
5. **Ops & config** — feature flags and app settings (new settings table), broadcast a notification to a filtered audience, join/waitlist queues, reels worker controls, and links to the existing admin analytics pages.
6. **Audit log** — every superadmin action recorded (who, what, target, before/after, when), filterable and searchable.

## Rules baked in

- **Soft-only**: no hard deletes anywhere. Everything is hide / suspend / disable / status change, reversible from the same screen.
- Suspended users and hidden content are filtered out of the public app but always visible to superadmins.
- Destructive-feeling actions require a typed confirmation and a reason, which lands in the audit log.
- Page is `noindex`, client-rendered, and never exposes secrets or service keys.

## Technical notes

- Migration: extend `app_role` with `superadmin`; add `is_superadmin(uuid)` security-definer helper; add `admin_audit_log`, `app_settings` (key/value flags), and soft-state columns where missing (`profiles.suspended_at`, `hidden_at` on moderatable tables); grants + RLS restricting new tables to superadmin reads/writes; seed the first superadmin row.
- New `src/lib/superadmin.functions.ts` with `createServerFn` + `requireSupabaseAuth`, each handler verifying `is_superadmin` via `context.supabase` before loading `supabaseAdmin` inside the handler. Every mutation writes an audit row.
- New route `src/routes/superadmin.tsx` plus `src/components/superadmin/*` tab components (overview, users, moderation, payments, ops, audit) to keep files small.
- Public read paths updated to exclude suspended users and hidden content.
- `/admin` gains a "Superadmin" link visible only to superadmins.

Given the size, I'd build this in order: role + schema + audit foundation and the shell with Overview and Users first, then Moderation, then Payments, then Ops. Say the word if you'd rather I ship it all in one pass.
