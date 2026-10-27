/**
 * BallaCity Help: the written knowledge the support assistant answers from.
 *
 * This file is the single source of truth for both halves of the feature:
 *  - the "quick answers" the help drawer shows with NO AI call (signed-out
 *    visitors, under-18 accounts, AI switched off or out of quota), and
 *  - the library the AI assistant is told to answer from and nothing else.
 *
 * Every statement here describes what the product does today and is checked
 * against the code or the published policy pages it came from (see the
 * `knowledge.test.ts` consistency tests). Do NOT add anything the app does not
 * do, and do not make legal or compliance claims: `child-policy.ts` and
 * `age-policy.ts` deliberately stop short of calling BallaCity "COPPA
 * compliant" until counsel has reviewed the consent method. When a screen or
 * policy changes, change it here too.
 *
 * Client-safe: imported by the drawer as well as by the server.
 */

import { PARENTAL_CONSENT_MAX_AGE } from "@/lib/age-policy";
import { EMERGENCY_NOTICE } from "@/lib/safety";
import { SUPPORT_EMAIL } from "@/lib/trust";

/** Where an answer can send a member. Only these routes are ever linked. */
export const SUPPORT_LINKS = {
  contact: { label: "Contact support", to: "/contact" },
  parent_center: { label: "Parent Center", to: "/parent" },
  add_child: { label: "Add your child", to: "/players/add" },
  child_safety: { label: "Child safety", to: "/safety/children" },
  safety_center: { label: "Safety Center", to: "/safety" },
  youth_policy: { label: "Youth & Minor Policy", to: "/youth-policy" },
  payment_policy: { label: "Payment Policy", to: "/payment-policy" },
  terms: { label: "Terms", to: "/terms" },
  privacy: { label: "Privacy Policy", to: "/privacy" },
  privacy_settings: { label: "Privacy settings", to: "/account/privacy" },
  ai_disclosure: { label: "AI disclosure", to: "/ai-disclosure" },
  blocked_users: { label: "Blocked users", to: "/account/blocked" },
  find_games: { label: "Find games", to: "/feed" },
  teams: { label: "Teams", to: "/teams" },
  trainers: { label: "Trainers", to: "/trainers" },
  players: { label: "Players", to: "/players" },
} as const;

export type SupportLinkKey = keyof typeof SUPPORT_LINKS;

export const SUPPORT_LINK_KEYS = Object.keys(SUPPORT_LINKS) as SupportLinkKey[];

export function isSupportLinkKey(v: unknown): v is SupportLinkKey {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(SUPPORT_LINKS, v);
}

export type SupportLink = { key: SupportLinkKey; label: string; to: string };

export function resolveSupportLinks(keys: readonly unknown[], max = 3): SupportLink[] {
  const seen = new Set<SupportLinkKey>();
  const out: SupportLink[] = [];
  for (const k of keys) {
    if (!isSupportLinkKey(k) || seen.has(k)) continue;
    seen.add(k);
    out.push({ key: k, ...SUPPORT_LINKS[k] });
    if (out.length >= max) break;
  }
  return out;
}

export type SupportTopic = {
  id: string;
  title: string;
  /** One sentence, shown on the quick-answer chip's card. */
  summary: string;
  points: string[];
  links: SupportLinkKey[];
};

const CONSENT_AGE = PARENTAL_CONSENT_MAX_AGE + 1;

