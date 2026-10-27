/**
 * Deterministic guardrails for BallaCity Help, plus support-ticket drafting.
 *
 * The AI assistant is the soft layer of the help feature. This module is the
 * hard one: it runs BEFORE any model call and cannot be argued with. A member's
 * message that matches a high-risk situation gets a fixed, reviewed reply and
 * never reaches the model, so no prompt, however clever, changes what is said
 * about an emergency, a child-safety concern, an account decision, a request
 * for someone's private details, or an attempt to get around the rules.
 *
 * Matching is intentionally broad. A false positive costs a member one
 * slightly stiff answer that still points them somewhere useful; a miss on any
 * of these is the expensive failure.
 *
 * Client-safe and pure: the drawer imports it to build the ticket draft.
 */

import { EMERGENCY_NOTICE } from "@/lib/safety";
import { SUPPORT_EMAIL } from "@/lib/trust";
import type { SupportLinkKey } from "./knowledge";

export const SUPPORT_MAX_MESSAGE = 600;
export const SUPPORT_MAX_HISTORY = 6;
export const SUPPORT_MAX_HISTORY_ITEM = 800;

export type TicketCategory =
  | "payment_dispute"
  | "account_action"
  | "safety_report"
  | "billing_or_bug"
  | "privacy_request"
  | "other";

export const TICKET_CATEGORIES: readonly TicketCategory[] = [
  "payment_dispute",
  "account_action",
  "safety_report",
  "billing_or_bug",
  "privacy_request",
  "other",
];

export function isTicketCategory(v: unknown): v is TicketCategory {
  return typeof v === "string" && (TICKET_CATEGORIES as readonly string[]).includes(v);
}

export type HardKind =
  "emergency" | "child_safety" | "jailbreak" | "private_info" | "account_action";

export type GuardrailReply = {
  kind: HardKind;
  answer: string;
  links: SupportLinkKey[];
  escalation: TicketCategory | null;
};

const HARD_REPLIES: Record<HardKind, Omit<GuardrailReply, "kind">> = {
  emergency: {
    answer: `${EMERGENCY_NOTICE} If you are thinking about hurting yourself, please call or text 988 (in the US) or your local crisis line right now. You don't have to go through it alone.`,
    links: ["safety_center", "contact"],
    escalation: null,
  },
  child_safety: {
    answer: `I'm sorry this is happening. If a child is in immediate danger, contact your local emergency number (911 in the US) first. To report someone or something on BallaCity, tap the flag icon on the profile, message, game or highlight: it goes to moderators with the context attached, and reports are reviewed by people. You can also email ${SUPPORT_EMAIL}. Please don't email photos or a child's personal details.`,
    links: ["child_safety", "safety_center", "contact"],
    escalation: "safety_report",
  },
  jailbreak: {
    answer: `I can only help with questions about using BallaCity, and I can't change my rules or help get around moderation, blocks, bans, or age and parental-approval settings. If something went wrong with your account, email ${SUPPORT_EMAIL} and a person will take a look.`,
    links: ["contact"],
    escalation: null,
  },
  private_info: {
    answer:
      "I can't look up, share or confirm anyone's personal details, such as contact information, addresses, schools, or whether someone is a minor, and I can't see profiles. To reach someone, use BallaCity messages where they're allowed. If something worries you, report it with the flag icon. To control what others can see about you, use Privacy settings.",
    links: ["privacy_settings", "safety_center"],
    escalation: null,
  },
  account_action: {
    answer: `Account decisions, such as suspensions, bans and appeals, are made by people on the BallaCity team. I can't look up, explain or change them. Email ${SUPPORT_EMAIL} from the address on your account and tell them what happened. I've drafted an email you can send.`,
    links: ["contact"],
    escalation: "account_action",
  },
};

