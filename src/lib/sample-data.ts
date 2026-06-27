import soccerImg from "@/assets/sport-soccer.jpg";
import pickleballImg from "@/assets/sport-pickleball.jpg";
import volleyballImg from "@/assets/sport-volleyball.jpg";
import runningImg from "@/assets/sport-running.jpg";
import tennisImg from "@/assets/sport-tennis.jpg";
import heroImg from "@/assets/hero-court.jpg";

export type Sport =
  | "Basketball" | "Soccer" | "Pickleball" | "Volleyball" | "Tennis"
  | "Flag Football" | "Baseball" | "Softball" | "Running";

export const SPORTS: { name: Sport; emoji: string; color: string }[] = [
  { name: "Basketball", emoji: "🏀", color: "#ff8a3d" },
  { name: "Soccer", emoji: "⚽", color: "#a3ff12" },
  { name: "Pickleball", emoji: "🥒", color: "#7df9c1" },
  { name: "Volleyball", emoji: "🏐", color: "#ffd166" },
  { name: "Tennis", emoji: "🎾", color: "#c8ff5b" },
  { name: "Flag Football", emoji: "🏈", color: "#ff6b35" },
  { name: "Baseball", emoji: "⚾", color: "#ffffff" },
  { name: "Softball", emoji: "🥎", color: "#ffe27a" },
  { name: "Running", emoji: "🏃", color: "#ff3d68" },
];

export type Game = {
  id: string;
  sport: Sport;
  title: string;
  host: { name: string; username: string; avatar: string; rating: number };
  hostUserId?: string;  // auth user id of the host (locks ownership)
  date: string;       // ISO
  duration: string;   // "90 min"
  location: string;
  neighborhood: string;
  distanceMi: number;
  lat: number; lng: number;   // pseudo coords for faux map (0-100)
  maxPlayers: number;
  joined: number;
  skill: "All Levels" | "Beginner" | "Intermediate" | "Advanced";
  price: number;          // 0 = free
  indoor: boolean;
  isPrivate: boolean;
  urgent?: boolean;
  trending?: boolean;
  image: string;
  description: string;
  equipment: string[];
};

export const HERO_IMAGE = heroImg;

const sportImage: Record<Sport, string> = {
  Basketball: heroImg,
  Soccer: soccerImg,
  Pickleball: pickleballImg,
  Volleyball: volleyballImg,
  Tennis: tennisImg,
  "Flag Football": soccerImg,
  Baseball: tennisImg,
  Softball: tennisImg,
  Running: runningImg,
};

