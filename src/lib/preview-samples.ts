/**
 * Static sample content for the signed-out tab previews.
 *
 * Everything here is invented and ships in the bundle. It must stay that way:
 * this file imports nothing from Supabase or a server function, so a signed-out
 * browser is never sent a real member's name, photo, roster or message. The
 * real page is simply never mounted for a signed-out visitor.
 *
 * Dates are worked out from today (in UTC, so a server and a browser agree), so
 * the samples always show upcoming days and never go stale.
 */

export type PreviewTab =
  "feed" | "players" | "teams" | "trainers" | "reels" | "messages" | "create" | "profile";

export type PreviewRow = {
  title: string;
  /** What and where, with the specific date and time where there is one. */
  detail: string;
  /** A made-up name or handle. */
  person?: string;
  /** Sport whose sample picture the row shows. */
  sport?: string;
  /** Short facts drawn as pills: open spots, price, or free time slots. */
  chips?: string[];
};

export type PreviewConfig = {
  title: string;
  subtitle: string;
  /** What the sign-up prompt promises, e.g. "See real games near you". */
  cta: string;
  /** A button the real page shows in its header (inert here). */
  headerAction?: string;
  /** What each row's button says on the real page (inert here). */
  rowAction?: string;
  /** Whether rows carry a person's or team's avatar. Defaults to true. */
  showAvatars?: boolean;
  rows?: PreviewRow[];
  /** Fields of a form page, drawn as inert inputs. */
  fields?: string[];
  /** A member-only section (roster, chat, messages), drawn in full. */
  locked?: { title: string; lines: string[] };
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** "Sat, Nov 1": the day `offset` days after `from`. */
export function sampleDay(offset: number, from: Date): string {
  const d = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + offset),
  );
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Days from `from` to the next given weekday (0 = Sunday); never today, so a sample is always ahead. */
export function daysUntilWeekday(weekday: number, from: Date): number {
  const diff = (weekday - from.getUTCDay() + 7) % 7;
  return diff === 0 ? 7 : diff;
}

const person = (n: number) => `Sample Person ${n}`;

