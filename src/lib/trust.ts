/**
 * Canonical Trust Center copy.
 *
 * Plain-language explanations of how OpenRun handles privacy, security, user
 * safety, payments, AI, account deletion, and moderation. These describe how
 * the product currently behaves — they intentionally make no certification,
 * audit, or regulatory-compliance claims. Anything legal-facing lives in
 * `legal-documents.ts` and is labeled for review by counsel.
 */

export const SUPPORT_EMAIL = "support@openrun.app";

export type TrustTopic = {
  id: string;
  title: string;
  summary: string;
  points: string[];
};

export const TRUST_TOPICS: TrustTopic[] = [
  {
    id: "privacy",
    title: "Privacy",
    summary: "You choose what other players can see about you.",
    points: [
      "Your profile visibility, avatar visibility, and contact details are controlled from Privacy settings.",
      "Approximate location is used to show nearby games and players. Exact coordinates are rounded before other players see distance.",
      "Location precision can be set to city level, and minors are always kept at reduced precision.",
      "Your birthday is never shown publicly — only an age category is used to run age-appropriate features.",
      "We do not sell your personal information.",
    ],
  },
  {
    id: "security",
    title: "Security",
    summary: "Accounts and data are protected in transit and by per-user database rules.",
    points: [
      "Traffic to OpenRun uses HTTPS.",
      "Sign-in is handled by our authentication provider with email/password or Google sign-in.",
      "Database access is enforced per row and per user, so a request can only read the data that account is allowed to see.",
      "Uploads (avatars, game covers, highlight reels) are checked for ownership before they can be written or replaced.",
      "You can change your password or send yourself a reset link from Password & sign-in.",
    ],
  },
  {
    id: "user-safety",
    title: "User safety",
    summary: "Reporting and blocking are available everywhere people interact.",
    points: [
      "Use the flag icon on a profile, game, message, or highlight to report it. Reports include what you saw and when.",
      "Reports go to OpenRun moderators with an audit trail.",
      "Blocking stops messages, follows, and join requests both ways, and is not disclosed to the other person.",
      "Manage everyone you've blocked from Account → Blocked users.",
    ],
  },
  {
    id: "payments",
    title: "Payments",
    summary: "Game fees are paid person-to-person. OpenRun is not a payment processor.",
    points: [
      "Hosts publish the fee and their own payment handle (for example Venmo, Zelle, or cash).",
      "You pay the host directly through that service. Money never moves through OpenRun.",
      "OpenRun records that you marked a payment as sent and lets the host confirm, reject, or dispute it.",
      "Because payments are direct, OpenRun cannot reverse a transfer or issue a refund — ask the host, then the payment service.",
      "Subscriptions for OpenRun plans are separate and handled by our billing provider.",
    ],
  },
  {
    id: "ai",
    title: "AI",
    summary: "AI helps draft highlight captions. It can be wrong, and you can opt out.",
    points: [
      "Reel Coach analyzes an uploaded clip to suggest a title, caption, on-screen text, and hashtags.",
      "Suggestions are drafts. You review and edit everything before it is published.",
      "AI does not judge players, decide skill levels, or moderate accounts.",
      "AI output can be inaccurate or miss context — it is not a scouting or officiating tool.",
      "You can turn AI processing of your uploads off in Privacy settings.",
    ],
  },
  {
    id: "account-deletion",
    title: "Account deletion",
    summary: "You can export what you shared and delete your account yourself.",
    points: [
      "Delete your account from Account → Privacy. The action asks you to confirm.",
      "Deletion removes your profile details, avatar, uploaded media, availability, and preferences.",
      "Content other people rely on (such as a past game's existence) may remain without your name attached.",
      "Some records are kept where required to keep the service and safety history working, such as moderation logs.",
      "Reach out at " + SUPPORT_EMAIL + " if you want help with your data.",
    ],
  },
  {
    id: "moderation",
    title: "Moderation",
    summary: "Reports are reviewed by people, with actions recorded.",
    points: [
      "Every report lands in a moderation queue with its status: open, reviewing, actioned, or dismissed.",
      "Moderators can warn an account, remove content, suspend, or ban depending on what happened.",
      "Every moderator action is written to an audit log.",
      "Repeated or severe violations of the Community Guidelines can end in a permanent ban.",
      "If you think a decision was wrong, reply to the report or contact support.",
    ],
  },
];

export type GuidelineRule = {
  id: string;
  title: string;
  points: string[];
};

export const COMMUNITY_GUIDELINES: GuidelineRule[] = [
  {
    id: "respect",
    title: "Respect other players",
    points: [
      "No harassment, threats, hate speech, or slurs.",
      "No sexual content, and never sexualize a minor — accounts doing so are removed.",
      "Keep competitive trash talk out of personal attacks.",
    ],
  },
  {
    id: "honesty",
    title: "Be honest",
    points: [
      "Use your real name or the name people know you by, and your own photo.",
      "Post accurate game details: venue, time, skill level, fee, and player limit.",
      "Don't impersonate another player, team, gym, or trainer.",
    ],
  },
  {
    id: "safe-play",
    title: "Play safely",
    points: [
      "Follow facility rules and staff instructions.",
      "Don't play while impaired.",
      "No intentionally dangerous play, and stop when someone is hurt.",
    ],
  },
  {
    id: "money",
    title: "Keep money clean",
    points: [
      "Charge only the fee you posted.",
      "Never ask for payment credentials, logins, or verification codes.",
      "No scams, chargeback abuse, or pressure to pay off-app.",
    ],
  },
  {
    id: "content",
    title: "Content you upload",
    points: [
      "Upload only clips you have the right to share.",
      "No spam, resale posts, or unrelated promotion.",
      "Flag low-quality or misleading reels instead of reposting them.",
    ],
  },
];

export const GUIDELINES_ENFORCEMENT =
  "Breaking these guidelines can lead to a warning, content removal, suspension, or a permanent ban, depending on what happened and whether it repeats.";
