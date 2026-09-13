import type { Sport } from "./sample-data";

export type RatingSystem = "NTRP" | "DUPR" | "UTR" | "PACE" | "SELF";

export type SportConfig = {
  individualSport: boolean;
  formats: string[];
  venues: string[];
  cadences: string[];
  equipment: string[];
  ratingSystem: RatingSystem;
  ratingLevels: string[]; // ordered low → high, used for min/max pickers
  distances?: string[]; // running
  credentialPresets: string[]; // coach chips
};

const COMMON_CADENCES = ["Weekly", "Bi-weekly", "Monthly", "Seasonal", "On-demand"];

const SELF_LEVELS = ["Beginner", "Recreational", "Intermediate", "Advanced", "Pro"];
const NTRP_LEVELS = ["2.5", "3.0", "3.5", "4.0", "4.5", "5.0", "5.5+"];
const DUPR_LEVELS = ["2.5", "3.0", "3.5", "4.0", "4.5", "5.0", "5.5+"];
const UTR_LEVELS = ["1–3", "4–5", "6–7", "8–9", "10+"];
const PACE_LEVELS = ["10:00+/mi", "9:00/mi", "8:00/mi", "7:00/mi", "6:00/mi", "5:30/mi"];

export const SPORT_CONFIG: Record<Sport, SportConfig> = {
  Basketball: {
    individualSport: false,
    formats: ["5v5 Full Court", "4v4", "3v3 Half Court", "1v1", "Shootaround"],
    venues: ["Indoor Court", "Outdoor Court", "Blacktop", "Gym"],
    cadences: COMMON_CADENCES,
    equipment: ["Reversible jersey", "Ball", "Court shoes", "Water"],
    ratingSystem: "SELF",
    ratingLevels: SELF_LEVELS,
    credentialPresets: ["NBA Skills Trainer", "NASM-CPT", "USAB Gold", "College Assistant"],
  },
  Soccer: {
    individualSport: false,
    formats: ["11v11", "7v7", "5v5 Futsal", "Small-sided", "Training"],
    venues: ["Turf", "Grass", "Indoor Futsal", "Small-sided Cage"],
    cadences: COMMON_CADENCES,
    equipment: ["Cleats", "Shin guards", "Both shirts", "Ball"],
    ratingSystem: "SELF",
    ratingLevels: SELF_LEVELS,
    credentialPresets: ["USSF D License", "USSF C License", "USSF B License", "UEFA B"],
  },
  Football: {
    individualSport: false,
    formats: ["11v11 Tackle", "7v7 Passing", "5v5 Flag", "Skills"],
    venues: ["Turf", "Grass", "Indoor Facility"],
    cadences: COMMON_CADENCES,
    equipment: ["Cleats", "Flags", "Mouthguard", "Water"],
    ratingSystem: "SELF",
    ratingLevels: SELF_LEVELS,
    credentialPresets: ["USA Football Certified", "NFL FLAG Coach", "AFCA Member"],
  },
  Volleyball: {
    individualSport: false,
    formats: ["Indoor 6s", "Beach Doubles", "Grass 4s", "Coed 6s"],
    venues: ["Indoor Court", "Sand", "Grass"],
    cadences: COMMON_CADENCES,
    equipment: ["Knee pads", "Court shoes", "Ankle braces"],
    ratingSystem: "SELF",
    ratingLevels: SELF_LEVELS,
    credentialPresets: ["USAV IMPACT", "AVCA Member", "CAP I", "CAP II"],
  },
  Baseball: {
    individualSport: false,
    formats: ["9v9", "Scrimmage", "Batting Practice", "Fielding"],
    venues: ["Diamond", "Indoor Cage", "Turf Field"],
    cadences: COMMON_CADENCES,
    equipment: ["Glove", "Cleats", "Bat", "Helmet"],
    ratingSystem: "SELF",
    ratingLevels: SELF_LEVELS,
    credentialPresets: ["ABCA Member", "USA Baseball Coach", "College Assistant"],
  },
  Softball: {
    individualSport: false,
    formats: ["Fastpitch 9v9", "Slowpitch 10v10", "Coed Slowpitch", "Practice"],
    venues: ["Diamond", "Turf Field", "Indoor Cage"],
    cadences: COMMON_CADENCES,
    equipment: ["Glove", "Cleats", "Bat", "Helmet"],
    ratingSystem: "SELF",
    ratingLevels: SELF_LEVELS,
    credentialPresets: ["NFCA Member", "ASA/USA Certified"],
  },
  Tennis: {
    individualSport: true,
    formats: ["Singles", "Doubles", "Mixed Doubles", "Drills + Match Play"],
    venues: ["Hard Court", "Clay", "Grass", "Indoor"],
    cadences: COMMON_CADENCES,
    equipment: ["Racquet", "Balls", "Court shoes"],
    ratingSystem: "NTRP",
    ratingLevels: NTRP_LEVELS,
    credentialPresets: ["USPTA Elite", "PTR Professional", "USTA High Performance"],
  },
  Pickleball: {
    individualSport: true,
    formats: ["Singles", "Doubles", "Mixed Doubles", "Round Robin", "Open Play"],
    venues: ["Indoor Court", "Outdoor Court", "Dedicated Courts"],
    cadences: COMMON_CADENCES,
    equipment: ["Paddle", "Balls", "Court shoes"],
    ratingSystem: "DUPR",
    ratingLevels: DUPR_LEVELS,
    credentialPresets: ["PPR Certified", "IPTPA Level I", "IPTPA Level II"],
  },
  Running: {
    individualSport: true,
    formats: ["Group Run", "Track Workout", "Tempo", "Long Run", "Trail"],
    venues: ["Track", "Road", "Trail", "Treadmill"],
    cadences: COMMON_CADENCES,
    equipment: ["Running shoes", "GPS watch", "Hydration"],
    ratingSystem: "PACE",
    ratingLevels: PACE_LEVELS,
    distances: ["1 mile", "5K", "10K", "Half Marathon", "Marathon", "Ultra", "Trail"],
    credentialPresets: ["USATF Level 1", "USATF Level 2", "RRCA Coach", "UESCA Endurance"],
  },
};