function buildRows(now: Date) {
  /** "Sun, Nov 2" for the next given weekday. */
  const next = (weekday: number) => sampleDay(daysUntilWeekday(weekday, now), now);
  const SUN = 0;
  const MON = 1;
  const TUE = 2;
  const WED = 3;
  const THU = 4;
  const FRI = 5;
  const SAT = 6;

  const games: PreviewRow[] = [
    {
      title: "Sunday pickup basketball",
      sport: "Basketball",
      detail: `${next(SUN)} · 10:00 AM–12:00 PM · Sample Park, Court 2`,
      chips: ["6 of 10 spots open", "$5", "Intermediate"],
    },
    {
      title: "5-a-side soccer",
      sport: "Soccer",
      detail: `${next(SUN)} · 4:00 PM–5:30 PM · Sample Fields, Pitch B`,
      chips: ["3 of 10 spots open", "$8", "All levels"],
    },
    {
      title: "Open gym volleyball",
      sport: "Volleyball",
      detail: `${next(MON)} · 7:00 PM–9:00 PM · Sample Rec Center`,
      chips: ["8 of 12 spots open", "Free", "Beginner"],
    },
    {
      title: "Tennis doubles ladder",
      sport: "Tennis",
      detail: `${next(TUE)} · 6:30 PM–8:00 PM · Sample Courts, Court 3`,
      chips: ["2 of 4 spots open", "$10", "Intermediate"],
    },
    {
      title: "Flag football scrimmage",
      sport: "Football",
      detail: `${next(WED)} · 6:00 PM–7:30 PM · Sample Field`,
      chips: ["10 of 14 spots open", "$5", "All levels"],
    },
    {
      title: "Morning run club",
      sport: "Running",
      detail: `${next(THU)} · 6:30 AM–7:30 AM · Sample Trail, north gate`,
      chips: ["12 spots open", "Free", "5K pace"],
    },
    {
      title: "Pickleball round robin",
      sport: "Pickleball",
      detail: `${next(FRI)} · 5:30 PM–7:30 PM · Sample Courts, Court 1`,
      chips: ["4 of 12 spots open", "$6", "Beginner"],
    },
  ].map((r, i) => ({ ...r, person: `Hosted by ${person(i + 1)}` }));

  const players: PreviewRow[] = [
    {
      title: "Sample Player 1",
      sport: "Basketball",
      detail: "Basketball · Intermediate · Within 5 mi",
      chips: [`${next(SAT)} · 9:00–11:00 AM`, `${next(SUN)} · 4:00–6:00 PM`],
    },
    {
      title: "Sample Player 2",
      sport: "Soccer",
      detail: "Soccer · Advanced · Within 8 mi",
      chips: [`${next(TUE)} · 6:00–8:00 PM`, `${next(THU)} · 6:00–8:00 PM`],
    },
    {
      title: "Sample Player 3",
      sport: "Volleyball",
      detail: "Volleyball · Beginner · Within 3 mi",
      chips: [`${next(MON)} · 7:00–9:00 PM`, `${next(WED)} · 7:00–9:00 PM`],
    },
    {
      title: "Sample Player 4",
      sport: "Tennis",
      detail: "Tennis · Intermediate · Within 6 mi",
      chips: [`${next(SAT)} · 8:00–10:00 AM`, `${next(SUN)} · 8:00–10:00 AM`],
    },
    {
      title: "Sample Player 5",
      sport: "Pickleball",
      detail: "Pickleball · Beginner · Within 4 mi",
      chips: [`${next(FRI)} · 5:30–7:30 PM`, `${next(SAT)} · 5:00–7:00 PM`],
    },
    {
      title: "Sample Player 6",
      sport: "Football",
      detail: "Football · Advanced · Within 10 mi",
      chips: [`${next(SAT)} · 10:00 AM–12:00 PM`, `${next(SUN)} · 1:00–3:00 PM`],
    },
  ].map((r, i) => ({ ...r, person: `@sample${i + 1}` }));

  const teams: PreviewRow[] = [
    {
      title: "Sample Hoopers",
      sport: "Basketball",
      detail: `Adult rec league · Next practice ${next(TUE)} · 7:00 PM · Sample Rec Center`,
      chips: ["2 open spots", `Tryout ${next(SAT)} · 10:00 AM`],
    },
    {
      title: "Sample FC",
      sport: "Soccer",
      detail: `Adult rec league · Next game ${next(SUN)} · 5:00 PM · Sample Fields`,
      chips: ["1 open spot", `Practice ${next(THU)} · 7:00 PM`],
    },
    {
      title: "Sample Spikers",
      sport: "Volleyball",
      detail: `Adult rec league · Next practice ${next(WED)} · 8:00 PM · Sample Gym`,
      chips: ["3 open spots", `Tryout ${next(SUN)} · 2:00 PM`],
    },
    {
      title: "Sample Aces",
      sport: "Tennis",
      detail: `Adult doubles · Next match ${next(SAT)} · 9:00 AM · Sample Courts`,
      chips: ["2 open spots"],
    },
    {
      title: "Sample Runners",
      sport: "Running",
      detail: `Open to all adults · Group run ${next(SAT)} · 7:00 AM · Sample Trail`,
      chips: ["5 open spots", `Group run ${next(WED)} · 6:00 PM`],
    },
  ].map((r, i) => ({ ...r, person: `Captain ${person(i + 1)}` }));

  const trainers: PreviewRow[] = [
    {
      title: "Sample Skills Training",
      sport: "Basketball",
      detail: "Basketball · Shooting and ball handling · 60 min · $60",
      chips: [`${next(TUE)} · 5:00 PM`, `${next(TUE)} · 6:00 PM`, `${next(THU)} · 5:30 PM`],
    },
    {
      title: "Sample Speed Lab",
      sport: "Soccer",
      detail: "Soccer · Footwork and conditioning · 45 min · $45",
      chips: [`${next(WED)} · 7:00 AM`, `${next(FRI)} · 4:30 PM`, `${next(SAT)} · 9:00 AM`],
    },
    {
      title: "Sample Court Coaching",
      sport: "Tennis",
      detail: "Tennis · Serve and return clinics · 60 min · $70",
      chips: [`${next(MON)} · 6:00 PM`, `${next(THU)} · 6:00 PM`],
    },
    {
      title: "Sample Strength Studio",
      sport: "Running",
      detail: "Strength · Small-group sessions · 50 min · $35",
      chips: [`${next(TUE)} · 6:30 AM`, `${next(THU)} · 6:30 AM`, `${next(SAT)} · 8:00 AM`],
    },
    {
      title: "Sample Swim Coach",
      sport: "Running",
      detail: "Swimming · Adult stroke technique · 45 min · $55",
      chips: [`${next(WED)} · 12:15 PM`, `${next(SUN)} · 10:00 AM`],
    },
  ].map((r, i) => ({ ...r, person: `Coach ${person(i + 1)}` }));

  const gyms: PreviewRow[] = [
    {
      title: "Sample Rec Center",
      sport: "Basketball",
      detail: "Open today 6:00 AM–10:00 PM · 4 indoor courts · Sample City",
      chips: [
        `${next(SAT)} · Court 1 free 6:00 PM`,
        `${next(SAT)} · Court 3 free 7:30 PM`,
        "Day pass $10",
      ],
    },
    {
      title: "Sample Courts Club",
      sport: "Tennis",
      detail: "Open today 7:00 AM–9:00 PM · 6 hard courts · Sample City",
      chips: [
        `${next(SUN)} · Court 2 free 9:00 AM`,
        `${next(MON)} · Court 4 free 6:30 PM`,
        "$24 / hour",
      ],
    },
    {
      title: "Sample Volleyball Barn",
      sport: "Volleyball",
      detail: "Open today 5:00 PM–11:00 PM · 3 sand courts · Sample City",
      chips: [
        `${next(WED)} · Open play 7:00 PM`,
        `${next(FRI)} · Court 1 free 8:30 PM`,
        "Drop-in $8",
      ],
    },
    {
      title: "Sample Fieldhouse",
      sport: "Soccer",
      detail: "Open today 8:00 AM–11:00 PM · Indoor turf · Sample City",
      chips: [
        `${next(SUN)} · Field A free 3:00 PM`,
        `${next(TUE)} · Field B free 9:00 PM`,
        "$90 / hour",
      ],
    },
  ].map((r, i) => ({ ...r, person: `Managed by ${person(i + 1)}` }));

  const reels: PreviewRow[] = [
    { title: "Sunday hat trick", sport: "Soccer", detail: "Soccer", len: "0:24", ago: 1 },
    {
      title: "Buzzer-beater from the corner",
      sport: "Basketball",
      detail: "Basketball",
      len: "0:18",
      ago: 2,
    },
    { title: "Spike of the week", sport: "Volleyball", detail: "Volleyball", len: "0:12", ago: 3 },
    { title: "Rally of the night", sport: "Tennis", detail: "Tennis", len: "0:31", ago: 4 },
    { title: "Best saves", sport: "Soccer", detail: "Soccer", len: "0:27", ago: 6 },
    {
      title: "Dink battle at the net",
      sport: "Pickleball",
      detail: "Pickleball",
      len: "0:21",
      ago: 8,
    },
    {
      title: "Fourth-quarter lockdown",
      sport: "Football",
      detail: "Football",
      len: "0:29",
      ago: 9,
    },
    { title: "Negative-split finish", sport: "Running", detail: "Running", len: "0:16", ago: 11 },
  ].map(({ len, ago, ...r }, i) => ({
    ...r,
    detail: `${r.detail} · ${len} · Posted ${sampleDay(-ago, now)} · AI-generated`,
    chips: [`${(i + 2) * 37} views`, `${(i + 1) * 6} cheers`],
    person: `By ${person(i + 1)}`,
  })) as PreviewRow[];

  const messages: PreviewRow[] = [
    {
      title: "Sample Person 1",
      detail: `Want to run a game ${next(SAT)} at 10:00 AM? · 9:41 AM`,
    },
    {
      title: "Sample Hoopers",
      detail: `Sample Person 2: Practice is moved to 7:30 PM ${next(TUE)} · 1h ago`,
    },
    {
      title: "Sample Person 3",
      detail: `Thanks for hosting, see you ${next(SUN)} · Yesterday`,
    },
    {
      title: "Sample Court Coaching",
      detail: `Your session is confirmed for ${next(THU)} at 6:00 PM · ${sampleDay(-2, now)}`,
    },
    {
      title: "Sample Person 4",
      detail: `Can I bring a friend to ${next(SUN)} pickup? · ${sampleDay(-3, now)}`,
    },
  ];

  const conversation = [
    `${sampleDay(-1, now)}, 9:41 AM · Sample Person 1: Want to run a game ${next(SAT)} at 10:00 AM?`,
    `${sampleDay(-1, now)}, 9:44 AM · You: Sure. Sample Park, Court 2?`,
    `${sampleDay(-1, now)}, 9:45 AM · Sample Person 1: Yes. I'll bring the ball, see you there.`,
  ];

  return { games, players, teams, trainers, gyms, reels, messages, conversation, next, MON, WED };
}

