## Premium Dark Color Scheme — "Midnight Court"

Replace the current Court Neon (dark navy + electric lime + hot coral) with a more premium, editorial dark palette anchored in deep obsidian blacks, a refined cyan-teal primary, and a warm amber secondary. Status colors get consistent, purpose-built tokens used across the app.

### New palette

- **Background** obsidian near-black with a subtle blue undertone: `oklch(0.13 0.015 250)`
- **Surface / Surface-2** layered charcoals: `oklch(0.17 0.018 250)` / `oklch(0.21 0.02 250)`
- **Foreground** soft warm white: `oklch(0.97 0.005 90)`
- **Muted foreground** slate: `oklch(0.68 0.015 250)`
- **Primary — Aurora Teal** `oklch(0.78 0.14 195)` (cool, premium accent for CTAs, active states, ring)
- **Secondary — Champagne Amber** `oklch(0.82 0.12 75)` (used where "coral" is today: highlights, badges, hero glow)
- **Borders** `oklch(1 0 0 / 7%)`, inputs `oklch(1 0 0 / 10%)`

### Consistent status tokens (new)

Added as first-class semantic tokens so every screen uses the same colors:

- `--success` `oklch(0.76 0.15 155)` (emerald) + `--success-foreground`
- `--warning` `oklch(0.82 0.14 82)` (amber) + `--warning-foreground`
- `--info` `oklch(0.75 0.12 230)` (sky) + `--info-foreground`
- `--destructive` refined to `oklch(0.65 0.22 22)` (garnet) + `--destructive-foreground`

Exposed through `@theme inline` as `--color-success`, `--color-warning`, `--color-info` so utilities like `bg-success`, `text-warning`, `border-info` work anywhere.

### Gradients & glows (refreshed)

- `--gradient-hero`: teal + amber radials over obsidian
- `--gradient-primary`: teal → deeper teal
- `--gradient-secondary`: amber → rose-gold
- `--shadow-glow-primary` / `--shadow-glow-secondary` replace the lime/coral glows

### Backwards-compatible aliases

To avoid touching every component that references `--lime` / `--coral` / `.text-lime` / `.bg-lime-gradient` / `.glow-lime` etc., keep the token names but repoint them:

- `--lime` → primary (Aurora Teal)
- `--coral` → secondary (Champagne Amber)
- `.bg-lime-gradient` → `--gradient-primary`
- `.bg-coral-gradient` → `--gradient-secondary`
- `.glow-lime` → `--shadow-glow-primary`
- `.glow-coral` → `--shadow-glow-secondary`
- `.text-lime` / `.text-coral` / `.ring-lime` repoint to new values

This means only `src/styles.css` changes; every existing component visually adopts the new palette automatically.

### Light theme

Update `html.light` block in parallel: warm off-white background, teal primary, amber secondary, matching status tokens, so the light opt-in stays consistent.

### Files touched

- `src/styles.css` — palette, status tokens, gradients, glows, theme mappings, light theme (only file)

### Out of scope

- No component/JSX changes
- No layout, typography, or spacing changes
- No new pages or logic