export const SUPPORT_TOPICS: SupportTopic[] = [
  {
    id: "payments",
    title: "Paying for games",
    summary:
      "Game fees go straight from you to the host. BallaCity never holds or moves the money.",
    points: [
      "Hosts post the fee and their own payment details, for example Venmo, Zelle, Cash App, PayPal or cash. You pay the host directly.",
      "If a host has connected PayPal, a PayPal button may appear at checkout. It also pays the host directly.",
      "BallaCity is not a payment processor and does not take a cut of game fees.",
      "After you pay, mark the payment as sent. The host then confirms it, or rejects or disputes it.",
      "Never share card numbers, bank logins or one-time codes. Neither BallaCity nor a real host will ask for them.",
      "BallaCity cannot reverse a payment or issue a refund. Each game lists the host's refund terms. Ask the host first, then your payment service.",
      "If a host asks you to pay off-app, pay more than the listed fee, or pay in a rush, report it with the flag icon or 'Report a payment scam' on the payment screen.",
      "BallaCity plan subscriptions, if you have one, are separate from game fees.",
    ],
    links: ["payment_policy", "safety_center", "contact"],
  },
  {
    id: "kids-and-parents",
    title: "Kids, teens and parents",
    summary:
      "Parents add and manage their children from the Parent Center. A child doesn't need their own login.",
    points: [
      "A parent or guardian adds a child from the Parent Center with 'Add your child'. The child doesn't need their own email or password, and the child-safety settings apply from the start.",
      `Members under ${CONSENT_AGE} need a parent or guardian's approval before games, messages and videos turn on. Until then the account can only browse.`,
      "A child's profile can't be found through social discovery, their media isn't public, and their precise location is never public.",
      "Direct messages between adults and minors are restricted.",
      "Parents and guardians can review a child's account and revoke their approval at any time.",
      "Hosts and coaches supervise their own events. BallaCity does not supervise games.",
    ],
    links: ["parent_center", "add_child", "child_safety", "youth_policy"],
  },
  {
    id: "joining-games",
    title: "Joining games",
    summary:
      "Find a game, read the whole post, then request a spot. Most hosts approve requests first.",
    points: [
      "Find games on the feed or the map. Open one and read the whole post (venue, time, skill level, fee and player limit) before you commit.",
      "Most games need the host's approval, and some hosts allow instant joining. The post shows which, plus the cost and cancellation terms, above the join button.",
      "If a game is full and the host allows a waitlist, you can join it and take a spot if someone drops. 'My waitlist' shows the host's approval status.",
      "Before you join you'll be asked to acknowledge that sports carry risk.",
      "You can leave a game. Cancelling after the host's cutoff (2 hours before the start unless the host changed it) is recorded as a late cancel.",
    ],
    links: ["find_games", "payment_policy", "safety_center"],
  },
  {
    id: "hosting-games",
    title: "Hosting a game",
    summary: "You set the rules for your game and collect any fee yourself.",
    points: [
      "When you create a game you choose the player limit, whether you approve requests, whether there's a waitlist, the entry fee, and your cancellation and refund terms.",
      "You collect fees yourself through your own payment app. When a player marks a payment as sent, confirm, reject or dispute it.",
      "Charge only the fee you posted. Never ask for card numbers, logins or verification codes.",
      "Use a public court, park or gym when you can, and avoid publishing a private home address.",
      "You are responsible for supervising your own game. BallaCity does not supervise games.",
    ],
    links: ["payment_policy", "safety_center", "terms"],
  },
  {
    id: "teams-tryouts",
    title: "Teams, tryouts and coaches",
    summary: "Browse teams and trainers, RSVP to tryouts and camps, and sign the team's waiver.",
    points: [
      "Browse teams and trainers from the Teams and Trainers pages to see what they offer.",
      "Tryouts and camps are posted by team owners, managers and coaches. RSVP from the post. Spots can fill up.",
      "If the team has a published waiver, you sign it when you RSVP. For a child, a parent or guardian signs on their behalf.",
      "Team staff (the owner, managers and coaches) post tryouts and camps and manage who is on the team. To be added to a team, ask its staff.",
    ],
    links: ["teams", "trainers", "youth_policy"],
  },
  {
    id: "safety-and-reporting",
    title: "Safety, reporting and blocking",
    summary: "Report anything with the flag icon. Blocking works both ways and isn't disclosed.",
    points: [
      "Use the flag icon on a profile, game, message or highlight to report it. The report reaches moderators with the context attached.",
      "Blocking stops messages, follows and join requests both ways, and the other person isn't told. Manage blocks from Account, then Blocked users.",
      "Reports are reviewed by people. Actions range from a warning or removing content to a suspension or a permanent ban, and every action is logged.",
      EMERGENCY_NOTICE,
    ],
    links: ["safety_center", "blocked_users", "child_safety", "contact"],
  },
  {
    id: "privacy-and-data",
    title: "Privacy and your data",
    summary: "You choose what others can see, and you can delete your account yourself.",
    points: [
      "Your profile visibility, avatar visibility and contact details are controlled in Privacy settings.",
      "Your birthday is never shown publicly. Only an age group is used to run age-appropriate features.",
      "Other players see approximate location only, and minors are always kept at reduced precision.",
      "You can turn off AI processing of your uploads in Privacy settings.",
      "You can delete your account from Account, then Privacy. Some records, such as moderation logs, are kept where needed to keep the service safe.",
    ],
    links: ["privacy_settings", "privacy", "ai_disclosure"],
  },
  {
    id: "decisions-and-appeals",
    title: "Reports, suspensions and appeals",
    summary: "People at BallaCity make these decisions, and only they can change them.",
    points: [
      "Reports and account actions are decided by people on the BallaCity team. This assistant cannot look up, explain, change or reverse a decision.",
      "If you think a decision was wrong, reply to the report or email support from the address on your account.",
    ],
    links: ["contact"],
  },
  {
    id: "contact-support",
    title: "Contacting support",
    summary: `Email ${SUPPORT_EMAIL}.`,
    points: [
      `Email ${SUPPORT_EMAIL} from the address on your account.`,
      "For a game, include the game name and date. For a bug or a billing question, add a screenshot and the page you were on.",
      "Never put card numbers, passwords or one-time codes in an email.",
    ],
    links: ["contact"],
  },
];

export function getSupportTopic(id: string): SupportTopic | undefined {
  return SUPPORT_TOPICS.find((t) => t.id === id);
}

/** The library as plain text for the model. Order and wording match the quick answers. */
export function supportLibraryText(): string {
  return SUPPORT_TOPICS.map(
    (t) => `## ${t.title}\n${t.summary}\n${t.points.map((p) => `- ${p}`).join("\n")}`,
  ).join("\n\n");
}
