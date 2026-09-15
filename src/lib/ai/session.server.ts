/**
 * Convenience wrapper used by every AI server function: opens the gate, runs the
 * work with a reserved job row, then closes the job out either way.
 *
 * Errors leave as user-safe text (`AiError.userMessage`) — raw provider bodies
 * and stack traces never reach a client.
 */

import type { AiFeature } from "./config";
import { AiError, toAiError } from "./errors";
import { assertAiAllowed, type AiSession } from "./gate.server";
import { failJob, finishJob } from "./usage.server";

export type AiSessionInput = {
  admin?: any;
  userId: string;
  feature: AiFeature;
  units?: number;
  relatedReelId?: string | null;
  inputSummary?: Record<string, unknown>;
};

export async function withAiSession<T>(
  input: AiSessionInput,
  fn: (session: AiSession) => Promise<T>,
): Promise<T> {
  let session: AiSession;
  try {
    session = await assertAiAllowed(
      {
        admin: input.admin,
        userId: input.userId,
        relatedReelId: input.relatedReelId ?? null,
        inputSummary: input.inputSummary,
      },
      input.feature,
      input.units ?? 1,
    );
  } catch (e) {
    const err = toAiError(e);
    // Denials are typed; the client sees only the friendly message.
    throw new Error(err.userMessage);
  }

  try {
    const result = await fn(session);
    await finishJob(session.admin, session.jobId, { status: "succeeded" });
    return result;
  } catch (e) {
    const err = e instanceof AiError ? e : toAiError(e);
    await failJob(session.admin, session.jobId, err);
    throw new Error(err.userMessage);
  }
}
