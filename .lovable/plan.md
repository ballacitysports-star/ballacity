In `src/routes/_tabs.create.tsx`, the Host-as picker labels orgs as "Club" / "Club / gym". Update the affiliation label helpers so orgs display as "Gym":

- `affiliationLabel`: return `"Gym"` for `source === "org"` (was `"Club / gym"`)
- `affiliationShortLabel`: return `"Gym"` for `source === "org"` (was `"Club"`)

Team and Trainer labels are unchanged.