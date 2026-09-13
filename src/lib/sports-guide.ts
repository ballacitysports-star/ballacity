/**
 * Canonical sports-guide content.
 *
 * One entry per `Sport`, keyed by the same union the rest of the app uses, so a
 * new sport is a type error until its guide is written. Positions are NOT
 * duplicated here — they come from `POSITIONS_BY_SPORT` so the guide and the
 * pickers can never drift.
 *
 * Copy is general, widely-accepted guidance about how pickup play usually
 * works. It intentionally invents no venues, prices, schedules, or contacts.
 */
import { POSITIONS_BY_SPORT, SPORTS, imageFor, type Sport } from "@/lib/sample-data";

export type SportGuide = {
  /** URL slug used by /guide/$sport. */
  slug: string;
  /** One line for the index card. */
  tagline: string;
  /** Typical group size for a pickup session. */
  groupSize: string;
  /** How long a typical pickup session runs. */
  sessionLength: string;
  /** How a pickup game normally runs, start to finish. */
  howItWorks: string[];
  /** What to bring. */
  bring: string[];
  /** Unwritten rules that keep pickup fun. */
  etiquette: string[];
  /** What to expect at different levels. */
  skillNotes: string;
};

const GUIDES: Record<Sport, SportGuide> = {
  Baseball: {
    slug: "baseball",
    tagline: "Full-field games need numbers — batting practice and infield work fill the gaps.",
    groupSize: "10–18 players for a game; 4+ for hitting and fielding drills",
    sessionLength: "About 2 hours, or 7–9 innings if there's time",
    howItWorks: [
      "With fewer than about 18 players, groups usually play with shared fielders, a pitcher who throws to both sides, or a hitting rotation instead of a full nine-on-nine game.",
      "Teams are picked on the spot and balanced by experience rather than by position preference.",
      "Innings run to three outs as usual, but pickup games often set a run limit per inning so one big inning doesn't end the fun.",
      "Games commonly end on a time cap rather than a full nine innings.",
    ],
    bring: [
      "Your own glove — gloves are personal and rarely spare",
      "Cleats or trainers, depending on the field surface",
      "A bat and helmet if you have them; hosts often bring shared ones",
      "Water, sunscreen, and a hat for long sunny sessions",
    ],
    etiquette: [
      "Call your own close plays honestly; there's no umpire.",
      "Warm your arm up gradually before throwing hard.",
      "Keep pitch speed in line with the level of the hitters in front of you.",
      "Help clear the field and collect stray balls at the end.",
    ],
    skillNotes:
      "Beginners are welcome in batting-practice sessions and casual games. Competitive full-field games move fast — expect real pitching speed and quick decisions in the field.",
  },
  Basketball: {
    slug: "basketball",
    tagline: "The easiest pickup game to join — one ball, one hoop, and you're playing.",
    groupSize: "4–10 players; 5v5 full court, 3v3 half court",
    sessionLength: "1–2 hours of back-to-back short games",
    howItWorks: [
      "Half-court games are the pickup default: first to 11 or 21 points, counting one and two instead of two and three.",
      "Winners usually stay on and the next group rotates in, so games are short and everyone plays.",
      "Teams are picked by shooting for it, by captains, or by whoever arrived together.",
      "Calls are self-made — the player who was fouled calls it and the ball is checked back in.",
    ],
    bring: [
      "Indoor basketball shoes with grip, or trainers for outdoor courts",
      "A light and a dark shirt so teams can be told apart",
      "Your own ball if you have one — courts run out",
      "Water; indoor gyms get hot fast",
    ],
    etiquette: [
      "Call your own fouls, and don't call every one of them.",
      "Play defense at the level the run is being played at.",
      "Ask before joining a run mid-game; wait for the next one if teams are set.",
      "Keep score out loud so nobody has to argue at the end.",
    ],
    skillNotes:
      "Casual runs happily absorb beginners. Competitive runs are physical and fast — get a feel for the pace of a game before checking in.",
  },
  Football: {
    slug: "football",
    tagline: "Pickup football is nearly always flag or touch — no pads, no tackling.",
    groupSize: "8–14 players; 5v5 or 7v7 on a shortened field",
    sessionLength: "About 90 minutes, often first to a set number of scores",
    howItWorks: [
      "Groups agree the format before the first snap: flag or touch, how many downs to move the ball, and whether rushing the quarterback is allowed.",
      "A shortened field is standard, with a midfield line to gain instead of measured first downs.",
      "Everyone plays both ways; positions rotate so more than one person gets to throw and catch.",
      "Scoring is simple — a set number of scores or a time cap ends the game.",
    ],
    bring: [
      "Trainers or turf shoes; studded cleats are often not allowed indoors",
      "A flag belt if the group plays flag football",
      "Contrasting shirts for team identification",
      "Water and a towel",
    ],
    etiquette: [
      "Agree the rules before playing, not after a disputed score.",
      "No tackling, blocking below the waist, or diving at legs in a no-contact game.",
      "Call holding and pass interference on yourself when it's obvious.",
      "Rotate positions so the same two players aren't the only ones touching the ball.",
    ],
    skillNotes:
      "Flag and touch games suit mixed abilities well. Contact is the line most groups won't cross in pickup play — if a run feels physical, sit the next one out.",
  },
  Pickleball: {
    slug: "pickleball",
    tagline: "Quick to learn, endlessly social, and built around rotating doubles.",
    groupSize: "4 per court; open play rotates through everyone waiting",
    sessionLength: "1–2 hours of games to 11",
    howItWorks: [
      "Games go to 11 points, win by two, and only the serving side scores.",
      "Open play rotates: the winners split or step off after each game so waiting players get on court.",
      "Paddles are usually stacked or racked in order to keep the queue fair.",
      "Serves go underhand and diagonally, and neither side may volley inside the non-volley zone (the kitchen).",
    ],
    bring: [
      "A paddle if you have one — most venues and hosts have spares",
      "Court shoes with lateral support; running shoes wear out fast",
      "Indoor or outdoor balls to match the venue",
      "Water and a hand towel",
    ],
    etiquette: [
      "Call the score clearly before every serve.",
      "Give the benefit of the doubt on line calls — the receiving side calls its own lines.",
      "Match your pace to your partner and opponents in mixed-level open play.",
      "Don't walk behind an active court while a point is live.",
    ],
    skillNotes:
      "One of the best sports to start in as an adult beginner. Rated open play sessions (for example 3.0+ or 3.5+) expect faster hands and consistent dinking.",
  },
  Running: {
    slug: "running",
    tagline: "Group runs, track sessions, and trails — pace groups keep nobody dropped.",
    groupSize: "2 to 30+; groups usually split by pace",
    sessionLength: "30–90 minutes depending on the session",
    howItWorks: [
      "Runs are posted with a distance, a route, and a target pace per mile or kilometre.",
      "Larger groups split into pace groups so faster and slower runners both get the session they came for.",
      "Track sessions follow a set of intervals with recovery between them; the group warms up and cools down together.",
      "Most groups regroup at the end rather than at every corner, and agree in advance whether it's a no-drop run.",
    ],
    bring: [
      "Running shoes suited to the surface — road, track, or trail",
      "Water or a bottle for anything over an hour",
      "A light or reflective layer for early and late runs",
      "Weather-appropriate layers; the group won't wait long in the cold",
    ],
    etiquette: [
      "Be honest about your pace when you sign up.",
      "Run no more than two abreast on shared paths and call out hazards.",
      "Never leave someone alone on a route they don't know.",
      "On trails, yield uphill and don't cut switchbacks.",
    ],
    skillNotes:
      "Beginner-friendly by design: look for a run with a pace you can hold while talking. Interval and tempo sessions assume a base of regular running.",
  },
  Soccer: {
    slug: "soccer",
    tagline: "Small-sided games dominate pickup — fast, continuous, and easy to organise.",
    groupSize: "10–22 players; 5v5, 7v7 and 11v11 are all common",
    sessionLength: "60–90 minutes, often two halves or straight through",
    howItWorks: [
      "Groups pick a format based on turnout: 5v5 or 7v7 on a small pitch, full 11v11 only with a big group.",
      "Teams are split by bibs or by shirt colour, with sides rebalanced if the game becomes lopsided.",
      "Pickup games run without a referee, so offside is often waived or played loosely on small pitches.",
      "Play is usually continuous with a running clock; substitutions happen on the fly.",
    ],
    bring: [
      "Boots or turf shoes to suit the surface; indoor courts often require non-marking soles",
      "Shin guards for anything competitive",
      "A light and a dark shirt, or a bib",
      "Water — small-sided games barely stop",
    ],
    etiquette: [
      "Play the ball, not the player; hard tackles have no place in pickup.",
      "Give the ball back for a clear foul instead of arguing it.",
      "Take turns in goal unless someone actually wants to keep.",
      "Rebalance teams between games rather than running up the score.",
    ],
    skillNotes:
      "Small-sided games are a good place to start — you get many more touches. Competitive games are quick and physical even without a referee.",
  },
  Softball: {
    slug: "softball",
    tagline: "Slow pitch is the social default; fast pitch is its own, quicker game.",
    groupSize: "12–20 players for a game; fewer for batting practice",
    sessionLength: "About 90 minutes, or 7 innings",
    howItWorks: [
      "Most pickup softball is slow pitch: an arcing pitch, a bigger ball, and a game built around putting the ball in play.",
      "Games run seven innings or to a time cap, whichever comes first.",
      "Short-handed groups share fielders between teams or bat through a rotation instead of playing sides.",
      "Coed groups often use a set batting order that alternates, so everyone hits.",
    ],
    bring: [
      "Your own glove",
      "Cleats or trainers for grass and dirt",
      "A bat and helmet if you have them; shared gear is common",
      "Water, sunscreen, and a hat",
    ],
    etiquette: [
      "Call your own plays fairly; there's no umpire in pickup.",
      "Keep slow-pitch pitching genuinely hittable.",
      "Slide or avoid contact rather than running through a fielder.",
      "Rotate positions so newer players get more than right field.",
    ],
    skillNotes:
      "Slow pitch is one of the friendliest team sports for beginners. Fast pitch assumes real experience at the plate and in the field.",
  },
  Tennis: {
    slug: "tennis",
    tagline: "Singles, doubles, or a hitting session — matched levels make the best games.",
    groupSize: "2 for singles, 4 for doubles",
    sessionLength: "60–90 minutes; a set or two, or timed rally play",
    howItWorks: [
      "Players agree the format up front: a hitting session, a practice set, or a full match with tiebreaks.",
      "Warm-up rallies and a few serves come before the first point.",
      "Each side calls the lines on its own half of the court.",
      "Timed court bookings mean many sessions finish on the clock rather than at match point.",
    ],
    bring: [
      "Your racquet, strung and ready",
      "A can of balls — bringing your own is expected",
      "Court shoes suited to the surface",
      "Water and a towel",
    ],
    etiquette: [
      "Call your own lines promptly and honestly; out is called loudly, everything else is in.",
      "Wait for a point to finish before crossing behind a court.",
      "Give the balls back to the server rather than leaving them at your feet.",
      "Match up by level — a mismatched match isn't fun for either player.",
    ],
    skillNotes:
      "Level matters more here than in most pickup sports. Look for hitting sessions or beginner-friendly doubles if you're starting out; posted ratings signal expectation.",
  },
  Volleyball: {
    slug: "volleyball",
    tagline: "Indoor sixes, grass fours, or beach twos — rotation keeps everyone involved.",
    groupSize: "4–12 players; 6v6 indoor, 2v2 or 4v4 on sand",
    sessionLength: "1–2 hours of games to 21 or 25",
    howItWorks: [
      "Indoor games go to 25, win by two; sand games are commonly to 21 with a switch of ends partway.",
      "Sides rotate clockwise on winning a serve, so everyone serves and everyone plays the front row.",
      "Open play rotates teams on and off after each game so waiting players get on court.",
      "Three touches per side, and the ball may not be caught or thrown.",
    ],
    bring: [
      "Court shoes for indoor; bare feet on sand",
      "Knee pads for indoor play",
      "A ball if you have one, and matching or contrasting shirts",
      "Water, and sunscreen for outdoor sessions",
    ],
    etiquette: [
      "Call the ball loudly — most pickup errors are two people going for one ball.",
      "Announce the score before each serve.",
      "Set up your teammate rather than spiking every second ball.",
      "Help put nets up and take them down.",
    ],
    skillNotes:
      "Grass and casual indoor sessions are forgiving for beginners. Competitive sixes and sand twos assume you can pass, set, and serve consistently.",
  },
};

export type SportGuideEntry = SportGuide & {
  sport: Sport;
  emoji: string;
  color: string;
  cover: string;
  positions: string[];
};

/** Every sport's guide, in the same order as the sport chips. */
export const SPORT_GUIDES: SportGuideEntry[] = SPORTS.map(({ name, emoji, color }) => ({
  ...GUIDES[name],
  sport: name,
  emoji,
  color,
  cover: imageFor(name),
  positions: POSITIONS_BY_SPORT[name],
}));

const BY_SLUG = new Map(SPORT_GUIDES.map((g) => [g.slug, g]));

/** Look up a guide by URL slug; undefined for an unknown slug. */
export function guideBySlug(slug: string): SportGuideEntry | undefined {
  return BY_SLUG.get(slug.toLowerCase());
}

/** URL slug for a sport. */
export function slugForSport(sport: Sport): string {
  return GUIDES[sport].slug;
}

/** Every guide slug — used by the sitemap. */
export const SPORT_GUIDE_SLUGS: string[] = SPORT_GUIDES.map((g) => g.slug);