export const RATING_SYSTEM_LABEL: Record<RatingSystem, string> = {
  NTRP: "NTRP",
  DUPR: "DUPR",
  UTR: "UTR",
  PACE: "Pace / mile",
  SELF: "Self-rated",
};

export const SESSION_TYPES = [
  "1:1",
  "Small group",
  "Clinic",
  "Video review",
  "On-court",
  "Remote plan",
];

export function primarySport(sports: Sport[]): Sport | null {
  return sports[0] ?? null;
}

/** Union of options across the selected sports, de-duped, order preserved. */
function unionBy<T>(arrays: T[][]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const arr of arrays) {
    for (const v of arr) {
      if (!seen.has(v)) {
        seen.add(v);
        out.push(v);
      }
    }
  }
  return out;
}

export function mergedFormats(sports: Sport[]): string[] {
  return unionBy(sports.map((s) => SPORT_CONFIG[s].formats));
}
export function mergedVenues(sports: Sport[]): string[] {
  return unionBy(sports.map((s) => SPORT_CONFIG[s].venues));
}
export function mergedCadences(sports: Sport[]): string[] {
  if (sports.length === 0) return COMMON_CADENCES;
  return unionBy(sports.map((s) => SPORT_CONFIG[s].cadences));
}
export function mergedCredentialPresets(sports: Sport[]): string[] {
  return unionBy(sports.map((s) => SPORT_CONFIG[s].credentialPresets));
}

export function ratingSystemFor(sport: Sport | null): RatingSystem {
  if (!sport) return "SELF";
  return SPORT_CONFIG[sport].ratingSystem;
}
export function ratingLevelsFor(sport: Sport | null): string[] {
  if (!sport) return SELF_LEVELS;
  return SPORT_CONFIG[sport].ratingLevels;
}

export function isAllIndividual(sports: Sport[]): boolean {
  return sports.length > 0 && sports.every((s) => SPORT_CONFIG[s].individualSport);
}
export function hasTeamSport(sports: Sport[]): boolean {
  return sports.some((s) => !SPORT_CONFIG[s].individualSport);
}
export function hasRunning(sports: Sport[]): boolean {
  return sports.includes("Running");
}
