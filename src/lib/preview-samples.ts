/**
 * Static sample content for the signed-out tab previews.
 *
 * Everything here is invented and ships in the bundle. It must stay that way:
 * this file imports nothing from Supabase or a server function, so a signed-out
 * browser is never sent a real member's name, photo, roster or message. The
 * real page is simply never mounted for a signed-out visitor.
 */

export type PreviewTab =
  "feed" | "players" | "teams" | "trainers" | "reels" | "messages" | "create" | "profile";

export type PreviewRow = {
  title: string;
  detail: string;
  /** A made-up name or handle. */
  person?: string;
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

const person = (n: number) => `Sample Person ${n}`;

const games: PreviewRow[] = [
  { title: "Sunday pickup basketball", detail: "Sample Park · Sun 10:00 AM · 6 spots open" },
  { title: "5-a-side soccer", detail: "Sample Fields · Sun 4:00 PM · 3 spots open" },
  { title: "Open gym volleyball", detail: "Sample Rec Center · Mon 7:00 PM · 8 spots open" },
  { title: "Tennis doubles ladder", detail: "Sample Courts · Tue 6:30 PM · 2 spots open" },
  { title: "Flag football scrimmage", detail: "Sample Field · Wed 6:00 PM · 10 spots open" },
  { title: "Morning run club", detail: "Sample Trail · Thu 6:30 AM · 12 spots open" },
  { title: "Pickleball round robin", detail: "Sample Courts · Fri 5:30 PM · 4 spots open" },
].map((r, i) => ({ ...r, person: `Hosted by ${person(i + 1)}` }));

const players: PreviewRow[] = [
  { title: "Sample Player 1", detail: "Basketball · Intermediate · Available weekends" },
  { title: "Sample Player 2", detail: "Soccer · Advanced · Available evenings" },
  { title: "Sample Player 3", detail: "Volleyball · Beginner · Available mornings" },
  { title: "Sample Player 4", detail: "Tennis · Intermediate · Available weekends" },
  { title: "Sample Player 5", detail: "Pickleball · Beginner · Available evenings" },
  { title: "Sample Player 6", detail: "Football · Advanced · Available weekends" },
].map((r, i) => ({ ...r, person: `@sample${i + 1}` }));

const teams: PreviewRow[] = [
  { title: "Sample Hoopers", detail: "Basketball · Adult rec league · 2 open spots" },
  { title: "Sample FC", detail: "Soccer · Adult rec league · 1 open spot" },
  { title: "Sample Spikers", detail: "Volleyball · Adult rec league · 3 open spots" },
  { title: "Sample Aces", detail: "Tennis · Adult doubles · 2 open spots" },
  { title: "Sample Runners", detail: "Running · Open to all adults · 5 open spots" },
].map((r, i) => ({ ...r, person: `Captain ${person(i + 1)}` }));

const trainers: PreviewRow[] = [
  { title: "Sample Skills Training", detail: "Basketball · Shooting and ball handling" },
  { title: "Sample Speed Lab", detail: "Soccer · Footwork and conditioning" },
  { title: "Sample Court Coaching", detail: "Tennis · Serve and return clinics" },
  { title: "Sample Strength Studio", detail: "Strength · Small-group sessions" },
  { title: "Sample Swim Coach", detail: "Swimming · Adult stroke technique" },
].map((r, i) => ({ ...r, person: `Coach ${person(i + 1)}` }));

const reels: PreviewRow[] = [
  { title: "Sunday hat trick", detail: "Soccer · Sample highlight · 0:24 · AI-generated" },
  {
    title: "Buzzer-beater from the corner",
    detail: "Basketball · Sample highlight · 0:18 · AI-generated",
  },
  { title: "Spike of the week", detail: "Volleyball · Sample highlight · 0:12 · AI-generated" },
  { title: "Rally of the night", detail: "Tennis · Sample highlight · 0:31 · AI-generated" },
  { title: "Best saves", detail: "Soccer · Sample highlight · 0:27 · AI-generated" },
  {
    title: "Dink battle at the net",
    detail: "Pickleball · Sample highlight · 0:21 · AI-generated",
  },
  { title: "Fourth-quarter lockdown", detail: "Football · Sample highlight · 0:29 · AI-generated" },
  { title: "Negative-split finish", detail: "Running · Sample highlight · 0:16 · AI-generated" },
].map((r, i) => ({ ...r, person: `By ${person(i + 1)}` }));

const messages: PreviewRow[] = [
  { title: "Sample Person 1", detail: "Want to run a game Saturday? · 2m" },
  { title: "Sample Hoopers", detail: "Sample Person 2: Practice moved to 7 PM · 1h" },
  { title: "Sample Person 3", detail: "Thanks for hosting, see you next week · Yesterday" },
  { title: "Sample Court Coaching", detail: "Your Tuesday session is confirmed · Mon" },
  { title: "Sample Person 4", detail: "Can I bring a friend to Sunday pickup? · Sun" },
];

export const PREVIEW_CONFIGS: Record<PreviewTab, PreviewConfig> = {
  feed: {
    title: "Find a game",
    subtitle: "Pickup games near you, by sport, skill and time.",
    cta: "Create a free account to see real games near you",
    rowAction: "Join",
    rows: games,
  },
  players: {
    title: "Players",
    subtitle: "Find people to play with.",
    cta: "Create a free account to find players near you",
    rowAction: "Message",
    rows: players,
  },
  teams: {
    title: "Teams",
    subtitle: "Join a team or start your own.",
    cta: "Create a free account to find and join teams",
    headerAction: "Create team",
    rowAction: "Request to join",
    rows: teams,
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
    rows: trainers,
  },
  reels: {
    title: "Reels",
    subtitle: "Upload a clip and let AI generate your highlight.",
    cta: "Create a free account to make your first reel",
    headerAction: "Upload a clip",
    rowAction: "Share",
    rows: reels,
  },
  messages: {
    title: "Messages",
    subtitle: "Chat with players, teams, trainers and gyms.",
    cta: "Create a free account to message players and teams",
    rowAction: "Open",
    rows: messages,
    locked: {
      title: "A conversation",
      lines: [
        "Sample Person 1: Want to run a game Saturday?",
        "You: Sure, what time works?",
        "Sample Person 1: 10 AM at Sample Park.",
      ],
    },
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
      { title: "Availability", detail: "Weekends · Evenings · Sample" },
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
