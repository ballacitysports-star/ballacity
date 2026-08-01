# YouTube-style Profile & Settings

Restructure three screens to read like YouTube channel pages and YouTube's settings list: my profile, public player profiles, and Settings. The app's existing colors and fonts stay as they are — this is layout, density, and hierarchy work only.

## What changes

### My profile (`/profile`)

YouTube channel-page structure, top to bottom:

1. **Banner** — the existing cover image becomes a wide, short banner with rounded corners and side padding (YouTube crops its banner to a 6:1-ish strip), instead of today's full-bleed 176px block with a heavy fade.
2. **Identity block** — large avatar on the left, then a stacked text column: display name as a big bold line, then a single muted meta line combining handle, city, and counts (`@you · Austin · 24 followers · 12 games`), then bio truncated to one line with a tappable "...more" that expands. This replaces the current three-column followers/following/games stat strip and the separate reliability/sportsmanship/crew card grid; those numbers move into the meta line and the expanded description block.
3. **Description sheet** — tapping the truncated bio opens a bottom sheet ("About") holding full bio, links, class year, verified state, reliability / sportsmanship / crew stats, and the reputation badge. This is how YouTube keeps the header light.
4. **Action row** — pill buttons in a horizontal row: primary "Edit profile" (filled pill), then outline pills for "Reviews · n" and "Share". Left-aligned, not a 50/50 grid.
5. **Tabs** — YouTube channel tab bar: text labels (Games, Hosting, Requests, Reviews) that scroll horizontally, uppercase-ish medium weight, active tab marked by a 2px underline that sits directly under the label with no icons. Replaces the current 4-icon grid. Sticky behaviour is kept.
6. Tab bodies keep their existing content and logic; only the wrapping card chrome is flattened (no more heavy rounded-3xl surface cards inside tabs — YouTube uses flat rows on the page background).

Sign out / Security / Settings buttons floating over the banner get replaced by a single settings gear in the top-right of the banner (YouTube's pattern); sign-out lives in Settings, which already has it.

### Public player profile (`/players/$userId`)

Same header treatment so the two match: banner, avatar + name + muted meta line, one-line description with "...more" opening the About sheet, then a pill action row where the primary action is the follow button styled as YouTube's Subscribe pill (filled when not following, subtle grey "Following" when following), plus "Message" and the safety menu. Below that the same underlined text tab bar over the existing sections (Availability, Badges, Reviews, Orgs).

### Settings (`/settings`)

YouTube settings list style:

- Sticky top bar: back arrow + "Settings" title, thin bottom border.
- Account identity row at the top: avatar, display name, handle, chevron → Edit profile.
- Sections become plain grouped lists on the page background: a small section heading, then full-width rows separated by hairline dividers — no rounded card container, no per-row icon tile. Icon sits inline at 20px, muted; label on top, description beneath, chevron right.
- Theme and other inline toggles keep their switches but adopt the same row geometry.
- Onboarding details keeps its content, restyled as one of these flat groups.
- Sign out and Delete account become destructive-text rows at the bottom of the list rather than boxed buttons.

## Technical notes

- New shared components in `src/components/profile/`: `ProfileChannelHeader.tsx` (banner + avatar + meta line + truncated description + action slot), `ProfileAboutSheet.tsx`, and `ChannelTabs.tsx` (scrollable underlined text tabs). Both profile routes consume these so they can't drift.
- New `src/components/settings/SettingsRow.tsx` + `SettingsGroup.tsx` for the flat row/group geometry; `settings.tsx` keeps its existing `SECTIONS` data, queries, mutations, and dialogs untouched and just renders through them.
- All colors keep using existing semantic tokens (`surface`, `border`, `muted-foreground`, `primary`); no new palette values, no hardcoded hex.
- Tabs stay in component state as today, and the `req` search-param filter on profile requests is unchanged.
- No data model, query, or server-function changes.
