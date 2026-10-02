# Guardian emergency contact info — verification

Adds `emergency_contact_name`/`_phone`/`_relationship` to `profiles` and an
owner-only `get_my_emergency_contact()` reader. Private to the guardian
themself by construction — see
`supabase/migrations/20261001150000_guardian_emergency_contact.sql` and its
own header comment for why no columns needed an explicit `REVOKE`.

Builds on `claude/guardian-account-type` (PR #25, not yet merged): the
`GuardianProfileView`/`parent` account-type surfaces this hooks into don't
exist on `main` yet. This branch is based on that one rather than `main`, the
same way any genuinely dependent follow-on work in this repo stacks rather
than forking fresh — unlike the device-pairing and guardian-account-type
PRs, which were independent of each other and each started from `main`.

## Local replay

Ran against the same persisted Postgres 16 replay database this session has
reused throughout (already carrying PR #25's three migrations applied, since
this branch is based on its tip) — two fresh throwaway `auth.users` rows (A,
B), deleted after.

| # | Check | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| E1 | A updates their own emergency contact as `authenticated` | succeeds | `UPDATE 1` | PASS |
| E2 | A reads it back via `get_my_emergency_contact()` | A's own values | `Jane Doe / 555-0100 / spouse` | PASS |
| E3 | B calls the same RPC | B's own (empty) row, never A's data | all three columns NULL | PASS |
| E4 | B selects `emergency_contact_phone` directly from A's row | rejected — no column-level SELECT grant | `permission denied for table profiles` | PASS |
| E5 | `anon` selects any new column directly | rejected | `permission denied for table profiles` | PASS |
| E6 | `anon` calls `get_my_emergency_contact()` | rejected — `REVOKE ALL … FROM PUBLIC, anon` | `permission denied for function get_my_emergency_contact` | PASS |

E1–E2 together also confirm the write path needs no extra grant: the
existing `"Users can update own profile"` policy (`auth.uid() = id`) already
covers columns added after it existed, exactly as reasoned from reading
`20260730145312_5d27f5f7-4599-4397-9518-b98cbc474d27.sql`'s `birthday`
precedent before writing this migration, not assumed.

## Still to run

- ~~Apply via Lovable's chat with per-statement approval on the canonical
  project.~~ **Done**, after confirming PR #25's three migrations were
  already live (commit `97b0c3b`). This migration landed at commit
  `7d85ea0` and was independently re-verified live against all four
  points: the three columns exist as nullable `text`; `get_my_emergency_contact()`
  exists with the exact signature; its `EXECUTE` grant is `authenticated`-only
  (`anon`/`PUBLIC` revoked); and the three columns stay off `profiles`'
  column-ACL allowlist, matching `birthday`.
- A real browser dry run of the edit-screen section and the About-sheet
  round trip — not attempted in this pass (same limitation noted on PR #25
  for `GuardianProfileView` generally: faking a signed-in session for a
  direct Supabase-client data path wasn't reconstructed with confidence
  here either). `e2e/guardian-emergency-contact.spec.ts` covers this against
  a real deployed backend instead, self-skipping without one.
