/**
 * Structured review questions, praise tags and answer values (rating system,
 * step 2). One shared definition for the review form, the server function and
 * the database trigger: `review-questions.test.ts` pins the SQL lists in
 * `20261021120000_review_questions.sql` to the ones here, so a key can't be
 * added on one side and silently rejected on the other.
 *
 * Why these instead of ten 1–5 sliders: people answer a plain yes/no about
 * behaviour more honestly and faster than they place a number on "Leadership",
 * and the answers are comparable between reviewers. Things the app already
 * measures (showing up, lateness, cancellations) are deliberately NOT asked.
 */

export type ReviewTargetKind = "player" | "trainer" | "team" | "host";

export const REVIEW_TARGET_KINDS: readonly ReviewTargetKind[] = [
  "player",
  "trainer",
  "team",
  "host",
];

/** The headline question: would you do this with them again? */
export const RECOMMEND_VALUES = ["yes", "not_sure", "no"] as const;
export type Recommend = (typeof RECOMMEND_VALUES)[number];

export const RECOMMEND_LABELS: Record<Recommend, string> = {
  yes: "Yes",
  not_sure: "Not sure",
  no: "No",
};

/** Behaviour questions are answered Yes / Mostly / No. */
export const ANSWER_VALUES = ["yes", "mostly", "no"] as const;
export type Answer = (typeof ANSWER_VALUES)[number];

export const ANSWER_LABELS: Record<Answer, string> = {
  yes: "Yes",
  mostly: "Mostly",
  no: "No",
};

/** Most praise tags one review can carry. */
export const MAX_TAGS = 5;

export const RECOMMEND_COPY: Record<
  ReviewTargetKind,
  { prompt: string; /** Sentence after "12 of 14 …" / "94% …". */ stat: string }
> = {
  player: { prompt: "Would you play with them again?", stat: "would play with them again" },
  host: { prompt: "Would you join their games again?", stat: "would join their games again" },
  trainer: { prompt: "Would you book them again?", stat: "would book them again" },
  team: { prompt: "Would you recommend this team?", stat: "recommend this team" },
};

export type ReviewQuestion = {
  key: string;
  label: string;
  /**
   * A "No" here is a safety concern, not just a low mark: it is also sent to
   * the moderators' report queue (the form says so before it is submitted).
   */
  safety?: true;
};

export const REVIEW_QUESTIONS: Record<ReviewTargetKind, readonly ReviewQuestion[]> = {
  player: [
    { key: "fair", label: "Played fair and accepted calls" },
    { key: "respect", label: "Respectful to everyone" },
    { key: "teammate", label: "Played as a teammate" },
  ],
  host: [
    { key: "accurate", label: "The game matched the listing (time, place, level, price)" },
    { key: "fairRules", label: "Fair teams and rules" },
    { key: "safe", label: "Felt safe and well run", safety: true },
  ],
  trainer: [
    { key: "clear", label: "Clear, knowledgeable instruction" },
    { key: "value", label: "Worth the time and money" },
    { key: "safe", label: "Felt safe", safety: true },
  ],
  team: [
    { key: "organised", label: "Organised and communicates well" },
    { key: "playingTime", label: "Fair playing time" },
    { key: "welcoming", label: "Welcoming culture" },
  ],
};

export type PraiseTag = { key: string; label: string };

/**
 * Player tags that match a sportsmanship trait use the trait's own key
 * (respectful, communicative, fairPlay, positive, onTime) so badges can count
 * them directly — see `player_trait_counts`.
 */
