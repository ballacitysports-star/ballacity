import pickleballCover from "@/assets/sport-pickleball.jpg";
import basketballCover from "@/assets/sport-basketball.jpg";
import soccerCover from "@/assets/sport-soccer.jpg";
import volleyballCover from "@/assets/sport-volleyball.jpg";
import tennisCover from "@/assets/sport-tennis.jpg";
import footballCover from "@/assets/sport-football.jpg";
import baseballCover from "@/assets/sport-baseball.jpg";
import softballCover from "@/assets/sport-softball.jpg";
import runningCover from "@/assets/sport-running.jpg";
import { earnedBadgeIds, makeBadgeStats, type BadgeStats } from "@/lib/badges";

export type Sport =
  | "Baseball"
  | "Basketball"
  | "Football"
  | "Pickleball"
  | "Running"
  | "Soccer"
  | "Softball"
  | "Tennis"
  | "Volleyball";

export const SPORTS: { name: Sport; emoji: string; color: string }[] = [
  { name: "Baseball", emoji: "⚾", color: "#ffffff" },
  { name: "Basketball", emoji: "🏀", color: "#ff8a3d" },
  { name: "Football", emoji: "🏈", color: "#ff6b35" },
  { name: "Pickleball", emoji: "🏓", color: "#7df9c1" },
  { name: "Running", emoji: "🏃", color: "#ff3d68" },
  { name: "Soccer", emoji: "⚽", color: "#a3ff12" },
  { name: "Softball", emoji: "🥎", color: "#ffe27a" },
  { name: "Tennis", emoji: "🎾", color: "#c8ff5b" },
  { name: "Volleyball", emoji: "🏐", color: "#ffd166" },
];

