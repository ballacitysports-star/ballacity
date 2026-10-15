/**
 * Canonical safety + risk-acknowledgment copy.
 *
 * All player-facing safety language lives here so the join flow, the create
 * flow, and the Safety Center never drift. Every string marked
 * `LEGAL_REVIEW_LABEL` is placeholder wording pending review by counsel.
 *
 * IMPORTANT: the acknowledgments below are NOT a legally sufficient waiver or
 * release of liability. They are a plain-language notice that the activity
 * carries risk. Legal counsel must review and replace this copy.
 */

import { isLegalReviewed } from "@/lib/legal-review";

export const LEGAL_REVIEW_LABEL = "LEGAL REVIEW REQUIRED";

/** Appended to the acknowledgment disclaimers until counsel has reviewed them. */
const PENDING_REVIEW = isLegalReviewed("safetyAcknowledgments")
  ? ""
  : " and is pending legal review";

/** Bump when the acknowledgment wording changes; stored with every consent. */
export const SAFETY_ACK_VERSION = "2026-01-draft-1";

export type SafetyAckKind = "participant_risk" | "host_responsibility";

export const RISK_ACKNOWLEDGMENT = {
  kind: "participant_risk" as SafetyAckKind,
  version: SAFETY_ACK_VERSION,
  title: "Before you join",
  /** Configurable legal text — replace after review. */
  text:
    "Sports and recreational activities involve inherent risks, including injury. " +
    "By joining this activity, you acknowledge these risks and agree to follow applicable " +
    "facility, host, and safety rules.",
  checkboxLabel:
    "I acknowledge the risks of this activity and agree to follow facility, host, and safety rules.",
  points: [
    "Games are organized by the host, not by BallaCity. BallaCity does not supervise, referee, or inspect venues.",
    "Play within your ability, warm up, and stop if you're injured or unwell.",
    "Follow the venue's rules and any staff instructions while you're there.",
    "You are responsible for your own health, insurance, and equipment.",
  ],
  disclaimer: `This acknowledgment is not a waiver or release of liability${PENDING_REVIEW}.`,
} as const;

export const HOST_RESPONSIBILITY = {
  kind: "host_responsibility" as SafetyAckKind,
  version: SAFETY_ACK_VERSION,
  title: "Your responsibilities as host",
  /** Configurable legal text — replace after review. */
  text:
    "You are organizing this individual game. You are responsible for the accuracy of the " +
    "game information you publish, the venue and its access rules, communicating cancellations " +
    "or changes, and the conduct expected of players you invite. BallaCity does not organize, " +
    "supervise, or guarantee the safety of any game.",
  checkboxLabel:
    "I understand I'm responsible for organizing this game and the accuracy of its details.",
  points: [
    "Post accurate date, time, venue, skill level, and player limit — update them if anything changes.",
    "Confirm you're allowed to use the court, field, or facility, and share its rules with players.",
    "Tell players promptly if you cancel, move, or reschedule.",
    "Set the conduct you expect, and report players who behave unsafely.",
    "Never claim BallaCity guarantees safety, supervision, or insurance for your game.",
  ],
  disclaimer: `This acknowledgment is not a waiver or release of liability${PENDING_REVIEW}.`,
} as const;

export function ackCopy(kind: SafetyAckKind) {
  return kind === "participant_risk" ? RISK_ACKNOWLEDGMENT : HOST_RESPONSIBILITY;
}

/**
 * Whether the risk notice must be shown before a join proceeds. Hosts managing
 * their own game and players already on the roster are not re-prompted, and a
 * player who already acknowledged the current version for this game is done.
 */
export function needsRiskAcknowledgment(input: {
  signedIn: boolean;
  isHost: boolean;
  alreadyJoined: boolean;
  acknowledgedVersion?: string | null;
}): boolean {
  if (!input.signedIn) return false; // sign-in gate runs first
  if (input.isHost || input.alreadyJoined) return false;
  return input.acknowledgedVersion !== SAFETY_ACK_VERSION;
}

/** Info hosts are encouraged to provide. Drives the create-flow checklist. */
export type GameInfoTip = {
  id: string;
  label: string;
  hint: string;
};

export const GAME_INFO_TIPS: GameInfoTip[] = [
  {
    id: "facility",
    label: "Facility name",
    hint: "Name the park, gym, or complex — not just a street.",
  },
  {
    id: "court",
    label: "Court or field",
    hint: "Add the court number or field so players find you.",
  },
  {
    id: "indoor",
    label: "Indoor or outdoor",
    hint: "Set the indoor toggle so players dress for it.",
  },
  {
    id: "time",
    label: "Start time & duration",
    hint: "Include end time so players plan around it.",
  },
  { id: "skill", label: "Skill level", hint: "Keeps the run competitive and safe for everyone." },
  { id: "limit", label: "Player limit", hint: "Avoid overcrowding the space you booked." },
  {
    id: "rules",
    label: "House rules & what to bring",
    hint: "Refs, gear, entry code, parking, water.",
  },
  {
    id: "contact",
    label: "How to reach you",
    hint: "Use in-app messages — no need to share your phone number.",
  },
];

