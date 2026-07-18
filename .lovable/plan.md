## Goal

Kill the legacy step‑0 type picker on `/teams/create` and make sure no link lands on it. Every entry point must arrive with a `kind` already chosen (`team` or `coach`) and open on step 1 (Identity).

## Current link inventory

- `src/routes/_tabs.teams.tsx:260` — `+` button → `/teams/create` (no kind)
- `src/routes/_tabs.trainers.tsx:241` — already passes `kind=coach` (verify search prop)
- `src/routes/profile.edit.tsx:734` — “New” button in *My organizations* → `/teams/create` (no kind)
- `src/routes/profile.edit.tsx:743` — empty‑state card → `/teams/create` (no kind)

## Changes

1. **`src/routes/_tabs.teams.tsx`** — add `search={{ kind: "team" }}` to the `+` link so the teams tab always creates a team.
2. **`src/routes/_tabs.trainers.tsx`** — confirm the `+` link passes `search={{ kind: "coach" }}` (add if missing).
3. **`src/routes/profile.edit.tsx`** — the “My organizations” section is generic, so replace each bare `/teams/create` link with a small two‑button chooser rendered inline (Team → `kind=team`, Trainer → `kind=coach`):
   - The section header `right` slot: swap the single “+ New” link for two compact chips “+ Team” and “+ Trainer”.
   - The empty‑state card: swap the single dashed link for a card containing two side‑by‑side CTAs (“Start a team” / “Start a trainer profile”), each linking to the correct `kind`.
4. **`src/routes/teams.create.tsx`** — retire step 0:
   - Drop `"Type"` from `STEPS` so the wizard is `["Identity", "Details", "Branding"]`.
   - Default `kind` from the URL; when neither `team` nor `coach` is provided, default to `team` and immediately `nav({ to: "/teams/create", search: { kind: "team" }, replace: true })` so the URL stays canonical (no silent bare `/teams/create` state).
   - Initial `step` becomes `0` (Identity) unconditionally; remove the `initialKind ? 1 : 0` branch and any Back/Cancel logic tied to the picker step.
   - Delete the JSX + handlers that rendered the Type step and its picker cards.
5. **Verification** — after edits: `rg "teams/create" src -g '!routeTree.gen.ts'` shows every remaining link carries a `search={{ kind: ... }}`, and manually opening `/teams/create` bare redirects to `?kind=team` on Identity.

## Out of scope

- The `/create` (host a game) route — that's a separate, still‑used flow.
- Any redesign of the wizard beyond removing step 0.