/** Normalise before matching: compatibility forms, zero-width characters, spacing. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u200B-\u200F\u2060\uFEFF\u00AD]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const EMERGENCY =
  /\b(911|ambulance|unconscious|not breathing|stopped breathing|heart attack|seizure|bleeding (badly|out)|suicid\w*|kill (myself|me)|end my life|end it all|want to die|self[- ]?harm|hurt(ing)? myself|overdos\w*)\b/;

const CHILD_ABUSE_TERMS =
  /\b(groom(ed|ing|er)?|predator|pedophil\w*|paedophil\w*|child (porn\w*|abuse|exploitation|predator)|csam|sextort\w*)\b/;
const MINOR_REFERENCE =
  /\b(my (child|kid|kids|son|daughter|boy|girl|teen|teenager)|a (child|kid|minor|teen|teenager)|minors?|under ?age|\d{1,2} ?(yo|y\/o|year[- ]old))\b/;
const CHILD_CONCERN =
  /\b(sexual\w*|naked|nudes?|nudity|inappropriate|creepy|grop\w*|touch(ed|ing)|asked (him|her|them|me) for (photos?|pics?|nudes?)|send(ing)? (photos?|pics?|nudes?)|meet (alone|in private|privately|secretly)|keep (it|this) (a )?secret|stalk\w*|threaten\w*)\b/;

const JAILBREAK =
  /(\b(ignore|disregard|forget|override)\b[^.?!]{0,40}\b(instructions|rules|prompts?|guidelines|polic(y|ies)|restrictions)\b|(reveal|show|print|repeat|leak) (me )?(your |the )?(system|hidden|initial|developer) (prompt|message|instructions)|system prompt|developer (message|mode)|jailbreak|\bdan mode\b|pretend (you are|you're|to be)|act as (an? )?(unfiltered|unrestricted|different)|you are no longer|new rules:|bypass (the |a |our )?(moderation|filters?|safety|blocks?|bans?|age|parental)|(get|work) (a)?round (a |the |my )?(ban|block|moderation|filters?|age (limit|check|gate)|parental)|evad(e|ing) (a |the |my )?(ban|block|moderation)|fake (my |a )?(age|birthday|birthdate))/;

const PRIVATE_ITEM =
  /\b(phone( number)?|cell( number)?|mobile number|home address|address|where (he|she|they|\w+) lives?|e-?mail( address)?|last name|full name|real name|school|birthday|birth ?date|how old|schedule|instagram|snap(chat)?|tiktok|socials?|social media)\b/;
const THIRD_PARTY =
  /\b(his|her|their|him|them|she|he|(this|that|the) (guy|girl|kid|child|boy|person|player|host|coach|user|member)|someone|somebody|another (player|user|member|kid)|other (players?|users?|members?|kids)|my (son|daughter|kid|child)'?s?|(host|coach|player|user|member|kid|child)'?s)\b/;
const REQUEST_VERB =
  /\b(what('?s| is| are)|give me|tell me|show me|find( out)?|look ?up|get|reveal|share|send me|need|know|can you (get|find|tell)|how (can|do) i (find|get|see|contact))\b/;

const ACCOUNT_ACTION =
  /\b(suspend(ed|ing)?|suspension|banned?|banning|deactivat(ed|ion)|appeal(ing)?|reinstat\w*|unban\w*|account (was|got|has been|is) (disabled|removed|closed|locked)|(disabled|removed|closed) my account)\b/;

export function classifyHard(message: string): GuardrailReply | null {
  const t = normalizeForMatch(message);
  if (!t) return null;
  let kind: HardKind | null = null;
  if (EMERGENCY.test(t)) kind = "emergency";
  else if (CHILD_ABUSE_TERMS.test(t) || (MINOR_REFERENCE.test(t) && CHILD_CONCERN.test(t)))
    kind = "child_safety";
  else if (JAILBREAK.test(t)) kind = "jailbreak";
  else if (PRIVATE_ITEM.test(t) && THIRD_PARTY.test(t) && REQUEST_VERB.test(t))
    kind = "private_info";
  else if (ACCOUNT_ACTION.test(t)) kind = "account_action";
  return kind ? { kind, ...HARD_REPLIES[kind] } : null;
}

const SAFETY_REPORT =
  /\b(harass\w*|threat\w*|stalk\w*|assault\w*|abus(e|ed|ive|ing)|unsafe|bull(y|ied|ying)|hate speech|racist|doxx\w*|report (a|this|him|her|them|someone|player|host))\b/;
const PAYMENT_DISPUTE =
  /\b(refund(s|ed)?|charge ?back|dispute[sd]?|scam(s|med|mer)?|fraud\w*|ripped off|stole|stolen|didn'?t (get|receive)|never (got|received)|money back|not refunded|overcharg\w*|charged me)\b/;
const PRIVACY_REQUEST =
  /\b(delete (my )?(account|data)|export (my )?data|my data|gdpr|ccpa|data request)\b/;
const BILLING_OR_BUG =
  /\b(billing|invoice|subscription|bug|glitch|crash\w*|not working|broken|can'?t (log ?in|sign ?in)|won'?t load|error message)\b/;

/**
 * Situations the model may answer but a person should also see. Applied on top
 * of whatever the model says, so a model that forgets to escalate cannot hide
 * a dispute or a safety report.
 */
