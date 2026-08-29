/**
 * Reel style preferences — the athlete's editing vibe, pacing, and overlay
 * theme, chosen *before* the AI generates a highlight.
 *
 * Pure module: safe to import from the browser (the preferences panel) and from
 * the server pipeline (which turns them into prompt directives), so both sides
 * always speak about styles with the exact same wording.
 */

export type ReelVibe = "hype" | "cinematic" | "broadcast" | "documentary";
export type ReelPacing = "punchy" | "balanced" | "slowburn";
export type ReelOverlayTheme = "scoreboard" | "minimal" | "bold" | "retro" | "none";

export type ReelStylePrefs = {
  vibe: ReelVibe;
  pacing: ReelPacing;
  overlayTheme: ReelOverlayTheme;
};

export const DEFAULT_REEL_STYLE: ReelStylePrefs = {
  vibe: "hype",
  pacing: "balanced",
  overlayTheme: "scoreboard",
};

type Option<T extends string> = {
  value: T;
  label: string;
  blurb: string;
  /** Directive handed to the AI so every step edits in the chosen style. */
  directive: string;
};

export const VIBE_OPTIONS: Option<ReelVibe>[] = [
  {
    value: "hype",
    label: "Hype",
    blurb: "Loud, social-first energy",
    directive:
      "Editing vibe: HYPE — high-energy social edit. Lead with the biggest moment, punchy exclamatory copy, 1-2 emoji allowed.",
  },
  {
    value: "cinematic",
    label: "Cinematic",
    blurb: "Slower, dramatic, film-like",
    directive:
      "Editing vibe: CINEMATIC — filmic and dramatic. Hold on build-up before the payoff, restrained poetic copy, no emoji.",
  },
  {
    value: "broadcast",
    label: "Broadcast",
    blurb: "Play-by-play announcer feel",
    directive:
      "Editing vibe: BROADCAST — TV highlight package. Announcer-style calls, sport-specific terminology, factual tone.",
  },
  {
    value: "documentary",
    label: "Documentary",
    blurb: "Grounded, story-driven",
    directive:
      "Editing vibe: DOCUMENTARY — grounded storytelling. Context first, calm human voice, no hype language or emoji.",
  },
];

export const PACING_OPTIONS: Option<ReelPacing>[] = [
  {
    value: "punchy",
    label: "Punchy",
    blurb: "Short cuts, under ~12s",
    directive:
      "Pacing: PUNCHY — 2 to 3 segments, each roughly 1-3 seconds, total under 12 seconds. Favor quick pace, minimal slow motion.",
  },
  {
    value: "balanced",
    label: "Balanced",
    blurb: "Mixed cuts, ~15-20s",
    directive:
      "Pacing: BALANCED — 3 to 4 segments totalling roughly 15-20 seconds, mixing normal pace with one slow-motion beat on the key play.",
  },
  {
    value: "slowburn",
    label: "Slow burn",
    blurb: "Longer holds, ~20-25s",
    directive:
      "Pacing: SLOW BURN — 2 to 4 longer segments totalling roughly 20-25 seconds, using hold and slowmo paces to let moments breathe.",
  },
];

export const OVERLAY_THEME_OPTIONS: Option<ReelOverlayTheme>[] = [
  {
    value: "scoreboard",
    label: "Scoreboard",
    blurb: "Stat-line style cards",
    directive:
      "Overlay theme: SCOREBOARD — short stat-line style cards (play name, sport term, moment label). Never invent scores or numbers.",
  },
  {
    value: "minimal",
    label: "Minimal",
    blurb: "One or two clean words",
    directive:
      "Overlay theme: MINIMAL — at most two words per card, lowercase, no punctuation or emoji.",
  },
  {
    value: "bold",
    label: "Bold caps",
    blurb: "ALL-CAPS callouts",
    directive:
      "Overlay theme: BOLD CAPS — ALL-CAPS callouts of 3 words or fewer, one exclamation max across the whole set.",
  },
  {
    value: "retro",
    label: "Retro",
    blurb: "Old-school broadcast chyron",
    directive:
      "Overlay theme: RETRO — old-school broadcast chyron wording, title-case, no emoji.",
  },
  {
    value: "none",
    label: "No overlays",
    blurb: "Skip on-screen text",
    directive: "Overlay theme: NONE — the athlete does not want on-screen text cards; return an empty overlays array.",
  },
];

function pick<T extends string>(opts: Option<T>[], value: unknown, fallback: T): T {
  return opts.some((o) => o.value === value) ? (value as T) : fallback;
}

/** Accepts anything (URL/JSON/DB row) and returns a valid preferences object. */
export function normalizeReelStyle(input: unknown): ReelStylePrefs {
  const raw = (input ?? {}) as Record<string, unknown>;
  return {
    vibe: pick(VIBE_OPTIONS, raw.vibe, DEFAULT_REEL_STYLE.vibe),
    pacing: pick(PACING_OPTIONS, raw.pacing, DEFAULT_REEL_STYLE.pacing),
    overlayTheme: pick(
      OVERLAY_THEME_OPTIONS,
      raw.overlayTheme ?? raw.overlay_theme,
      DEFAULT_REEL_STYLE.overlayTheme,
    ),
  };
}

const label = <T extends string>(opts: Option<T>[], value: T) =>
  opts.find((o) => o.value === value)?.label ?? value;

/** "Hype · Balanced · Scoreboard overlays" — the one-line summary used in the UI. */
export function reelStyleSummary(prefs: ReelStylePrefs): string {
  const p = normalizeReelStyle(prefs);
  const overlay =
    p.overlayTheme === "none"
      ? "No overlays"
      : `${label(OVERLAY_THEME_OPTIONS, p.overlayTheme)} overlays`;
  return `${label(VIBE_OPTIONS, p.vibe)} · ${label(PACING_OPTIONS, p.pacing)} · ${overlay}`;
}

const directive = <T extends string>(opts: Option<T>[], value: T) =>
  opts.find((o) => o.value === value)?.directive ?? "";

/**
 * The prompt directives for the chosen style, split by what each pipeline step
 * actually needs. Every line is safe to append to a system prompt as-is.
 */
export function reelStyleDirectives(input: unknown) {
  const p = normalizeReelStyle(input);
  return {
    prefs: p,
    summary: reelStyleSummary(p),
    vibe: directive(VIBE_OPTIONS, p.vibe),
    pacing: directive(PACING_OPTIONS, p.pacing),
    overlay: directive(OVERLAY_THEME_OPTIONS, p.overlayTheme),
    /** Copy-writing steps (title/caption/hashtags/coach package). */
    copy: [directive(VIBE_OPTIONS, p.vibe), directive(OVERLAY_THEME_OPTIONS, p.overlayTheme)].join(
      " ",
    ),
    /** Cut-list step. */
    edit: [directive(VIBE_OPTIONS, p.vibe), directive(PACING_OPTIONS, p.pacing)].join(" "),
  };
}

const STORAGE_KEY = "reel-style-prefs.v1";

/** Last style the athlete picked, so new uploads keep their preferred look. */
export function loadReelStyle(): ReelStylePrefs {
  if (typeof window === "undefined") return DEFAULT_REEL_STYLE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeReelStyle(JSON.parse(raw)) : DEFAULT_REEL_STYLE;
  } catch {
    return DEFAULT_REEL_STYLE;
  }
}

export function saveReelStyle(prefs: ReelStylePrefs) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeReelStyle(prefs)));
  } catch {
    // Storage full or blocked — the in-memory choice still applies to this upload.
  }
}
