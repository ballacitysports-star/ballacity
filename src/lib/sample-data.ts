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

const SPORT_ASSET_RE = /\/assets\/sport-([a-z]+)[-.][^/]*$/;

/**
 * Covers saved with a built-in sport image store its bundled URL, which
 * includes a content hash. When the artwork is updated that hash changes and
 * the saved URL would 404, so map any bundled sport image back to the
 * current one. Other URLs pass through unchanged.
 */
export function resolveSportAsset<T extends string | null | undefined>(url: T): T {
  if (!url) return url;
  const m = SPORT_ASSET_RE.exec(url.split("?")[0]);
  if (!m) return url;
  const sport = (Object.keys(sportImage) as Sport[]).find((s) => s.toLowerCase() === m[1]);
  return (sport ? sportImage[sport] : url) as T;
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
  avatar: string; // initials
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

const daysAgo = (d: number) => new Date(now - d * 86400_000).toISOString();
const inDays = (d: number) => new Date(now + d * 86400_000).toISOString();

export const ORGS: Org[] = [
  {
    id: "t-eastside-elite",
    kind: "team",
    name: "Eastside Elite",
    handle: "@eastsideelite",
    tagline: "Brooklyn-bred. Run-and-gun basketball since 2019.",
    city: "Brooklyn, NY",
    founded: 2019,
    sports: ["Basketball"],
    verified: true,
    cover: sportImage.Basketball,
    avatar: "EE",
    accent: "#a3ff12",
    followers: 2840,
    roster: 14,
    bio: "Semi-competitive men's basketball squad. We run summer league at Dyckman and host weekly open runs. Always scouting versatile wings and switchable bigs.",
    achievements: [
      "2024 Dyckman Summer Finalist",
      "2023 NYC Pro-Am · 3rd",
      "Back-to-back EBC champs",
    ],
    league: "Dyckman Summer League · Div 1",
    record: { w: 18, l: 4 },
    homeCourt: "Tompkins Square Courts",
    staff: [
      { name: "Marcus Lee", role: "Head Coach", avatar: "ML" },
      { name: "Dre Coleman", role: "GM", avatar: "DC" },
      { name: "Riley Chen", role: "Captain", avatar: "RC" },
    ],
    upcoming: ["g1", "g8"],
    posts: [
      {
        id: "p1",
        kind: "tryout",
        title: "Open Tryouts · Summer Roster",
        body: "Looking for 3 spots: stretch four, combo guard, defensive wing. Two-day evaluation, full scrimmage on day two. NTRP-style ranking shared after.",
        date: inDays(6),
        postedAt: daysAgo(1),
        location: "Tompkins Square Courts",
        spots: { taken: 22, max: 40 },
        price: 0,
        rsvps: 22,
        pinned: true,
      },
      {
        id: "p2",
        kind: "pickup",
        title: "Friday Night Run · Open Invite",
        body: "Weekly open run. All Eastside members + 4 guest spots. Winners stay on, games to 11.",
        date: inHours(3),
        postedAt: daysAgo(2),
        location: "Tompkins Square Courts",
        spots: { taken: 8, max: 12 },
        price: 0,
        rsvps: 31,
      },
      {
        id: "p3",
        kind: "recap",
        title: "Recap: Dyckman QF win 78-71",
        body: "Riley dropped 24 with 6 dimes. Defensive stand in the final 90 seconds sealed it. Highlights drop tomorrow.",
        date: daysAgo(3),
        postedAt: daysAgo(3),
        rsvps: 412,
      },
    ],
  },
  {
    id: "t-fc-mosaic",
    kind: "team",
    name: "FC Mosaic",
    handle: "@fcmosaic",
    tagline: "Co-ed 7v7 soccer. Every continent, one squad.",
    city: "Manhattan, NY",
    founded: 2021,
    sports: ["Soccer"],
    verified: true,
    cover: sportImage.Soccer,
    avatar: "FM",
    accent: "#7df9c1",
    followers: 1560,
    roster: 22,
    bio: "Inclusive co-ed Sunday league side. Tactical, technical, fun. We run skills sessions before each match and welcome all skill levels in our open pickups.",
    achievements: ["2024 Cosmopolitan League · Promoted", "Fair Play Award 2024"],
    league: "Cosmopolitan Soccer League · Div 3",
    record: { w: 12, l: 6 },
    homeCourt: "Pier 40 Turf",
    staff: [
      { name: "Ana García", role: "Player-Coach", avatar: "AG" },
      { name: "Lukas Vidal", role: "Captain", avatar: "LV" },
    ],
    upcoming: ["g2"],
    posts: [
      {
        id: "p4",
        kind: "tryout",
        title: "Roster Trial · 2 Spots Open",
        body: "Need a CDM and a wide forward. 60 min skills, 30 min small-sided. Bring boots + both shirts.",
        date: inDays(4),
        postedAt: daysAgo(2),
        location: "Pier 40 · Field 4",
        spots: { taken: 9, max: 16 },
        price: 5,
        rsvps: 9,
        pinned: true,
      },
      {
        id: "p5",
        kind: "clinic",
        title: "Free Skills Clinic · First Touch",
        body: "60 minutes of receiving, turning, and 1v1. Open to all FC Mosaic followers.",
        date: inDays(2),
        postedAt: daysAgo(1),
        location: "Pier 40 Turf",
        spots: { taken: 14, max: 20 },
        price: 0,
        rsvps: 14,
      },
      {
        id: "p6",
        kind: "announcement",
        title: "We're promoted to Div 2!",
        body: "Massive thanks to everyone who came out this season. Spring squad announcement Friday.",
        date: daysAgo(5),
        postedAt: daysAgo(5),
        rsvps: 188,
      },
    ],
  },
  {
    id: "c-jordan-kim",
    kind: "coach",
    name: "Trainer Jordan Kim",
    handle: "@coachjordan",
    tagline: "USATF L2 endurance coach · marathon · 5K specialist",
    city: "Williamsburg, NY",
    founded: 2017,
    sports: ["Running"],
    verified: true,
    cover: sportImage.Running,
    avatar: "JK",
    accent: "#ff3d68",
    followers: 4210,
    roster: 0,
    bio: "Helping recreational runners break 20 in the 5K and sub-3:30 in the marathon. Data-driven blocks, weekly group sessions, video stride analysis.",
    achievements: ["100+ athletes coached", "USATF Level 2", "2x NYC Marathon pacer"],
    credentials: ["USATF Level 2", "RRCA Certified", "Pose Method L1"],
    ratePerHour: 75,
    rating: 4.9,
    reviews: 86,
    upcoming: ["g5"],
    posts: [
      {
        id: "p7",
        kind: "pickup",
        title: "Threshold Tuesday · 5K Tempo",
        body: "Weekly tempo workout. 2 mile warmup → 5K @ threshold → 1 mile cool. All paces welcome, groups by feel.",
        date: inHours(45),
        postedAt: daysAgo(1),
        location: "McCarren Park Track",
        spots: { taken: 14, max: 30 },
        price: 0,
        rsvps: 64,
        pinned: true,
      },
      {
        id: "p8",
        kind: "clinic",
        title: "Form Lab · Cadence & Foot Strike",
        body: "Bring shoes you race in. We'll video at 240fps and break down stride mechanics on the spot.",
        date: inDays(8),
        postedAt: daysAgo(2),
        location: "Brooklyn Bridge Park · Pier 2",
        spots: { taken: 6, max: 10 },
        price: 35,
        rsvps: 6,
      },
      {
        id: "p9",
        kind: "announcement",
        title: "Spring Marathon Block opens",
        body: "16-week structured plan, weekly check-ins, race-day strategy. 8 spots, opens Monday 9am.",
        date: daysAgo(2),
        postedAt: daysAgo(2),
        rsvps: 142,
      },
    ],
  },
  {
    id: "c-priya-n",
    kind: "coach",
    name: "Trainer Priya Nair",
    handle: "@coachpriya",
    tagline: "USAV-certified volleyball coach · setters & DS specialist",
    city: "Chelsea, NY",
    founded: 2019,
    sports: ["Volleyball"],
    verified: true,
    cover: sportImage.Volleyball,
    avatar: "PN",
    accent: "#ffd166",
    followers: 1820,
    roster: 0,
    bio: "Former NCAA D2 setter coaching adult league players. Specialize in setter footwork, libero reads, and pre-game serve-receive drills.",
    achievements: ["NCAA D2 All-Conference", "USAV CAP I", "Chelsea Open MVP 2022"],
    credentials: ["USAV CAP I", "Art of Coaching alum"],
    ratePerHour: 90,
    rating: 5.0,
    reviews: 41,
    upcoming: ["g4"],
    posts: [
      {
        id: "p10",
        kind: "clinic",
        title: "Setter Mechanics · Small Group",
        body: "90 min, max 6 setters. Footwork ladder, hand contact, decision drills with live blockers.",
        date: inDays(3),
        postedAt: daysAgo(1),
        location: "Chelsea Piers · Field House",
        spots: { taken: 4, max: 6 },
        price: 45,
        rsvps: 4,
        pinned: true,
      },
      {
        id: "p11",
        kind: "pickup",
        title: "Indoor 6s · League Warmup",
        body: "Higher-level scrimmage. Bring knee pads + court shoes. 12 spots.",
        date: inHours(30),
        postedAt: daysAgo(2),
        location: "Chelsea Piers · Field House",
        spots: { taken: 9, max: 12 },
        price: 15,
        rsvps: 24,
      },
    ],
  },
  {
    id: "t-westside-paddles",
    kind: "team",
    name: "Westside Paddles",
    handle: "@wsidepaddles",
    tagline: "Pickleball collective · ladder + tournaments",
    city: "Upper West, NY",
    founded: 2022,
    sports: ["Pickleball"],
    verified: false,
    cover: sportImage.Pickleball,
    avatar: "WP",
    accent: "#c8ff5b",
    followers: 980,
    roster: 36,
    bio: "Weekly open play + a monthly DUPR-tracked ladder. Doubles partners matched by rating. New paddles always welcome.",
    achievements: ["DUPR Verified Club", "NYC Open Round of 16 (2024)"],
    league: "Manhattan Pickleball Ladder",
    record: { w: 0, l: 0 },
    homeCourt: "Riverside Courts · 96th",
    staff: [
      { name: "Sam Ortega", role: "Ladder Director", avatar: "SO" },
      { name: "Devon Park", role: "Open Play Lead", avatar: "DP" },
    ],
    upcoming: ["g3", "g6"],
    posts: [
      {
        id: "p12",
        kind: "pickup",
        title: "Open Play Round Robin",
        body: "Beginner-friendly round robin. Paddles available. Rotate every 11 points.",
        date: inHours(6),
        postedAt: daysAgo(1),
        location: "Brooklyn Bridge Park · Court 4",
        spots: { taken: 6, max: 8 },
        price: 0,
        rsvps: 12,
        pinned: true,
      },
      {
        id: "p13",
        kind: "tryout",
        title: "Ladder Tryouts · 3.5+ DUPR",
        body: "Trying to add 8 players to the spring ladder. Sign up + bring proof of DUPR or play 2 evaluation games.",
        date: inDays(10),
        postedAt: daysAgo(3),
        location: "Riverside Courts · 96th",
        spots: { taken: 5, max: 16 },
        price: 10,
        rsvps: 5,
      },
    ],
  },
];

export const POST_KIND_META: Record<PostKind, { label: string; emoji: string; color: string }> = {
  tryout: { label: "Tryout", emoji: "🎯", color: "coral" },
  pickup: { label: "Pickup", emoji: "🏃", color: "lime" },
  clinic: { label: "Clinic", emoji: "🧠", color: "lime" },
  announcement: { label: "Announcement", emoji: "📣", color: "muted" },
  recap: { label: "Recap", emoji: "🎬", color: "muted" },
};