const built = buildRows(new Date());

/** Sample gyms for the signed-out gym directory when it has no real listings yet. */
export const SAMPLE_GYMS: PreviewRow[] = built.gyms;

/** Sample highlights for the signed-out Highlights page when it has no real ones yet. */
export const SAMPLE_REELS: PreviewRow[] = built.reels;

export const PREVIEW_CONFIGS: Record<PreviewTab, PreviewConfig> = {
  feed: {
    title: "Find a game",
    subtitle: "Pickup games near you, by sport, skill and time.",
    cta: "Create a free account to see real games near you",
    headerAction: "Host",
    rowAction: "Join",
    rows: built.games,
  },
  players: {
    title: "Players",
    subtitle: "Find people to play with.",
    cta: "Create a free account to find players near you",
    rowAction: "Message",
    rows: built.players,
  },
  teams: {
    title: "Teams",
    subtitle: "Join a team or start your own.",
    cta: "Create a free account to find and join teams",
    headerAction: "Create team",
    rowAction: "Request to join",
    rows: built.teams,
    locked: {
      title: "Team chat and roster",
      lines: [
        "Sample Person 1: Who's in for Sunday?",
        "Sample Person 2: I can bring the balls.",
        "Sample Person 3: Count me in.",
      ],
    },
  },
  trainers: {
    title: "Trainers",
    subtitle: "Book coaching and training near you.",
    cta: "Create a free account to book a trainer",
    rowAction: "Book",
    rows: built.trainers,
  },
  reels: {
    title: "Reels",
    subtitle: "Upload a clip and let AI generate your highlight.",
    cta: "Create a free account to make your first reel",
    headerAction: "Upload a clip",
    rowAction: "Share",
    rows: built.reels,
  },
  messages: {
    title: "Messages",
    subtitle: "Chat with players, teams, trainers and gyms.",
    cta: "Create a free account to message players and teams",
    rowAction: "Open",
    rows: built.messages,
    locked: { title: "A conversation", lines: built.conversation },
  },
  create: {
    title: "Host a game",
    subtitle: "Set the sport, time and place, and players can join.",
    cta: "Create a free account to host a game",
    headerAction: "Publish game",
    fields: ["Sport", "Date and time", "Location", "Skill level", "Spots", "Price"],
  },
  profile: {
    title: "Your profile",
    subtitle: "Your sports, skill levels, availability, games and reviews.",
    cta: "Create a free account to build your profile",
    headerAction: "Edit profile",
    showAvatars: false,
    rows: [
      { title: "Games played", detail: "0 · Sample" },
      { title: "Rating", detail: "No reviews yet · Sample" },
      {
        title: "Availability",
        detail: "Sample",
        chips: [
          `${built.next(6)} · 9:00–11:00 AM`,
          `${built.next(0)} · 4:00–6:00 PM`,
          `${built.next(built.WED)} · 7:00–9:00 PM`,
        ],
      },
    ],
    locked: {
      title: "Messages",
      lines: [
        "Sample Person 1: Want to run a game Saturday?",
        "Sample Person 2: Thanks for hosting!",
        "Sample Person 3: See you at the court.",
      ],
    },
  },
};
