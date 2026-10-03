# Coach control over sharing tryout scores and notes

## What you get
On each tryout, the team owner, managers and coaches get two switches in **Run tryouts → Check-in & score**:
- **Share scores with players & parents**: on by default, because parents already see scores today.
- **Share coach notes with players & parents**: off by default, because notes are private today.

When a switch is on:
- **Parents** see their child's score and/or notes on the Guardian Dashboard (Tryouts section).
- **Players** see their own score and/or notes on the tryout sign-up page, under "Your result".

When a switch is off, that item isn't sent to players or parents at all. It isn't just hidden on screen. Rankings, other applicants' results and birth years stay staff-only no matter how the switches are set.

## Steps
1. Add two sharing settings to each tryout, with the defaults above.
2. Add the switches to the check-in screen, with a short note saying who will see the results.
3. Make the Guardian Dashboard show the score and notes only when the team shares them.
4. Add a "Your result" box to the tryout sign-up page for a signed-in applicant, following the same rules.
5. Check it end to end on the BallaCity 14U tryout: turn scores off, confirm the parent account no longer sees 5/10, then turn it back on.

## Technical details
- Migration: add `share_scores boolean not null default true` and `share_notes boolean not null default false` to `team_posts`. Only managers (`is_team_manager`) can update these, through a server function.
- `listChildrenActivity`: read the two settings and leave out `score`/`notes` unless they're turned on. The relationship is still checked through `guardian_children_overview`.
- New `getMyTryoutResult` server function (requires sign-in): returns the caller's own evaluation for a post, with fields removed according to the settings.
- `getTryoutResults` stays manager-only and doesn't change.