export const ADDRESS_PRIVACY_NOTE =
  "Use a public court, park, gym, or facility whenever you can. Avoid publishing a private residential address — share exact access details in chat with confirmed players instead.";

export const EMERGENCY_NOTICE =
  "BallaCity is not an emergency service. If someone is in danger or seriously injured, contact your local emergency number (911 in the US) immediately. Report the incident in BallaCity afterwards so moderators can act.";

/** Plain-language intro for the Safety Center "Stay safe" section. */
export const STAY_SAFE_POINTS: string[] = [
  "Read the whole game post before you commit — venue, court, time, skill level, and cost.",
  "Play at public sporting facilities and arrive a few minutes early to look the space over.",
  "Keep conversations in BallaCity so moderators can review them if something goes wrong.",
  "Share only what a game needs — you never have to give out your address, ID, or financial details.",
  "Trust your instincts. You can leave any game, decline any request, and block anyone.",
  "Report unsafe behavior with the flag icon so moderators can act on it.",
];

export const SAFETY_TOPICS: { id: string; title: string; points: string[] }[] = [
  {
    id: "sports",
    title: "General sports safety",
    points: [
      "Warm up, hydrate, and stretch — most pickup injuries are avoidable.",
      "Play at a level that matches the game's posted skill level.",
      "Bring your own gear and check the surface before playing.",
      "Stop playing if you're hurt, dizzy, or overheated.",
    ],
  },
  {
    id: "meeting",
    title: "Meeting new players",
    points: [
      "Meet at the posted public venue, never at a private residence you don't know.",
      "Tell a friend where you're going and when you expect to be back.",
      "Check the player's profile and reviews before agreeing to anything off-app.",
      "Trust your instincts — you can leave any game at any time.",
      "Communicate through BallaCity instead of moving to personal channels early.",
      "Avoid sharing unnecessary personal information such as your home address or workplace.",
    ],
  },
  {
    id: "game",
    title: "Game safety",
    points: [
      "Read the full game details: venue, court, indoor/outdoor, skill, and player limit.",
      "Arrive a few minutes early so you can look the space over.",
      "Ask the host about facility rules, entry, and parking before you commit.",
      "If the game looks nothing like it was described, don't play — report it.",
      "Follow the facility's rules and any staff instructions while you're there.",
      "Respect other participants — no aggressive play, harassment, or trash talk that crosses the line.",
      "Never participate while impaired by alcohol or drugs.",
      "Bring appropriate equipment for the sport and surface.",
      "Know your physical limitations and sit out when you need to.",
      "Report unsafe behavior to the host and to BallaCity.",
    ],
  },
  {
    id: "payments",
    title: "Payment safety",
    points: [
      "BallaCity is not a payment processor. Entry fees are paid directly to the host.",
      "Never send money before the game is confirmed, and never pay more than the posted fee.",
      "Keep a receipt or screenshot of what you sent.",
      "Report anyone who pressures you to pay off-app or refuses to confirm payment.",
      "BallaCity never requests banking passwords, card PINs, or one-time codes.",
      "Never share payment credentials, logins, or account recovery codes with anyone.",
      "Confirm the host and the game before sending money.",
      "Be cautious of payment scams: pressure to pay fast, changed handles, or refund overpayment requests.",
    ],
  },
  {
    id: "messaging",
    title: "Messaging safety",
    points: [
      "Keep conversations in BallaCity so moderators can review them if something goes wrong.",
      "Don't share your home address, financial details, or ID documents.",
      "Block anyone who makes you uncomfortable — they can't message or follow you afterwards.",
      "Block users who bother you — blocking is private and stops messages, follows, and join requests.",
      "Report inappropriate messages with the flag icon in the conversation.",
      "Avoid sharing sensitive personal information in chat.",
    ],
  },
  {
    id: "reporting",
    title: "Reporting",
    points: [
      "Use the flag icon on a profile, game, message, or highlight to report it.",
      "Safety reports go straight to BallaCity moderators with an audit trail.",
      "Include details: what happened, when, and where.",
    ],
  },
  {
    id: "blocking",
    title: "Blocking",
    points: [
      "Blocking stops messages, follows, and join requests between you both.",
      "Manage everyone you've blocked from Account → Blocked accounts.",
      "Blocking is private — the other person isn't notified.",
    ],
  },
];
