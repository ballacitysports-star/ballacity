# CLAUDE.md

Guidance for Claude Code (or any agent) working in this repository.

## Two Supabase projects — do not confuse them

This repo touches **two separate Supabase projects**. Getting this wrong
already caused a live incident (a storage bucket created in the wrong
project, and a long back-and-forth before it was caught) — read this before
opening the Supabase dashboard, running `supabase` CLI commands, or applying
a migration.

| | Project ref | Role | Who controls it |
|---|---|---|---|
| **Production** | `cpqihhcqeivbgxqbzatv` | Live app — real users, real data | Lovable (Lovable Cloud). Repo owner may **not** have supabase.com dashboard access to it. |
| **Dev / E2E** | `olrbulvwexrkjcxddjxq` | Local CLI work, Playwright E2E seeding | Repo owner |

**`supabase/config.toml` links to the dev project, not production**, on
purpose (see commit `e0e8922`, "Declare all storage buckets and point
config.toml at the owned project"). Production is Lovable-managed and its
service-role key was never reachable from this machine, so the CLI link
was deliberately pointed at a project the owner does control instead.

Practical consequences:

- **`supabase link` / `supabase db push` from this machine does not touch
  production.** It targets the dev/E2E project. Do not treat a clean
  `db push` as proof anything reached production.
- **The Supabase dashboard "linked project" shortcut does not lead to
  production either**, for the same reason. Go directly to
  `https://supabase.com/dashboard/project/cpqihhcqeivbgxqbzatv` instead of
  following "my project."
- **Production schema changes go through direct SQL**, not the CLI —
  either the Lovable MCP `query_database` tool, or Lovable's own editor/SQL
  tools. This is how every migration that's actually reached production has
  been applied. Always verify in a rolled-back transaction first when the
  change is non-trivial, then re-verify live afterward.
- **The repo owner's personal Supabase login may not have access to the
  production project at all** — confirmed live during a 2026-09-15 session
  (`https://supabase.com/dashboard/project/cpqihhcqeivbgxqbzatv` →
  "you do not have access"). Lovable's own MCP tools reach it successfully
  using Lovable's service credentials, independent of the user's personal
  login. If a task needs a raw file (not a SQL/metadata) written into
  Supabase Storage on production and neither the CLI nor `query_database`
  can do it (the latter can only write `storage.objects` metadata, not
  object bytes), the working path found so far is asking Lovable's own
  project agent to do it via `mcp__Lovable__send_message` — it has real
  backend access production the user does not.
- **`supabase/migrations/` is the source of truth for what *should* be
  true in both projects**, but production can and has drifted from it:
  Lovable's own security-scan agent applies fixes directly to production
  outside git (e.g. `20260915183300_close_profiles_moderation_write_leak.sql`
  captures one such fix after the fact, and also fixes a gap in it). When
  something looks off between the repo and production behavior, check
  production directly before assuming the migration files are current.

## Environment files

`.env.production` holds only anon-safe values (URL, project ref, publishable
key) — the same ones every frontend bundle ships — never a service-role key
or other secret. Despite that, prefer not committing it going forward.
