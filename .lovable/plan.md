# Simplify the landing page

Goal: a calmer first screen with no made-up numbers.

## Remove all invented figures

These are placeholder statistics nobody supplied, and they currently appear as fact:

- The green "Live · 1,284 games this week" pill above the headline.
- The three-column row under the buttons: "48k players", "1.2k games / wk", "4.9★ host rating".
- The "Reliability 98%" floating card next to the phone image.
- The per-sport counts in the sports grid ("57 nearby" etc., generated from the sport's name).
- The "Marcus joined your game" floating card (a fake activity notification).

Nothing is replaced with a different number; the space simply closes up.

## Reduce clutter

- Headline, one short paragraph, and the two buttons stay as the top of the page.
- The phone preview stays, including its "Basketball" and "2 spots left" labels, since those read as a picture of the app rather than site statistics.
- The sports grid keeps the emoji and the sport name only.
- The six feature cards trim to four: join in seconds, real community, highlight reels, map-first discovery. (Skill-balanced teams and pro tools are cut to reduce the wall of cards.)
- Trending games, the closing call to action, and the footer stay unchanged.

## Untouched

No changes to data, accounts, or any other page. Trending still shows real games that people have hosted.

## Technical notes

Single file: `src/routes/index.tsx`. Delete the badge div, the stats `.map` block, the reliability and "Marcus joined" floating cards, and the count line inside the `SPORTS.map`; drop two entries from the features array. Remove any lucide icon import left unused (likely `Trophy`, `Sparkles`) so the build stays clean. Verify no horizontal overflow at 320-1280px afterwards.