export function imageFor(sport: Sport) {
  return sportImage[sport];
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

export const GAMES: Game[] = [
  {
    id: "g1", sport: "Basketball", title: "Friday Night Run · 5v5 Full Court",
    host: { name: "Marcus Lee", username: "@marcus", avatar: "ML", rating: 4.9 },
    date: inHours(3), duration: "120 min",
    location: "Tompkins Square Courts", neighborhood: "East Village",
    distanceMi: 0.8, lat: 62, lng: 48,
    maxPlayers: 10, joined: 8, skill: "Intermediate",
    price: 0, indoor: false, isPrivate: false, urgent: true, trending: true,
    image: heroImg,
    description: "Competitive but chill. We rotate teams every game to 11. Bring a light + dark shirt.",
    equipment: ["Reversible jersey", "Water"],
  },
  {
    id: "g2", sport: "Soccer", title: "Sunday Sunset 7v7",
    host: { name: "Ana García", username: "@anagk", avatar: "AG", rating: 4.8 },
    date: inHours(22), duration: "90 min",
    location: "Pier 40 Turf", neighborhood: "West Side",
    distanceMi: 1.6, lat: 30, lng: 62,
    maxPlayers: 14, joined: 11, skill: "All Levels",
    price: 8, indoor: false, isPrivate: false, trending: true,
    image: soccerImg,
    description: "Mixed-gender, all levels. $8 covers turf rental. Cleats recommended.",
    equipment: ["Cleats", "Shin guards"],
  },
  {
    id: "g3", sport: "Pickleball", title: "Open Play · Round Robin",
    host: { name: "Devon Park", username: "@devon", avatar: "DP", rating: 4.7 },
    date: inHours(6), duration: "75 min",
    location: "Brooklyn Bridge Park · Court 4", neighborhood: "DUMBO",
    distanceMi: 2.4, lat: 78, lng: 32,
    maxPlayers: 8, joined: 6, skill: "Beginner",
    price: 0, indoor: false, isPrivate: false,
    image: pickleballImg,
    description: "Beginner-friendly round robin. Paddles available if you don't have one.",
    equipment: ["Paddle (optional)"],
  },
  {
    id: "g4", sport: "Volleyball", title: "Indoor 6s · League Warmup",
    host: { name: "Priya N.", username: "@priya", avatar: "PN", rating: 5.0 },
    date: inHours(30), duration: "120 min",
    location: "Chelsea Piers · Field House", neighborhood: "Chelsea",
    distanceMi: 1.1, lat: 45, lng: 70,
    maxPlayers: 12, joined: 9, skill: "Advanced",
    price: 15, indoor: true, isPrivate: false,
    image: volleyballImg,
    description: "Higher level scrimmage prepping for the spring league. Knee pads recommended.",
    equipment: ["Knee pads", "Court shoes"],
  },
  {
    id: "g5", sport: "Running", title: "Threshold Tuesday · 5K Tempo",
    host: { name: "Jordan Kim", username: "@jordan", avatar: "JK", rating: 4.9 },
    date: inHours(45), duration: "60 min",
    location: "McCarren Park Track", neighborhood: "Williamsburg",
    distanceMi: 3.2, lat: 22, lng: 18,
    maxPlayers: 30, joined: 14, skill: "Intermediate",
    price: 0, indoor: false, isPrivate: false, trending: true,
    image: runningImg,
    description: "2 mile warmup · 5K tempo @ 7:00 pace · 1 mile cool. Coffee after.",
    equipment: ["Running shoes"],
  },
  {
    id: "g6", sport: "Tennis", title: "Doubles Drill + Match Play",
    host: { name: "Sam Ortega", username: "@sam", avatar: "SO", rating: 4.6 },
    date: inHours(50), duration: "90 min",
    location: "Riverside Courts · 96th", neighborhood: "Upper West",
    distanceMi: 4.5, lat: 88, lng: 80,
    maxPlayers: 4, joined: 3, skill: "Intermediate",
    price: 12, indoor: false, isPrivate: false, urgent: true,
    image: tennisImg,
    description: "30 min of doubles drills then competitive sets. 3.5–4.0 NTRP.",
    equipment: ["Racquet", "Balls (bring 1 can)"],
  },
  {
    id: "g7", sport: "Flag Football", title: "Sunday Funday 5v5",
    host: { name: "Tyrese B.", username: "@ty", avatar: "TB", rating: 4.8 },
    date: inHours(72), duration: "120 min",
    location: "Sara D. Roosevelt Park", neighborhood: "Lower East Side",
    distanceMi: 1.9, lat: 55, lng: 25,
    maxPlayers: 10, joined: 7, skill: "All Levels",
    price: 0, indoor: false, isPrivate: false,
    image: soccerImg,
    description: "Casual flag football. Flags provided. Bring cleats or turfs.",
    equipment: ["Cleats", "Water"],
  },
  {
    id: "g8", sport: "Basketball", title: "Early Bird 3v3",
    host: { name: "Riley Chen", username: "@riley", avatar: "RC", rating: 4.7 },
    date: inHours(15), duration: "60 min",
    location: "West 4th Cage", neighborhood: "Greenwich Village",
    distanceMi: 0.4, lat: 50, lng: 50,
    maxPlayers: 6, joined: 5, skill: "Advanced",
    price: 0, indoor: false, isPrivate: false, urgent: true,
    image: heroImg,
    description: "Run before work. 3v3 to 15. Winners stay on.",
    equipment: ["Ball (we'll have one)"],
  },
];

export const ME = {
  name: "Alex Rivera",
  username: "@alex",
  avatar: "AR",
  bio: "Pickup hooper · weekend keeper · always down for one more game.",
  city: "New York, NY",
  stats: { played: 47, reliability: 98, sportsmanship: 4.9, friends: 124 },
  sports: [
    { name: "Basketball" as Sport, skill: 4.2 },
    { name: "Soccer" as Sport, skill: 3.8 },
    { name: "Pickleball" as Sport, skill: 3.5 },
  ],
  badges: ["Reliable Player", "Captain x12", "On a 9-game streak", "Verified"],
};

// ============= Teams & Coaches =============

export type OrgKind = "team" | "coach";
export type PostKind = "tryout" | "pickup" | "clinic" | "announcement" | "recap";

export type OrgPost = {
  id: string;
  kind: PostKind;
  title: string;
  body: string;
  date: string;           // ISO event date (or post date for announcements)
  postedAt: string;       // ISO
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
  handle: string;          // @handle
  tagline: string;
  city: string;
  founded: number;
  sports: Sport[];
  verified: boolean;
  cover: string;
  avatar: string;          // initials
  accent: string;          // hex
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
  upcoming: string[];      // game ids
  posts: OrgPost[];
};

const daysAgo = (d: number) => new Date(now - d * 86400_000).toISOString();
const inDays  = (d: number) => new Date(now + d * 86400_000).toISOString();

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
    cover: heroImg,
    avatar: "EE",
    accent: "#a3ff12",
    followers: 2840,
    roster: 14,
    bio: "Semi-competitive men's basketball squad. We run summer league at Dyckman and host weekly open runs. Always scouting versatile wings and switchable bigs.",
    achievements: ["2024 Dyckman Summer Finalist", "2023 NYC Pro-Am · 3rd", "Back-to-back EBC champs"],
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
        id: "p1", kind: "tryout", title: "Open Tryouts · Summer Roster",
        body: "Looking for 3 spots: stretch four, combo guard, defensive wing. Two-day evaluation, full scrimmage on day two. NTRP-style ranking shared after.",
        date: inDays(6), postedAt: daysAgo(1),
        location: "Tompkins Square Courts", spots: { taken: 22, max: 40 }, price: 0, rsvps: 22, pinned: true,
      },
      {
        id: "p2", kind: "pickup", title: "Friday Night Run · Open Invite",
        body: "Weekly open run. All Eastside members + 4 guest spots. Winners stay on, games to 11.",
        date: inHours(3), postedAt: daysAgo(2),
        location: "Tompkins Square Courts", spots: { taken: 8, max: 12 }, price: 0, rsvps: 31,
      },
      {
        id: "p3", kind: "recap", title: "Recap: Dyckman QF win 78-71",
        body: "Riley dropped 24 with 6 dimes. Defensive stand in the final 90 seconds sealed it. Highlights drop tomorrow.",
        date: daysAgo(3), postedAt: daysAgo(3),
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
    cover: soccerImg,
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
        id: "p4", kind: "tryout", title: "Roster Trial · 2 Spots Open",
        body: "Need a CDM and a wide forward. 60 min skills, 30 min small-sided. Bring boots + both shirts.",
        date: inDays(4), postedAt: daysAgo(2),
        location: "Pier 40 · Field 4", spots: { taken: 9, max: 16 }, price: 5, rsvps: 9, pinned: true,
      },
      {
        id: "p5", kind: "clinic", title: "Free Skills Clinic · First Touch",
        body: "60 minutes of receiving, turning, and 1v1. Open to all FC Mosaic followers.",
        date: inDays(2), postedAt: daysAgo(1),
        location: "Pier 40 Turf", spots: { taken: 14, max: 20 }, price: 0, rsvps: 14,
      },
      {
        id: "p6", kind: "announcement", title: "We're promoted to Div 2!",
        body: "Massive thanks to everyone who came out this season. Spring squad announcement Friday.",
        date: daysAgo(5), postedAt: daysAgo(5),
        rsvps: 188,
      },
    ],
  },
  {
    id: "c-jordan-kim",
    kind: "coach",
    name: "Coach Jordan Kim",
    handle: "@coachjordan",
    tagline: "USATF L2 endurance coach · marathon · 5K specialist",
    city: "Williamsburg, NY",
    founded: 2017,
    sports: ["Running"],
    verified: true,
    cover: runningImg,
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
        id: "p7", kind: "pickup", title: "Threshold Tuesday · 5K Tempo",
        body: "Weekly tempo workout. 2 mile warmup → 5K @ threshold → 1 mile cool. All paces welcome, groups by feel.",
        date: inHours(45), postedAt: daysAgo(1),
        location: "McCarren Park Track", spots: { taken: 14, max: 30 }, price: 0, rsvps: 64, pinned: true,
      },
      {
        id: "p8", kind: "clinic", title: "Form Lab · Cadence & Foot Strike",
        body: "Bring shoes you race in. We'll video at 240fps and break down stride mechanics on the spot.",
        date: inDays(8), postedAt: daysAgo(2),
        location: "Brooklyn Bridge Park · Pier 2", spots: { taken: 6, max: 10 }, price: 35, rsvps: 6,
      },
      {
        id: "p9", kind: "announcement", title: "Spring Marathon Block opens",
        body: "16-week structured plan, weekly check-ins, race-day strategy. 8 spots, opens Monday 9am.",
        date: daysAgo(2), postedAt: daysAgo(2),
        rsvps: 142,
      },
    ],
  },
  {
    id: "c-priya-n",
    kind: "coach",
    name: "Coach Priya Nair",
    handle: "@coachpriya",
    tagline: "USAV-certified volleyball coach · setters & DS specialist",
    city: "Chelsea, NY",
    founded: 2019,
    sports: ["Volleyball"],
    verified: true,
    cover: volleyballImg,
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
        id: "p10", kind: "clinic", title: "Setter Mechanics · Small Group",
        body: "90 min, max 6 setters. Footwork ladder, hand contact, decision drills with live blockers.",
        date: inDays(3), postedAt: daysAgo(1),
        location: "Chelsea Piers · Field House", spots: { taken: 4, max: 6 }, price: 45, rsvps: 4, pinned: true,
      },
      {
        id: "p11", kind: "pickup", title: "Indoor 6s · League Warmup",
        body: "Higher-level scrimmage. Bring knee pads + court shoes. 12 spots.",
        date: inHours(30), postedAt: daysAgo(2),
        location: "Chelsea Piers · Field House", spots: { taken: 9, max: 12 }, price: 15, rsvps: 24,
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
    cover: pickleballImg,
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
        id: "p12", kind: "pickup", title: "Open Play Round Robin",
        body: "Beginner-friendly round robin. Paddles available. Rotate every 11 points.",
        date: inHours(6), postedAt: daysAgo(1),
        location: "Brooklyn Bridge Park · Court 4", spots: { taken: 6, max: 8 }, price: 0, rsvps: 12, pinned: true,
      },
      {
        id: "p13", kind: "tryout", title: "Ladder Tryouts · 3.5+ DUPR",
        body: "Trying to add 8 players to the spring ladder. Sign up + bring proof of DUPR or play 2 evaluation games.",
        date: inDays(10), postedAt: daysAgo(3),
        location: "Riverside Courts · 96th", spots: { taken: 5, max: 16 }, price: 10, rsvps: 5,
      },
    ],
  },
];

export const POST_KIND_META: Record<PostKind, { label: string; emoji: string; color: string }> = {
  tryout:       { label: "Tryout",       emoji: "🎯", color: "coral" },
  pickup:       { label: "Pickup",       emoji: "🏃", color: "lime"  },
  clinic:       { label: "Clinic",       emoji: "🧠", color: "lime"  },
  announcement: { label: "Announcement", emoji: "📣", color: "muted" },
  recap:        { label: "Recap",        emoji: "🎬", color: "muted" },
};

