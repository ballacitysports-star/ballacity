import { describe, expect, it } from "vitest";
import {
  AI_DATA_USE,
  AI_DISCLOSURE_POINTS,
  AI_RESULTS_CAVEAT,
  AI_TRAINING_NOTE,
} from "./ai-video-privacy";
import { DEFAULT_PRIVACY } from "./privacy";

describe("AI video disclosure copy", () => {
  it("covers every required disclosure point", () => {
    const all = AI_DISCLOSURE_POINTS.join(" ").toLowerCase();
    for (const term of [
      "ai",
      "wrong",
      "estimate",
      "suggestion",
      "medical",
      "safety",
      "recruiting",
      "employment",
    ]) {
      expect(all).toContain(term);
    }
  });

  it("answers the data-use questions users need", () => {
    const questions = AI_DATA_USE.map((i) => i.question.toLowerCase()).join(" ");
    expect(questions).toContain("why");
    expect(questions).toContain("original video");
    expect(questions).toContain("processed video");
    expect(questions).toContain("stored");
    expect(questions).toContain("delete");
    expect(AI_DATA_USE.every((i) => i.answer.trim().length > 20)).toBe(true);
  });

  it("makes no accuracy claim", () => {
    const all = [...AI_DISCLOSURE_POINTS, AI_RESULTS_CAVEAT, AI_TRAINING_NOTE.body]
      .join(" ")
      .toLowerCase();
    expect(all).not.toMatch(/accurate|accuracy|guarantee|precise measurement/);
  });

  it("keeps AI training consent separate and off by default", () => {
    expect(DEFAULT_PRIVACY.ai_training_opt_in).toBe(false);
    expect(DEFAULT_PRIVACY.ai_processing).toBe(true);
    expect(AI_TRAINING_NOTE.settingLabel).toBe(
      "Allow my uploaded videos to be used to improve/train AI",
    );
    expect(AI_TRAINING_NOTE.body.toLowerCase()).toContain("separate opt-in");
  });

  it("requires an explicit disclosure acknowledgement before the first upload", () => {
    expect(DEFAULT_PRIVACY.ai_disclosure_ack_at).toBeNull();
  });
});
