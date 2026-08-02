# Revert profile banner to full-bleed 176px with heavy fade

Bring back the earlier banner treatment on both my profile and public player profiles: the image spans the full width of the screen with no side gutters or rounded corners, stands 176px tall, and fades heavily into the page background at the bottom so the avatar and name sit over the fade instead of on a hard edge.

## What changes

- Banner container: full-bleed (no horizontal padding, no rounded corners, no top padding), fixed 176px height instead of the current 6:1 rounded card.
- Heavy bottom fade: a gradient overlay from transparent at the top to the page background at the bottom, strong enough that the lower third of the image reads as background.
- Keep the top-right overlay slot (settings gear on my profile, back button on public profiles) positioned over the banner, nudged to respect safe spacing.
- Identity block below keeps its current spacing so the avatar/name/meta/pills layout is unchanged.
- No-banner case keeps a plain surface block of the same height so layout does not jump.

## Technical detail

Single file: `src/components/profile/ProfileChannelHeader.tsx`. Replace the `px-3 pt-3` wrapper + `aspect-[6/1] ... rounded-xl` inner div with a full-bleed `relative h-44 w-full overflow-hidden bg-surface` block, and add an absolutely positioned gradient div using the semantic background token (`bg-gradient-to-b from-transparent via-background/60 to-background`). Both `src/routes/_tabs.profile.tsx` and `src/routes/players.$userId.tsx` consume this component, so they inherit the change with no edits.

Verification: typecheck plus Playwright screenshots of `/profile` and a public player page at mobile and desktop widths to confirm the fade strength and that the overlay button stays legible.