export function softEscalation(message: string): TicketCategory | null {
  const t = normalizeForMatch(message);
  if (SAFETY_REPORT.test(t)) return "safety_report";
  if (PAYMENT_DISPUTE.test(t)) return "payment_dispute";
  if (PRIVACY_REQUEST.test(t)) return "privacy_request";
  if (BILLING_OR_BUG.test(t)) return "billing_or_bug";
  return null;
}

/** Links that always accompany an escalation, whatever the model chose. */
export const ESCALATION_LINKS: Record<TicketCategory, SupportLinkKey[]> = {
  payment_dispute: ["payment_policy", "safety_center"],
  account_action: ["contact"],
  safety_report: ["safety_center", "blocked_users"],
  billing_or_bug: ["contact"],
  privacy_request: ["privacy_settings"],
  other: ["contact"],
};

// ---------------------------------------------------------------------------
// Ticket drafting
// ---------------------------------------------------------------------------

export type TicketDraft = {
  category: TicketCategory;
  subject: string;
  body: string;
  mailto: string;
};

const TICKET_TITLES: Record<TicketCategory, string> = {
  payment_dispute: "Payment or refund question",
  account_action: "Account decision",
  safety_report: "Safety report",
  billing_or_bug: "Billing or bug",
  privacy_request: "Privacy or data request",
  other: "Question",
};

const TICKET_PROMPTS: Record<TicketCategory, string[]> = {
  payment_dispute: [
    "Game name and date:",
    "Host's name on BallaCity:",
    "How you paid (app and date), without any account numbers:",
  ],
  account_action: ["Date it happened:", "What you saw on screen:"],
  safety_report: [
    "What happened, when and where on BallaCity:",
    "A link to the profile, game or message, if you have it:",
  ],
  billing_or_bug: ["The page you were on:", "What you expected and what happened:"],
  privacy_request: ["What you'd like us to do:"],
  other: ["Game name and date, if it's about a game:"],
};

const BODY_LIMIT = 1500;

/** What a member's own words become inside the email: one trimmed paragraph. */
function clip(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * A ready-to-send email to support. Nothing is stored or sent from here: the
 * member opens it in their own mail app and decides whether to send it.
 * Card numbers, passwords and codes are never requested.
 */
export function draftTicket(input: {
  category: TicketCategory;
  /** The member's own description, usually their last message. */
  description?: string | null;
  accountEmail?: string | null;
}): TicketDraft {
  const { category } = input;
  const subject = `[BallaCity] ${TICKET_TITLES[category]}`;
  const lines: string[] = ["Hi BallaCity support,", ""];
  lines.push(`Account email: ${clip(input.accountEmail ?? "", 120) || "(please fill in)"}`);
  const mine = clip(input.description ?? "", 600);
  lines.push(`What happened, in my words: ${mine || "(please fill in)"}`);
  for (const p of TICKET_PROMPTS[category]) lines.push(p);
  lines.push("");
  if (category === "safety_report") {
    lines.push(
      "If anyone is in immediate danger I have already contacted my local emergency number.",
      "I won't include a child's full name, address or photos here; the in-app flag icon sends the content to moderators with its context.",
    );
  }
  lines.push("I have not included card numbers, passwords or one-time codes.");
  const body = lines.join("\n").slice(0, BODY_LIMIT);
  const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return { category, subject, body, mailto };
}
