/**
 * Canonical AI video analysis transparency copy.
 *
 * One source of truth for what we tell users before, during, and after AI
 * analysis of an uploaded clip. Deliberately plain-language: it describes how
 * the product behaves today and makes no accuracy claim. Legal-facing text
 * lives in `legal-documents.ts`.
 */

/** Shown before a clip is uploaded for AI analysis. */
export const AI_DISCLOSURE_POINTS: string[] = [
  "Your video is sent to an AI service and analyzed automatically.",
  "AI results can be wrong, incomplete, or miss things entirely.",
  "Any rating, level, or score the AI suggests is an estimate, not a measurement.",
  "Treat everything the AI writes as a suggestion to review — not as fact.",
  "Don't use AI results as the only basis for medical, safety, recruiting, employment, or other high-stakes decisions.",
];

export type AiDataUseItem = { question: string; answer: string };

/** What happens to the video and the results. */
export const AI_DATA_USE: AiDataUseItem[] = [
  {
    question: "Why is the video processed?",
    answer:
      "To create your highlight — a title, caption, hashtags, suggested clip moments, and coaching notes for you.",
  },
  {
    question: "Is the original video kept?",
    answer:
      "Yes, in your private storage, so your reel can play and be re-processed. Deleting the reel deletes the original.",
  },
  {
    question: "Is the processed video kept?",
    answer:
      "We keep a phone-friendly copy plus a few still frames and an audio track taken from your clip. They're deleted with the reel.",
  },
  {
    question: "How are AI results stored?",
    answer:
      "Attached to your reel row in your account, readable only by you unless you publish the reel to the highlight feed.",
  },
  {
    question: "How do I delete it?",
    answer:
      "From AI & Video Privacy: delete just the AI results and keep your video, delete the video and everything with it, or delete your whole account.",
  },
];

/** Current AI training position. Do not soften this without a reviewed policy. */
export const AI_TRAINING_NOTE = {
  title: "Your videos are not used to train AI",
  body: "ballaCity does not send your clips to be used as training data for AI models. If that ever changes, it will be a separate opt-in setting below — turning on AI analysis never turns on training.",
  settingLabel: "Allow my uploaded videos to be used to improve/train AI",
  settingDescription:
    "Off by default and separate from AI analysis. Nothing is used for training today; if training is ever offered, this switch is what controls it.",
} as const;

/** One-line reminder to sit next to results. */
export const AI_RESULTS_CAVEAT =
  "AI-generated — estimates only, and sometimes wrong. Review before you rely on it.";