// Common positions per sport. Users can pick one or more (or none).
export const POSITIONS_BY_SPORT: Record<Sport, string[]> = {
  Baseball: ["Pitcher", "Catcher", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH", "Utility"],
  Basketball: ["Point Guard", "Shooting Guard", "Small Forward", "Power Forward", "Center"],
  Football: ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S", "K/P"],
  Pickleball: ["Singles", "Doubles - Left", "Doubles - Right"],
  Running: ["Sprints", "Middle Distance", "Long Distance", "Trail", "Ultra"],
  Soccer: ["Goalkeeper", "Defender", "Midfielder", "Forward", "Winger"],
  Softball: ["Pitcher", "Catcher", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "Utility"],
  Tennis: ["Singles", "Doubles"],
  Volleyball: [
    "Setter",
    "Outside Hitter",
    "Opposite",
    "Middle Blocker",
    "Libero",
    "Defensive Specialist",
  ],
};

export type Game = {
  id: string;
  sport: Sport;
  title: string;
  host: { name: string; username: string; avatar: string; rating: number };
  hostUserId?: string; // auth user id of the host (locks ownership)
  date: string; // ISO
  duration: string; // "90 min"
  location: string;
  neighborhood: string;
  /**
   * Legacy/demo fallback distance. Real games leave this null — distance is
   * computed live from the viewer's location to the venue coordinates.
   */
  distanceMi?: number | null;
  /** Real venue latitude/longitude; null when the venue was never geocoded. */
  lat?: number | null;
  lng?: number | null;
  /** True for demo rows whose lat/lng are faux-map grid values, not real geo. */
  pseudoGeo?: boolean;
  maxPlayers: number;
  joined: number;
  /**
   * Skill level for the game. Either "All Levels", a legacy generic tier
   * (Beginner/Intermediate/Advanced) or one of the sport's real tiers, e.g.
   * "7v7 Competitive" or "College / Adult Competitive".
   */
  skill: string;
  price: number; // 0 = free
  indoor: boolean;
  isPrivate: boolean;
  /** Hidden from the public (by its host or a moderator); only set for people who may still see it. */
  hidden?: boolean;
  urgent?: boolean;
  trending?: boolean;
  image: string;
  description: string;
  equipment: string[];
  status?: "scheduled" | "in_progress" | "completed" | "cancelled";
  /** Set when the host called the game off. Blocks joins everywhere. */
  cancelledAt?: string | null;
  cancellationReason?: string | null;
  /** Set when the host closed the game out (attendance can be marked). */
  completedAt?: string | null;
  joinsClosed?: boolean;
  /** Minutes before start when signups close automatically. 0 = off. */
  signupCutoffMin?: number;
  /** Minutes before start after which a player's cancellation counts as late. 0 = off. */
  cancelCutoffMin?: number;
  /** Optional age requirement. Players outside it must be approved by the host. */
  minAge?: number | null;
  maxAge?: number | null;
  positionsNeeded?: Record<string, number>;
  teamId?: string;
  orgId?: string;
  /** Posted by the facility's owner/admins (vs. a community run tagged there). */
  orgOfficial?: boolean;
  /** Shared id linking sessions of one multi-day event. */
  seriesId?: string | null;
  /** Total sessions in the series (set when the feed collapses a series to one card). */
  seriesCount?: number;
  /** Exact end instant. Preferred over `duration` for length and status. */
  endsAt?: string | null;
  /** True when the game runs the whole day rather than a clock window. */
  allDay?: boolean;
  /** IANA zone the host scheduled in, e.g. "America/Chicago". */
  timezone?: string | null;
  /** Minimum players the host needs for the game to go ahead. 0 = no minimum. */
  minPlayers?: number;
  /** Whether players can queue for a spot once the game is full. */
  allowWaitlist?: boolean;
  /** Cancellation policy id: flexible | standard | strict | custom. */
  cancellationPolicy?: string | null;
  /** Host's own cancellation wording. */
  cancellationNotes?: string | null;
  /** Format, scoring, and house rules players must follow. */
  gameRules?: string | null;
};

// Simple default cover: a soft duotone gradient tuned to each sport's accent
// color, with the sport's emoji centered. Rendered as an inline SVG data URI
// so it needs no network round-trip and stays crisp at any size.
function makeDefaultCover(color: string, emoji: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 500'>
    <defs>
      <linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
        <stop offset='0%' stop-color='${color}' stop-opacity='0.85'/>
        <stop offset='100%' stop-color='#0b0f1a' stop-opacity='1'/>
      </linearGradient>
    </defs>
    <rect width='800' height='500' fill='#0b0f1a'/>
    <rect width='800' height='500' fill='url(%23g)'/>
    <text x='50%' y='54%' text-anchor='middle' font-size='220' font-family='Apple Color Emoji, Segoe UI Emoji, sans-serif'>${emoji}</text>
  </svg>`.replace(/\n\s+/g, "");
  return `data:image/svg+xml;utf8,${svg.replace(/#/g, "%23")}`;
}

const sportMeta: Record<Sport, { color: string; emoji: string }> = SPORTS.reduce(
  (acc, s) => {
    acc[s.name] = { color: s.color, emoji: s.emoji };
    return acc;
  },
  {} as Record<Sport, { color: string; emoji: string }>,
);

const sportImage: Record<Sport, string> = {
  Basketball: basketballCover,
  Soccer: soccerCover,
  Pickleball: pickleballCover,
  Volleyball: volleyballCover,
  Tennis: tennisCover,
  Football: footballCover,
  Baseball: baseballCover,
  Softball: softballCover,
  Running: runningCover,
};
// Fallback generator kept for any future sport without a photo cover.
void makeDefaultCover;

export const HERO_IMAGE = sportImage.Basketball;

export function imageFor(sport: Sport) {
  return sportImage[sport];
}

/** A sample photo for a sport name (any case), or the basketball hero when it is unknown or missing. */
export function sampleImageForSport(name: string | null | undefined): string {
  const sport = name ? sportByKey(name) : undefined;
  return sport ? sportImage[sport] : HERO_IMAGE;
}

const SPORT_ASSET_RE = /\/assets\/sport-([a-z]+)[-.][^/]*$/;
const PRESET_PREFIX = "preset:";

function sportByKey(key: string): Sport | undefined {
  return (Object.keys(sportImage) as Sport[]).find((s) => s.toLowerCase() === key.toLowerCase());
}

/**
 * Turns a saved cover/image value into something an <img> can show.
 *
 * Built-in sport covers are saved by name (`preset:basketball`, see
 * {@link toStoredCover}), so replacing the artwork never breaks a saved cover.
 * Older rows hold the bundled file's URL, which includes a content hash that
 * changes with the artwork and would 404, so those map back to the current
 * image too. Every other URL passes through unchanged.
 */
export function resolveSportAsset<T extends string | null | undefined>(url: T): T {
  if (!url) return url;
  if (url.startsWith(PRESET_PREFIX)) {
    const sport = sportByKey(url.slice(PRESET_PREFIX.length));
    return (sport ? sportImage[sport] : HERO_IMAGE) as T;
  }
  const m = SPORT_ASSET_RE.exec(url.split("?")[0]);
  if (!m) return url;
  const sport = sportByKey(m[1]);
  return (sport ? sportImage[sport] : url) as T;
}

/**
 * What to persist for a cover/image value: a built-in sport image becomes
 * `preset:<sport>`; uploaded images and any other URL are kept as they are.
 */
export function toStoredCover<T extends string | null | undefined>(url: T): T | string {
  if (!url || url.startsWith(PRESET_PREFIX)) return url;
  const m = SPORT_ASSET_RE.exec(url.split("?")[0]);
  const sport = m ? sportByKey(m[1]) : undefined;
  return sport ? `${PRESET_PREFIX}${sport.toLowerCase()}` : url;
}

// Pinned to start-of-UTC-day so SSR and client hydration produce identical
// ISO strings. Date.now() at module scope causes hydration mismatches because
// the server and client evaluate the module at different instants.
const now = (() => {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  return d.getTime();
})();
const inHours = (h: number) => new Date(now + h * 3600_000).toISOString();

// Real games come from the `hosted_games` table only. There is no demo/sample
// game data: shipping fake rows into the feed and map made the live app look
// populated with games nobody could actually attend.
export const GAMES: Game[] = [];

/** Sportsmanship trait tallies drawn from peer reviews. */
export type SportsmanshipTraits = {
  respectful: number;
  communicative: number;
  fairPlay: number;
  positive: number;
  onTime: number;
};

/** Reliability breakdown so completion screens can show more than a single number. */
export type ReliabilityBreakdown = {
  score: number; // 0–100 headline
  showUpRate: number; // % of RSVPs where the player actually showed
  onTimeRate: number; // % of shows that arrived on time
  lastMinuteCancels: number; // last 30 days
  currentStreak: number; // consecutive games shown on time
  longestStreak: number;
};

/** Per-sport entry with the rating system + tier used by that sport. */
export type MeSport = {
  name: Sport;
  system: "NTRP" | "DUPR" | "UTR" | "PACE" | "SELF";
  tier: string; // e.g. "3.5 NTRP", "Intermediate", "PACE 6.2"
  favorite?: boolean;
  gamesPlayed: number;
  winRate: number; // 0–1
};

const ME_STATS = {
  played: 47,
  reliability: 98,
  sportsmanship: 4.9,
  friends: 124,
  hosted: 12,
  endorsements: 63,
};

const ME_RELIABILITY = {
  score: 98,
  showUpRate: 0.98,
  onTimeRate: 0.94,
  lastMinuteCancels: 0,
  currentStreak: 9,
  longestStreak: 14,
} satisfies ReliabilityBreakdown;

const ME_SPORTSMANSHIP = {
  rating: 4.9,
  reviewCount: 38,
  traits: {
    respectful: 36,
    communicative: 31,
    fairPlay: 34,
    positive: 29,
    onTime: 33,
  } satisfies SportsmanshipTraits,
  quotes: [
    {
      author: "Jamie L.",
      body: "Always calls his own fouls. Great teammate.",
      sport: "Basketball" as Sport,
    },
    {
      author: "Priya S.",
      body: "On time, communicative, and hustles every play.",
      sport: "Soccer" as Sport,
    },
    {
      author: "Marcus T.",
      body: "Encourages everyone on the court, beginners included.",
      sport: "Pickleball" as Sport,
    },
  ],
};

/** Badge engine inputs for the demo profile — reliability + sportsmanship only. */
export const ME_BADGE_STATS: BadgeStats = makeBadgeStats({
  gamesPlayed: ME_STATS.played,
  hosted: ME_STATS.hosted,
  showUpRate: ME_RELIABILITY.showUpRate,
  onTimeRate: ME_RELIABILITY.onTimeRate,
  lastMinuteCancels: ME_RELIABILITY.lastMinuteCancels,
  currentStreak: ME_RELIABILITY.currentStreak,
  longestStreak: ME_RELIABILITY.longestStreak,
  daysSinceLastCancel: 180,
  sportsmanshipRating: ME_SPORTSMANSHIP.rating,
  reviewCount: ME_SPORTSMANSHIP.reviewCount,
  traits: ME_SPORTSMANSHIP.traits,
  verified: true,
});

export const ME = {
  name: "Alex Rivera",
  username: "@alex",
  avatar: "AR",
  bio: "Pickup hooper · weekend keeper · always down for one more game.",
  city: "New York, NY",
  stats: ME_STATS,
  reliability: ME_RELIABILITY,
  sportsmanship: ME_SPORTSMANSHIP,
  sports: [
    {
      name: "Basketball" as Sport,
      system: "SELF",
      tier: "Advanced",
      favorite: true,
      gamesPlayed: 24,
      winRate: 0.62,
    },
    {
      name: "Soccer" as Sport,
      system: "SELF",
      tier: "Intermediate+",
      favorite: true,
      gamesPlayed: 14,
      winRate: 0.57,
    },
    {
      name: "Pickleball" as Sport,
      system: "DUPR",
      tier: "3.5 DUPR",
      favorite: false,
      gamesPlayed: 9,
      winRate: 0.66,
    },
    {
      name: "Tennis" as Sport,
      system: "NTRP",
      tier: "3.0 NTRP",
      favorite: false,
      gamesPlayed: 5,
      winRate: 0.4,
    },
    {
      name: "Running" as Sport,
      system: "PACE",
      tier: "7:45/mi",
      favorite: false,
      gamesPlayed: 11,
      winRate: 0.0,
    },
  ] satisfies MeSport[],
  /** Derived from attendance reliability + sportsmanship, never from skill. */
  badges: earnedBadgeIds(ME_BADGE_STATS),

  recentActivity: [
    {
      kind: "played",
      label: "Sunday Run at Rucker",
      when: "2 days ago",
      sport: "Basketball" as Sport,
    },
    {
      kind: "hosted",
      label: "Pickleball open play",
      when: "5 days ago",
      sport: "Pickleball" as Sport,
    },
    { kind: "review", label: "Received a 5★ review", when: "1 week ago", sport: "Soccer" as Sport },
  ],
};

// ============= Teams & Coaches =============

export type OrgKind = "team" | "coach";
export type PostKind = "tryout" | "pickup" | "clinic" | "announcement" | "recap";
/**
 * What a team can post today. "pickup" is no longer one of them: a pickup game is
 * a game, hosted from Host a game and listed in the feed. It stays in `PostKind`
 * only so an old post of that kind can still be shown.
 */
export type TeamPostKind = Exclude<PostKind, "pickup">;

export type OrgPost = {
  id: string;
  kind: PostKind;
  title: string;
  body: string;
  date: string; // ISO event date (or post date for announcements)
  postedAt: string; // ISO
  location?: string;
  spots?: { taken: number; max: number };
  price?: number;
  rsvps?: number;
  pinned?: boolean;
  /** Cover image: an uploaded URL or a built-in cover saved by name. */
  imageUrl?: string;
  authorId?: string;
  /** Set only for the people who may see a hidden post: its author and the team's managers. */
  ownerHidden?: boolean;
  moderatorHidden?: boolean;
};

export type Org = {
  id: string;
  kind: OrgKind;
  name: string;
  handle: string; // @handle
  tagline: string;
  city: string;
  founded: number;
  sports: Sport[];
  verified: boolean;
  cover: string;
  /** What cards render: the logo URL when there is one, else the initials. */
  avatar: string;
  /** The uploaded logo, kept apart from the initials. */
  avatarUrl?: string;
  /** The team's own initials (never a URL); empty means use the name's. */
  avatarInitials?: string;
  accent: string; // hex
  followers: number;
  roster: number;
  bio: string;
  achievements: string[];
  // Coaches only
  credentials?: string[];
  ratePerHour?: number;
  rating?: number;
  reviews?: number;
  // Team only
  league?: string;
  record?: { w: number; l: number };
  homeCourt?: string;
  staff?: { name: string; role: string; avatar: string }[];
  // Both
  skillRange?: { min: number; max: number }; // 1=Beginner … 5=Pro
  // Sport-specific extensions (all optional)
  format?: string;
  formats?: string[];
  venues?: string[];
  venueAddresses?: string[];
  verifiedVenues?: string[];
  /** Google Place details per verified venue address (place_id, lat, lng). */
  venueGeo?: { address: string; placeId: string; lat: number; lng: number }[];
  primaryVenue?: string;
  cadence?: string;
  cadences?: string[];
  positionsNeeded?: Record<string, Record<string, number>>; // sport → position → count
  ratingSystem?: "NTRP" | "DUPR" | "UTR" | "PACE" | "SELF";
  ratingMin?: string;
  ratingMax?: string;
  distances?: string[];
  sessionTypes?: string[];
  /** Age groups a coach works with (see `lib/age-groups`). Empty = not specified. */
  ageGroups?: string[];
  /** IANA timezone the trainer's schedule is anchored to (e.g. "America/New_York"). */
  timezone?: string;
  /** Minutes before a session after which a player's cancellation counts as late. 0 = off. */
  cancelCutoffMin?: number;
  /** Refund rule for session fees (see lib/refund-policy). */
  refundRule?: string;
  lateRefundPct?: number;
  availabilitySlots?: {
    day: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
    start: string;
    end: string;
    venue?: string;
  }[];
  availabilityOverrides?: {
    date: string;
    closed?: boolean;
    windows?: { start: string; end: string; venue?: string }[];
  }[];
  availabilityRules?: {
    id: string;
    label?: string;
    weekdays: ("mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun")[];
    start: string;
    end: string;
    venue?: string;
    freq: "weekly" | "biweekly" | "monthly-nth";
    interval?: number;
    weekOfMonth?: (1 | 2 | 3 | 4 | "last")[];
    anchorDate: string;
    until?: string;
  }[];
  upcoming: string[]; // game ids
  posts: OrgPost[];
};

// Teams, coaches and gyms come from the database and nowhere else. This list used
// to hold invented ones, which showed up next to the real ones with made-up
// followers, records and rosters. org-store fills it in place.
export const ORGS: Org[] = [];

export const POST_KIND_META: Record<PostKind, { label: string; emoji: string; color: string }> = {
  tryout: { label: "Tryout", emoji: "🎯", color: "coral" },
  pickup: { label: "Pickup", emoji: "🏃", color: "lime" },
  clinic: { label: "Clinic", emoji: "🧠", color: "lime" },
  announcement: { label: "Announcement", emoji: "📣", color: "muted" },
  recap: { label: "Recap", emoji: "🎬", color: "muted" },
};
