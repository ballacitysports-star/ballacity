import soccerImg from "@/assets/sport-soccer.jpg";
import pickleballImg from "@/assets/sport-pickleball.jpg";
import volleyballImg from "@/assets/sport-volleyball.jpg";
import runningImg from "@/assets/sport-running.jpg";
import tennisImg from "@/assets/sport-tennis.jpg";
import heroImg from "@/assets/hero-court.jpg";

export type Sport =
  | "Basketball" | "Soccer" | "Pickleball" | "Volleyball" | "Tennis"
  | "Flag Football" | "Baseball" | "Softball" | "Hockey" | "Running";

export const SPORTS: { name: Sport; emoji: string; color: string }[] = [
  { name: "Basketball", emoji: "🏀", color: "#ff8a3d" },
  { name: "Soccer", emoji: "⚽", color: "#a3ff12" },
  { name: "Pickleball", emoji: "🥒", color: "#7df9c1" },
  { name: "Volleyball", emoji: "🏐", color: "#ffd166" },
  { name: "Tennis", emoji: "🎾", color: "#c8ff5b" },
  { name: "Flag Football", emoji: "🏈", color: "#ff6b35" },
  { name: "Baseball", emoji: "⚾", color: "#ffffff" },
  { name: "Softball", emoji: "🥎", color: "#ffe27a" },
  { name: "Hockey", emoji: "🏒", color: "#8ad6ff" },
  { name: "Running", emoji: "🏃", color: "#ff3d68" },
];

export type Game = {
  id: string;
  sport: Sport;
  title: string;
  host: { name: string; username: string; avatar: string; rating: number };
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
  Hockey: volleyballImg,
  Running: runningImg,
};

export function imageFor(sport: Sport) {
  return sportImage[sport];
}

const now = Date.now();
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
