import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RECAP_STEPS, recapStepLabel, recapStepStates } from "@/lib/recaps";

/**
 * The pipeline's STEPS, read from its source. Importing the module would drag in
 * the server-only AI clients and database client, which a unit test has no use for.
 */
function pipelineSteps(): string[] {
  const src = readFileSync(new URL("./reels-pipeline.server.ts", import.meta.url), "utf8");
  const block = /export const STEPS = \[([\s\S]*?)\] as const/.exec(src);
  if (!block) throw new Error("STEPS not found in reels-pipeline.server.ts");
  return [...block[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
}

describe("progress steps mirror the pipeline", () => {
  it("lists every pipeline step, in the same order", () => {
    // A step missing here shows a generic "Processing" label and a checklist that
    // is one step short while the pipeline runs it.
    expect(pipelineSteps().length).toBeGreaterThan(5);
    expect([...RECAP_STEPS]).toEqual(pipelineSteps());
  });

  it("gives every step a human label", () => {
    const states = recapStepStates({ status: "processing", processing_step: "pending" });
    for (const s of states) expect(s.label).not.toBe(s.step);
  });

  it("labels each step while it is the active one", () => {
    for (const step of pipelineSteps()) {
      const label = recapStepLabel({
        status: "processing",
        processing_step: "pending",
        step_progress: { _pipeline: { active: step, done: [], percent: 10, attempt: 1 } },
      });
      expect(label).not.toBe("Processing");
    }
  });
});