export const PRAISE_TAGS: Record<ReviewTargetKind, readonly PraiseTag[]> = {
  player: [
    { key: "respectful", label: "Respectful" },
    { key: "communicative", label: "Great communicator" },
    { key: "fairPlay", label: "Plays fair" },
    { key: "positive", label: "Positive energy" },
    { key: "onTime", label: "Always on time" },
    { key: "teamPlayer", label: "Team player" },
    { key: "hustle", label: "Brings the effort" },
    { key: "welcoming", label: "Welcoming to new players" },
  ],
  host: [
    { key: "organized", label: "Well organised" },
    { key: "fairTeams", label: "Fair teams" },
    { key: "clearComms", label: "Clear communication" },
    { key: "wellRun", label: "Safe and well run" },
    { key: "greatVenue", label: "Great venue" },
    { key: "welcomingHost", label: "Welcoming" },
  ],
  trainer: [
    { key: "knowledgeable", label: "Knowledgeable" },
    { key: "motivating", label: "Motivating" },
    { key: "patient", label: "Patient" },
    { key: "explainsClearly", label: "Explains clearly" },
    { key: "prepared", label: "Well prepared" },
    { key: "safetyMinded", label: "Safety-minded" },
  ],
  team: [
    { key: "organized", label: "Well organised" },
    { key: "welcomingTeam", label: "Welcoming" },
    { key: "fairPlayingTime", label: "Fair playing time" },
    { key: "goodCoaching", label: "Good coaching" },
    { key: "competitive", label: "Competitive" },
    { key: "fun", label: "Fun culture" },
  ],
};

export function tagLabel(kind: ReviewTargetKind, key: string): string {
  return PRAISE_TAGS[kind].find((t) => t.key === key)?.label ?? key;
}

export class ReviewInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewInputError";
  }
}

export type ReviewExtras = {
  recommend: Recommend;
  answers: Record<string, Answer>;
  tags: string[];
};

const isRecommend = (v: unknown): v is Recommend =>
  typeof v === "string" && (RECOMMEND_VALUES as readonly string[]).includes(v);
const isAnswer = (v: unknown): v is Answer =>
  typeof v === "string" && (ANSWER_VALUES as readonly string[]).includes(v);

/**
 * Validates the structured part of a submitted review against this kind's
 * question and tag lists. Anything unknown is rejected rather than dropped, so
 * a tampered or stale client gets an error instead of a quietly different
 * review. (The database trigger enforces the same rules again.)
 */
export function normalizeReviewExtras(
  kind: ReviewTargetKind,
  input: { recommend?: unknown; answers?: unknown; tags?: unknown },
): ReviewExtras {
  if (!isRecommend(input.recommend)) {
    throw new ReviewInputError("Tell us whether you would do this again.");
  }

  const allowedQuestions = new Set(REVIEW_QUESTIONS[kind].map((q) => q.key));
  const answers: Record<string, Answer> = {};
  const rawAnswers = input.answers ?? {};
  if (typeof rawAnswers !== "object" || rawAnswers === null || Array.isArray(rawAnswers)) {
    throw new ReviewInputError("Invalid answers.");
  }
  for (const [key, value] of Object.entries(rawAnswers)) {
    if (!allowedQuestions.has(key) || !isAnswer(value)) {
      throw new ReviewInputError("Invalid answers.");
    }
    answers[key] = value;
  }

  const allowedTags = new Set(PRAISE_TAGS[kind].map((t) => t.key));
  const rawTags = input.tags ?? [];
  if (!Array.isArray(rawTags)) throw new ReviewInputError("Invalid tags.");
  const tags: string[] = [];
  for (const t of rawTags) {
    if (typeof t !== "string" || !allowedTags.has(t)) throw new ReviewInputError("Invalid tags.");
    if (!tags.includes(t)) tags.push(t);
  }
  if (tags.length > MAX_TAGS) throw new ReviewInputError(`Pick up to ${MAX_TAGS} tags.`);

  return { recommend: input.recommend, answers, tags };
}

/** The first safety question answered "No", or null. */
export function safetyConcern(
  kind: ReviewTargetKind,
  answers: Record<string, Answer | undefined>,
): ReviewQuestion | null {
  return REVIEW_QUESTIONS[kind].find((q) => q.safety && answers[q.key] === "no") ?? null;
}
